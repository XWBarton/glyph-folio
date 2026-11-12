package com.glyph.folio.data

import android.content.Context
import android.util.Base64
import com.glyph.folio.data.local.NoteFileStore
import com.glyph.folio.data.remote.CompileRequestDto
import com.glyph.folio.data.remote.GlyphApi
import com.glyph.folio.data.settings.AppSettings
import com.glyph.folio.data.settings.SettingsRepository
import com.glyph.folio.data.settings.SyncMode
import com.glyph.folio.data.sync.SyncBaseStore
import com.glyph.folio.data.sync.SyncEngine
import com.glyph.folio.data.sync.SyncReport
import com.glyph.folio.data.sync.SyncStatus
import com.glyph.folio.model.Note
import com.glyph.folio.model.NoteParsing
import com.glyph.folio.model.Tutorial
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** The one place the UI goes for notes, sync and compiling. */
class NoteRepository(
    context: Context,
    private val settingsRepo: SettingsRepository,
    private val scope: CoroutineScope,
) {
    private val root = File(context.filesDir, "GlyphFolio")
    private val localStore = NoteFileStore(File(root, "local"))
    private val serverStore = NoteFileStore(File(root, "server"))
    private val engine = SyncEngine(serverStore, SyncBaseStore(File(root, "sync-state.json")))

    private val _settings = MutableStateFlow(AppSettings())
    val settings: StateFlow<AppSettings> = _settings.asStateFlow()

    private val _notes = MutableStateFlow<List<Note>>(emptyList())
    val notes: StateFlow<List<Note>> = _notes.asStateFlow()

    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    val syncStatus: StateFlow<SyncStatus> = combine(engine.status, settings) { status, s ->
        if (s.serverEnabled) status else SyncStatus.Idle
    }.stateIn(scope, SharingStarted.Eagerly, SyncStatus.Idle)

    private val pushJobs = ConcurrentHashMap<String, Job>()
    private val refreshMutex = Mutex()

    init {
        scope.launch {
            settingsRepo.settings.distinctUntilChanged().collect { s ->
                val prev = _settings.value
                _settings.value = s
                if (!_loaded.value) seedTutorialIfNeeded()
                refresh()
                _loaded.value = true
                if (s.serverEnabled && (prev.normalizedServerUrl != s.normalizedServerUrl ||
                        prev.syncMode != s.syncMode || prev.authToken != s.authToken)) {
                    engine.reset()
                    syncNow()
                }
            }
        }
    }

    private val store get() = if (_settings.value.syncMode == SyncMode.SERVER) serverStore else localStore

    private var apiCache: Triple<String, String, GlyphApi>? = null
    private fun api(s: AppSettings = _settings.value): GlyphApi? {
        if (!s.serverEnabled) return null
        val url = s.normalizedServerUrl
        apiCache?.let { (u, t, api) -> if (u == url && t == s.authToken) return api }
        return GlyphApi.create(url, s.authToken).also { apiCache = Triple(url, s.authToken, it) }
    }

    suspend fun refresh() = refreshMutex.withLock { _notes.value = store.list() }

    suspend fun load(id: String): Note? = if (NoteParsing.isValidId(id)) store.read(id) else null

    fun findByTitle(title: String): Note? =
        _notes.value.firstOrNull { it.title.equals(title.trim(), ignoreCase = true) }

    suspend fun create(title: String = "New Note"): String {
        val id = NoteParsing.uniqueId(null, _notes.value.map { it.id }.toSet())
        store.write(id, NoteParsing.newNoteBody(title))
        refresh()
        schedulePush(id, delayMs = 0)
        return id
    }

    /** Save to disk now; push to the server after a 2s quiet period. */
    suspend fun save(id: String, body: String) {
        val existing = store.read(id)
        if (existing?.body == body) return
        store.write(id, body)
        refresh()
        schedulePush(id)
    }

    private fun schedulePush(id: String, delayMs: Long = 2_000) {
        val api = api() ?: return
        val url = _settings.value.normalizedServerUrl
        pushJobs.remove(id)?.cancel()
        pushJobs[id] = scope.launch {
            delay(delayMs)
            engine.push(api, url, id)
            refresh() // a push may have merged in remote edits
        }
    }

    /** Push any pending edit immediately (leaving the editor, app going to background). */
    suspend fun flush(id: String) {
        val job = pushJobs.remove(id) ?: return
        job.cancel()
        api()?.let { engine.push(it, _settings.value.normalizedServerUrl, id) }
    }

    /** Removes locally and queues the server delete; [commitDelete] sends it, [restore] undoes it. */
    suspend fun delete(id: String): Note? {
        val note = store.read(id) ?: return null
        pushJobs.remove(id)?.cancel()
        store.delete(id)
        if (_settings.value.serverEnabled) engine.markPendingDelete(id)
        refresh()
        return note
    }

    fun commitDelete(id: String) {
        val api = api() ?: return
        scope.launch { engine.delete(api, id) }
    }

    suspend fun restore(note: Note) {
        store.write(note.id, note.body)
        refresh()
        schedulePush(note.id, delayMs = 0)
    }

    suspend fun syncNow(): Result<SyncReport> {
        val api = api() ?: return Result.failure(IllegalStateException("Server sync is off"))
        return runCatching { engine.syncAll(api, _settings.value.normalizedServerUrl) }
            .also { refresh() }
    }

    suspend fun compilePdf(note: Note): Result<ByteArray> {
        val api = api() ?: return Result.failure(IllegalStateException("PDF preview needs server mode — turn it on in Settings."))
        return runCatching {
            val res = api.compile(CompileRequestDto(PdfSource.build(note.body), note.id, _settings.value.citationStyle.wire))
            if (!res.ok || res.pdfBase64 == null) throw CompileException(res.error ?: "Compilation failed")
            Base64.decode(res.pdfBase64, Base64.DEFAULT)
        }
    }

    suspend fun testConnection(s: AppSettings): Result<String> = runCatching {
        val probe = GlyphApi.create(s.normalizedServerUrl, s.authToken)
        val h = probe.health()
        if (!h.ok) error("Server responded but reported not OK")
        "Connected${h.version?.let { " · server v$it" } ?: ""}"
    }

    suspend fun saveSettings(s: AppSettings) = settingsRepo.save(s)

    private suspend fun seedTutorialIfNeeded() {
        if (settingsRepo.tutorialSeeded()) return
        if (localStore.list().isEmpty()) {
            val id = NoteParsing.makeId("getting-started")
            localStore.write(id, Tutorial.body(NoteParsing.dateLabel()))
        }
        settingsRepo.markTutorialSeeded()
    }
}

class CompileException(message: String) : Exception(message)

/** Pre-processing shared with iOS `compilePDF`: wiki-link badges and `---` dividers. */
object PdfSource {
    private const val WIKILINK_DEF =
        "#let wikilink(it) = box(fill: rgb(\"#eff6ff\"), stroke: 0.5pt + rgb(\"#93c5fd\"), radius: 3pt, inset: (x: 3pt, y: 1pt), baseline: 1pt)[#text(fill: rgb(\"#1d4ed8\"), size: 0.9em)[#it]]\n"

    fun build(body: String): String {
        val def = if (body.contains("[[")) WIKILINK_DEF else ""
        return def + body
            .replace(Regex("""\[\[([^\]]+)\]\]"""), "#wikilink[$1]")
            .replace(Regex("""(?m)^---$"""), "#line(length: 100%)")
    }
}
