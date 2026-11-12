package com.glyph.folio.data.sync

import com.glyph.folio.data.remote.GlyphApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File

/** What both sides agreed on at the last successful sync of a note. */
@Serializable
data class SyncBase(val body: String, val serverModifiedAt: String)

@Serializable
private data class SyncState(
    val serverUrl: String = "",
    val bases: Map<String, SyncBase> = emptyMap(),
    /** Notes deleted on this device whose server DELETE hasn't gone through yet. */
    val pendingDeletes: Set<String> = emptySet(),
)

/** Per-device sync bookkeeping (the Android analogue of desktop's sync-bases.json). */
class SyncBaseStore(private val file: File) {
    private val mutex = Mutex()
    private var cache: SyncState? = null

    private suspend fun state(): SyncState = cache ?: withContext(Dispatchers.IO) {
        runCatching { GlyphApi.json.decodeFromString<SyncState>(file.readText()) }.getOrDefault(SyncState())
    }.also { cache = it }

    private suspend fun persist(s: SyncState) {
        cache = s
        withContext(Dispatchers.IO) {
            file.parentFile?.mkdirs()
            val tmp = File(file.path + ".tmp")
            tmp.writeText(GlyphApi.json.encodeToString(SyncState.serializer(), s))
            tmp.renameTo(file)
        }
    }

    /** Bases are only meaningful for one server; forget them if the URL changes. */
    suspend fun bindTo(serverUrl: String) = mutex.withLock {
        val s = state()
        if (s.serverUrl != serverUrl) persist(SyncState(serverUrl = serverUrl))
    }

    suspend fun get(id: String): SyncBase? = mutex.withLock { state().bases[id] }
    suspend fun set(id: String, base: SyncBase) = mutex.withLock { state().let { persist(it.copy(bases = it.bases + (id to base))) } }
    suspend fun remove(id: String) = mutex.withLock { state().let { persist(it.copy(bases = it.bases - id)) } }

    suspend fun pendingDeletes(): Set<String> = mutex.withLock { state().pendingDeletes }
    suspend fun addPendingDelete(id: String) = mutex.withLock {
        state().let { persist(it.copy(pendingDeletes = it.pendingDeletes + id, bases = it.bases - id)) }
    }
    suspend fun clearPendingDelete(id: String) = mutex.withLock {
        state().let { persist(it.copy(pendingDeletes = it.pendingDeletes - id)) }
    }
}
