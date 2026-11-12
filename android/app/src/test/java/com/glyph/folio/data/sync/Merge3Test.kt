package com.glyph.folio.data.sync

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class Merge3Test {
    @Serializable
    data class Fixture(val b: String, val l: String, val r: String, val merged: String, val hasConflicts: Boolean)

    /** Expected outputs were produced by node-diff3 through desktop's merge3(), so both clients agree. */
    @Test fun matches_node_diff3_fixtures() {
        val text = javaClass.classLoader!!.getResource("merge3-fixtures.json")!!.readText()
        val fixtures = Json.decodeFromString<List<Fixture>>(text)
        fixtures.forEachIndexed { i, f ->
            val r = Merge3.merge(f.b, f.l, f.r)
            assertEquals("fixture $i merged", f.merged, r.merged)
            assertEquals("fixture $i conflicts", f.hasConflicts, r.hasConflicts)
        }
    }

    @Test fun identical_inputs_are_untouched() {
        val r = Merge3.merge("a\nb", "a\nb", "a\nb")
        assertEquals("a\nb", r.merged); assertFalse(r.hasConflicts)
    }

    @Test fun conflict_markers_are_typst_comments() {
        val r = Merge3.merge("x", "local", "remote")
        assertTrue(r.hasConflicts)
        assertEquals("// <<<<<<< local\nlocal\n// =======\nremote\n// >>>>>>> server", r.merged)
    }

    @Test fun large_documents_merge() {
        val base = (1..3000).joinToString("\n") { "line $it" }
        val local = base.replace("line 10\n", "line 10 local\n")
        val remote = base.replace("line 2900\n", "line 2900 remote\n")
        val r = Merge3.merge(base, local, remote)
        assertFalse(r.hasConflicts)
        assertTrue(r.merged.contains("line 10 local") && r.merged.contains("line 2900 remote"))
    }
}
