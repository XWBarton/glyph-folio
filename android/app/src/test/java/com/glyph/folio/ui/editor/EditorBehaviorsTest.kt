package com.glyph.folio.ui.editor

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EditorBehaviorsTest {
    private fun type(text: String, cursor: Int, ch: Char): EditOutcome {
        val old = TextFieldValue(text, TextRange(cursor))
        val new = TextFieldValue(text.substring(0, cursor) + ch + text.substring(cursor), TextRange(cursor + 1))
        return EditorBehaviors.process(old, new)
    }

    @Test fun autocloses_and_types_over() {
        val a = type("", 0, '(')
        assertEquals("()", a.value.text); assertEquals(TextRange(1), a.value.selection)
        val b = type("()", 1, ')')
        assertEquals("()", b.value.text); assertEquals(TextRange(2), b.value.selection)
    }

    @Test fun double_bracket_opens_wikilink_picker() {
        val r = type("[]", 1, '[')
        assertEquals("[[]]", r.value.text)
        assertEquals(EditorTrigger.WIKILINK, r.trigger)
    }

    @Test fun slash_triggers_only_at_word_start() {
        assertEquals(EditorTrigger.SLASH, type("hi ", 3, '/').trigger)
        assertEquals(EditorTrigger.NONE, type("http:", 5, '/').trigger)
    }

    @Test fun enter_continues_and_exits_lists() {
        assertEquals("- one\n- ", type("- one", 5, '\n').value.text)
        assertEquals("  + a\n  + ", type("  + a", 5, '\n').value.text)
        assertEquals("- [x] done\n- [ ] ", type("- [x] done", 10, '\n').value.text)
        val exit = type("- one\n- ", 8, '\n')
        assertEquals("- one\n", exit.value.text)
    }

    @Test fun wikilink_under_cursor() {
        assertEquals("Alpha", EditorBehaviors.wikiLinkAt(TextFieldValue("see [[Alpha]] x", TextRange(8))))
        assertNull(EditorBehaviors.wikiLinkAt(TextFieldValue("see [[Alpha]] x", TextRange(14))))
    }

    @Test fun slash_command_wraps_selection() {
        val v = TextFieldValue("make this bold", TextRange(10, 14))
        val out = SlashActions.apply(v, allSlashCommands.first { it.id == "bold" }).value
        assertEquals("make this *bold*", out.text)
    }

    @Test fun checkbox_imports_cheq_once_below_tags() {
        val v = TextFieldValue("// @tags: x\n= T\n", TextRange(16))
        val out = SlashActions.apply(v, allSlashCommands.first { it.id == "checkbox" }).value
        assertEquals("// @tags: x\n#import \"@preview/cheq:0.3.0\": checklist\n#show: checklist\n= T\n- [ ] item", out.text)
        assertEquals("item", out.text.substring(out.selection.min, out.selection.max))
    }
}
