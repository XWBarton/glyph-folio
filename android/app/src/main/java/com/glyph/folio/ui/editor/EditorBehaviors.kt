package com.glyph.folio.ui.editor

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue

/** What the editor should do after an edit, beyond updating the text. */
enum class EditorTrigger { NONE, SLASH, WIKILINK }

data class EditOutcome(val value: TextFieldValue, val trigger: EditorTrigger = EditorTrigger.NONE)

/**
 * Typing conveniences ported from the iOS Coordinator: bracket auto-close and type-over,
 * list continuation on Enter (an empty item exits the list), and the `/` and `[[` triggers.
 */
object EditorBehaviors {
    private val pairs = mapOf('[' to ']', '(' to ')', '{' to '}')
    private val listItem = Regex("""^(\s*)(- \[[ xX]\] |- |\+ )(.*)$""")

    fun process(old: TextFieldValue, new: TextFieldValue): EditOutcome {
        val o = old.text
        val n = new.text
        // Only react to a single character typed at a collapsed cursor.
        if (n.length != o.length + 1 || !new.selection.collapsed || !old.selection.collapsed) return EditOutcome(new)
        val pos = new.selection.start
        if (pos < 1 || old.selection.start != pos - 1) return EditOutcome(new)
        if (n.substring(0, pos - 1) != o.substring(0, pos - 1) || n.substring(pos) != o.substring(pos - 1)) return EditOutcome(new)
        val ch = n[pos - 1]
        val after = n.getOrNull(pos)

        // Type over an auto-inserted closer.
        if (ch in pairs.values && after == ch) {
            return EditOutcome(TextFieldValue(o, TextRange(pos)))
        }
        // Auto-close brackets (only before whitespace/end/closer, so wrapping existing text isn't annoying).
        pairs[ch]?.let { close ->
            if (after == null || after.isWhitespace() || after in pairs.values) {
                val text = n.substring(0, pos) + close + n.substring(pos)
                val trigger = if (ch == '[' && n.getOrNull(pos - 2) == '[') EditorTrigger.WIKILINK else EditorTrigger.NONE
                return EditOutcome(TextFieldValue(text, TextRange(pos)), trigger)
            }
        }
        if (ch == '/') {
            val before = n.getOrNull(pos - 2)
            if (before == null || before.isWhitespace()) return EditOutcome(new, EditorTrigger.SLASH)
        }
        if (ch == '\n') return EditOutcome(continueList(n, pos))
        return EditOutcome(new)
    }

    private fun continueList(text: String, pos: Int): TextFieldValue {
        val prevLineStart = text.lastIndexOf('\n', pos - 2) + 1
        val prevLine = text.substring(prevLineStart, pos - 1)
        val m = listItem.matchEntire(prevLine) ?: return TextFieldValue(text, TextRange(pos))
        val (indent, marker, content) = m.destructured
        if (content.isBlank()) {
            // Empty item: remove the marker and end the list.
            val t = text.substring(0, prevLineStart) + text.substring(pos)
            return TextFieldValue(t, TextRange(prevLineStart))
        }
        val nextMarker = if (marker.startsWith("- [")) "- [ ] " else marker
        val insert = indent + nextMarker
        val t = text.substring(0, pos) + insert + text.substring(pos)
        return TextFieldValue(t, TextRange(pos + insert.length))
    }

    /** Insert [s] at the selection (replacing it); the cursor lands at [cursorOffset] within [s], or at its end. */
    fun insert(v: TextFieldValue, s: String, cursorOffset: Int = s.length, selectLen: Int = 0): TextFieldValue {
        val start = v.selection.min
        val text = v.text.substring(0, start) + s + v.text.substring(v.selection.max)
        return TextFieldValue(text, TextRange(start + cursorOffset, start + cursorOffset + selectLen))
    }

    /** Toolbar typing: run the same behaviours as if the user typed [ch]. */
    fun typeChar(v: TextFieldValue, ch: Char): EditOutcome {
        val typed = insert(v, ch.toString())
        return if (v.selection.collapsed) process(v, typed) else EditOutcome(typed)
    }

    /** Indent the current list line by two spaces. */
    fun indentLine(v: TextFieldValue, outdent: Boolean = false): TextFieldValue {
        val pos = v.selection.start
        val lineStart = v.text.lastIndexOf('\n', pos - 1) + 1
        return if (!outdent) {
            TextFieldValue(v.text.substring(0, lineStart) + "  " + v.text.substring(lineStart), TextRange(pos + 2))
        } else {
            val spaces = v.text.substring(lineStart).takeWhile { it == ' ' }.length.coerceAtMost(2)
            if (spaces == 0) v
            else TextFieldValue(v.text.removeRange(lineStart, lineStart + spaces), TextRange((pos - spaces).coerceAtLeast(lineStart)))
        }
    }

    /** If the cursor sits inside `[[Title]]`, return the title. */
    fun wikiLinkAt(v: TextFieldValue): String? {
        if (!v.selection.collapsed) return null
        val pos = v.selection.start
        val t = v.text
        val open = t.lastIndexOf("[[", pos - 1).takeIf { it >= 0 } ?: return null
        val close = t.indexOf("]]", open + 2).takeIf { it >= 0 } ?: return null
        if (pos < open + 2 || pos > close) return null
        val inner = t.substring(open + 2, close)
        if (inner.isBlank() || inner.contains('\n') || inner.contains('[')) return null
        return inner.trim()
    }
}
