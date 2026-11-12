package com.glyph.folio.data.sync

import com.glyph.folio.data.local.NoteFileStore
import com.glyph.folio.data.remote.GlyphApi
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.time.Instant

/** A tiny in-memory stand-in for server/src/index.ts. */
private class FakeServer : Dispatcher() {
    val notes = linkedMapOf<String, Pair<String, Instant>>()
    var clock: Instant = Instant.parse("2026-01-01T00:00:00Z")
    val requests = mutableListOf<String>()

    fun tick(): Instant { clock = clock.plusSeconds(1); return clock }

    override fun dispatch(request: RecordedRequest): MockResponse {
        val path = request.path!!.removePrefix("/")
        requests += "${request.method} $path"
        val id = path.removePrefix("api/notes/").takeIf { path.startsWith("api/notes/") }
        fun json(s: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(s)
        return when {
            request.method == "GET" && path == "api/notes" -> json(notes.entries.joinToString(",", "[", "]") { (k, v) ->
                buildJsonObject { put("id", k); put("title", k); put("modifiedAt", v.second.toString()) }.toString()
            })
            request.method == "GET" && id != null -> notes[id]?.let { (body, t) ->
                json(buildJsonObject { put("id", id); put("title", id); put("body", body); put("modifiedAt", t.toString()) }.toString())
            } ?: MockResponse().setResponseCode(404).setBody("{\"error\":\"Not found\"}")
            request.method == "PUT" && id != null -> {
                val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject["body"]!!.jsonPrimitive.content
                notes[id] = body to tick(); json("{\"ok\":true}")
            }
            request.method == "DELETE" && id != null -> { notes.remove(id); json("{\"ok\":true}") }
            else -> MockResponse().setResponseCode(404)
        }
    }

    fun put(id: String, body: String) { notes[id] = body to tick() }
}

class SyncEngineTest {
    @get:Rule val tmp = TemporaryFolder()
    private val server = MockWebServer()
    private val fake = FakeServer()
    private lateinit var store: NoteFileStore
    private lateinit var engine: SyncEngine
    private lateinit var api: GlyphApi
    private val url get() = server.url("/").toString()

    @Before fun setUp() {
        server.dispatcher = fake
        server.start()
        store = NoteFileStore(tmp.newFolder("notes"))
        engine = SyncEngine(store, SyncBaseStore(tmp.root.resolve("sync.json")))
        api = GlyphApi.create(url, "")
    }

    @After fun tearDown() { server.shutdown() }

    private fun sync() = runBlocking { engine.syncAll(api, url) }
    private fun local(id: String) = runBlocking { store.read(id)?.body }
    private fun writeLocal(id: String, body: String) = runBlocking { store.write(id, body) }

    @Test fun downloads_and_uploads_new_notes() {
        fake.put("2026-01-01-remote", "= Remote")
        writeLocal("2026-01-02-local", "= Local")
        val r = sync()
        assertEquals(1, r.downloaded); assertEquals(1, r.uploaded)
        assertEquals("= Remote", local("2026-01-01-remote"))
        assertEquals("= Local", fake.notes["2026-01-02-local"]!!.first)
        assertEquals(SyncStatus.Synced, engine.status.value)
    }

    @Test fun second_sync_is_a_noop() {
        fake.put("2026-01-01-a", "= A")
        sync()
        fake.requests.clear()
        val r = sync()
        assertEquals(SyncReport(), r)
        assertEquals(listOf("GET api/notes"), fake.requests) // no re-downloads after our own push
    }

    @Test fun local_edit_is_pushed_remote_edit_is_pulled() {
        fake.put("2026-01-01-a", "one"); fake.put("2026-01-01-b", "two")
        sync()
        writeLocal("2026-01-01-a", "one edited")
        fake.put("2026-01-01-b", "two edited")
        val r = sync()
        assertEquals(1, r.uploaded); assertEquals(1, r.downloaded)
        assertEquals("one edited", fake.notes["2026-01-01-a"]!!.first)
        assertEquals("two edited", local("2026-01-01-b"))
    }

    @Test fun concurrent_edits_merge_cleanly() {
        fake.put("2026-01-01-a", "a\nb\nc\nd\ne")
        sync()
        writeLocal("2026-01-01-a", "a\nB\nc\nd\ne")
        fake.put("2026-01-01-a", "a\nb\nc\nD\ne")
        val r = sync()
        assertEquals(1, r.merged); assertTrue(r.conflicts.isEmpty())
        assertEquals("a\nB\nc\nD\ne", local("2026-01-01-a"))
        assertEquals("a\nB\nc\nD\ne", fake.notes["2026-01-01-a"]!!.first)
    }

    @Test fun overlapping_edits_get_conflict_markers_on_both_sides() {
        fake.put("2026-01-01-a", "x")
        sync()
        writeLocal("2026-01-01-a", "mine")
        fake.put("2026-01-01-a", "theirs")
        val r = sync()
        assertEquals(listOf("2026-01-01-a"), r.conflicts)
        val expected = "// <<<<<<< local\nmine\n// =======\ntheirs\n// >>>>>>> server"
        assertEquals(expected, local("2026-01-01-a"))
        assertEquals(expected, fake.notes["2026-01-01-a"]!!.first)
    }

    @Test fun remote_delete_removes_untouched_local_copy() {
        fake.put("2026-01-01-a", "x")
        sync()
        fake.notes.remove("2026-01-01-a")
        val r = sync()
        assertEquals(1, r.deleted)
        assertNull(local("2026-01-01-a"))
    }

    @Test fun remote_delete_does_not_lose_local_edits() {
        fake.put("2026-01-01-a", "x")
        sync()
        fake.notes.remove("2026-01-01-a")
        writeLocal("2026-01-01-a", "x but edited")
        sync()
        assertEquals("x but edited", fake.notes["2026-01-01-a"]!!.first)
    }

    @Test fun offline_delete_is_retried_not_resurrected() = runBlocking {
        fake.put("2026-01-01-a", "x")
        sync()
        store.delete("2026-01-01-a")
        engine.markPendingDelete("2026-01-01-a")
        sync()
        assertFalse(fake.notes.containsKey("2026-01-01-a"))
        assertNull(local("2026-01-01-a"))
    }

    @Test fun push_does_not_clobber_newer_server_edit() = runBlocking {
        fake.put("2026-01-01-a", "a\nb\nc")
        sync()
        fake.put("2026-01-01-a", "a\nb\nc remote")
        writeLocal("2026-01-01-a", "a local\nb\nc")
        engine.push(api, url, "2026-01-01-a")
        assertEquals("a local\nb\nc remote", fake.notes["2026-01-01-a"]!!.first)
        assertEquals("a local\nb\nc remote", local("2026-01-01-a"))
    }

    @Test fun unauthorized_is_reported() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setResponseCode(401).setBody("{\"error\":\"Unauthorized\"}")
        }
        runCatching { sync() }
        assertTrue(engine.status.value is SyncStatus.Error)
    }
}
