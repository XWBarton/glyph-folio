package com.glyph.folio.model

import com.glyph.folio.data.settings.normalizeUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class NoteParsingTest {
    private val day = LocalDate.of(2026, 11, 12)

    @Test fun makeId_slugifies_and_caps_at_eight_words() {
        assertEquals("2026-11-12-hello-world", NoteParsing.makeId("Hello, World!", day))
        assertEquals("2026-11-12-note", NoteParsing.makeId(null, day))
        assertEquals("2026-11-12-note", NoteParsing.makeId("!!!", day))
        assertEquals("2026-11-12-a-b-c-d-e-f-g-h", NoteParsing.makeId("a b c d e f g h i j", day))
        assertEquals("2026-11-12-etc-passwd", NoteParsing.makeId("../../etc/passwd", day))
    }

    @Test fun uniqueId_appends_counter() {
        val taken = setOf("2026-11-12-note", "2026-11-12-note-1")
        assertEquals("2026-11-12-note-2", NoteParsing.uniqueId(null, taken, day))
    }

    @Test fun ids_are_validated() {
        assertTrue(NoteParsing.isValidId("2026-11-12-note"))
        assertFalse(NoteParsing.isValidId("../secret"))
        assertFalse(NoteParsing.isValidId("Has Spaces"))
        assertFalse(NoteParsing.isValidId(""))
    }

    @Test fun title_prefers_override_then_heading_then_id() {
        assertEquals("Override", NoteParsing.extractTitle("// @tags: x\n// = Override\n= Heading", "2026-01-01-x"))
        assertEquals("Heading", NoteParsing.extractTitle("// @tags: x\n\n== Heading", "2026-01-01-x"))
        assertEquals("My Cool Note", NoteParsing.extractTitle("no heading", "2026-01-01-my-cool-note"))
        assertEquals("Untitled", NoteParsing.extractTitle("", "2026-01-01-"))
    }

    @Test fun tags_parse_all_spellings() {
        assertEquals(listOf("foo", "bar"), NoteParsing.extractTags("// @tags: Foo, bar ,\n= T"))
        assertEquals(listOf("a"), NoteParsing.extractTags("//tags: a"))
        assertEquals(listOf("b"), NoteParsing.extractTags("// @tags: \n// tags: b"))
        assertEquals(emptyList<String>(), NoteParsing.extractTags("= no tags"))
    }

    @Test fun links_and_preview() {
        assertEquals(listOf("Alpha", "Beta"), NoteParsing.extractLinks("see [[ Alpha ]] and [[Beta]]"))
        assertEquals("First real line", NoteParsing.previewLine("// @tags: x\n#line()\n= Title\n- *First* real line"))
    }

    @Test fun tag_colour_matches_ios_hash() {
        // iOS: h = h*31 + scalar (UInt32 wrapping), palette[h % 12]
        var h = 0L
        "research".forEach { h = (h * 31 + it.code) and 0xFFFFFFFFL }
        assertEquals(NoteParsing.tagPalette[(h % 12).toInt()], NoteParsing.tagColor("research"))
    }

    @Test fun normalizeUrl_matches_desktop() {
        assertEquals("https://notes.example.com", normalizeUrl("http://notes.example.com"))
        assertEquals("http://192.168.1.5:3001", normalizeUrl("http://192.168.1.5:3001"))
        assertEquals("http://myserver", normalizeUrl("http://myserver"))
        assertEquals("http://box.local", normalizeUrl("http://box.local"))
        assertEquals("http://100.101.1.2", normalizeUrl("http://100.101.1.2"))
        assertEquals("https://x.y.com", normalizeUrl("https://x.y.com"))
        assertEquals("https://notes.example.com", normalizeUrl("notes.example.com"))
    }
}
