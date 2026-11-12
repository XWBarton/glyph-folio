package com.glyph.folio.data.sync

import com.glyph.folio.data.local.NoteFileStore
import com.glyph.folio.data.remote.GlyphApi
import com.glyph.folio.data.remote.CompileRequestDto
import com.glyph.folio.data.remote.PutNoteDto
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Runs against a real Glyph Folio server (skipped unless GLYPH_SERVER is set), e.g.
 *   DATA_DIR=/tmp/gf PORT=3099 node server/dist/index.js
 *   GLYPH_SERVER=http://127.0.0.1:3099 ./gradlew testDebugUnitTest --tests '*LiveServerTest*'
 */
class LiveServerTest {
    @get:Rule val tmp = TemporaryFolder()
    private val url: String? = System.getenv("GLYPH_SERVER")
    private val token: String = System.getenv("GLYPH_TOKEN") ?: ""

    @Test fun round_trip_merge_and_compile() = runBlocking {
        assumeTrue(url != null)
        val api = GlyphApi.create(url!!, token)
        assertTrue(api.health().ok)

        val id = "2026-11-12-android-live-test"
        api.putNote(id, PutNoteDto("= Live\n\na\nb\nc"))

        val store = NoteFileStore(tmp.newFolder("n"))
        val engine = SyncEngine(store, SyncBaseStore(tmp.root.resolve("s.json")))
        engine.syncAll(api, url)
        assertEquals("= Live\n\na\nb\nc", store.read(id)!!.body)

        Thread.sleep(20) // make sure the server mtime moves
        store.write(id, "= Live\n\nA local\nb\nc")
        api.putNote(id, PutNoteDto("= Live\n\na\nb\nc remote"))
        val r = engine.syncAll(api, url)
        assertEquals(1, r.merged)
        assertEquals("= Live\n\nA local\nb\nc remote", api.getNote(id).body)

        // Nothing left to do afterwards.
        assertEquals(SyncReport(), engine.syncAll(api, url))

        val pdf = api.compile(CompileRequestDto("= Hello from Android", id, "author-date"))
        if (!pdf.ok) println("compile unavailable on this server: ${pdf.error}")
        else assertTrue(pdf.pdfBase64!!.isNotEmpty())

        api.deleteNote(id)
        Unit
    }
}
