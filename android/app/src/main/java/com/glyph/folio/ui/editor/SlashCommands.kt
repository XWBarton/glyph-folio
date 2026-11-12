package com.glyph.folio.ui.editor

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.FormatListBulleted
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.DataObject
import androidx.compose.material.icons.filled.FormatBold
import androidx.compose.material.icons.filled.FormatItalic
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.FormatQuote
import androidx.compose.material.icons.filled.FormatStrikethrough
import androidx.compose.material.icons.filled.Functions
import androidx.compose.material.icons.filled.HorizontalRule
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Superscript
import androidx.compose.material.icons.filled.TableChart
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.filled.Title
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import com.glyph.folio.model.NoteParsing

data class SlashCommand(
    val id: String,
    val category: String,
    val icon: ImageVector,
    val name: String,
    val description: String,
)

/** Mirrors iOS `allSlashCommands` (image, bookmark and reminder arrive in a later milestone). */
val allSlashCommands = listOf(
    SlashCommand("h1", "Heading", Icons.Default.Title, "Heading 1", "Large section heading"),
    SlashCommand("h2", "Heading", Icons.Default.Title, "Heading 2", "Medium section heading"),
    SlashCommand("h3", "Heading", Icons.Default.Title, "Heading 3", "Small section heading"),
    SlashCommand("bold", "Format", Icons.Default.FormatBold, "Bold", "Strong emphasis"),
    SlashCommand("italic", "Format", Icons.Default.FormatItalic, "Italic", "Light emphasis"),
    SlashCommand("code", "Format", Icons.Default.Code, "Inline Code", "Monospace code snippet"),
    SlashCommand("strike", "Format", Icons.Default.FormatStrikethrough, "Strikethrough", "Struck-through text"),
    SlashCommand("bullet", "List", Icons.AutoMirrored.Filled.FormatListBulleted, "Bullet List", "Unordered list item"),
    SlashCommand("numbered", "List", Icons.Default.FormatListNumbered, "Numbered List", "Ordered list item"),
    SlashCommand("checkbox", "List", Icons.Default.CheckBox, "Checkbox", "Checklist item (auto-imports cheq)"),
    SlashCommand("codeblock", "Block", Icons.Default.DataObject, "Code Block", "Multi-line code block"),
    SlashCommand("math", "Block", Icons.Default.Superscript, "Equation", "Inline math expression"),
    SlashCommand("mathblock", "Block", Icons.Default.Functions, "Math Block", "Display-mode equation"),
    SlashCommand("quote", "Block", Icons.Default.FormatQuote, "Block Quote", "Indented quotation"),
    SlashCommand("table", "Block", Icons.Default.TableChart, "Table", "Three-column table"),
    SlashCommand("divider", "Block", Icons.Default.HorizontalRule, "Divider", "Horizontal rule"),
    SlashCommand("wikilink", "Link", Icons.Default.Link, "Wiki Link", "Link to another note"),
    SlashCommand("url", "Link", Icons.Default.Public, "URL Link", "External hyperlink"),
    SlashCommand("tags", "Meta", Icons.Default.Tag, "Tags", "Add tags to this note"),
    SlashCommand("datetime", "Meta", Icons.Default.CalendarMonth, "Date & Time", "Insert current date and time"),
)

val slashCategoryOrder = listOf("Format", "List", "Block", "Link", "Meta", "Heading")

object SlashActions {
    /** Remove the `/` just before the cursor (when the palette was opened by typing it). */
    fun stripSlash(v: TextFieldValue): TextFieldValue {
        val p = v.selection.start
        return if (v.selection.collapsed && p > 0 && v.text[p - 1] == '/')
            TextFieldValue(v.text.removeRange(p - 1, p), TextRange(p - 1)) else v
    }

    private fun wrap(v: TextFieldValue, prefix: String, suffix: String, placeholder: String): TextFieldValue {
        val sel = v.text.substring(v.selection.min, v.selection.max)
        return if (sel.isNotEmpty()) {
            EditorBehaviors.insert(v, prefix + sel + suffix, cursorOffset = prefix.length + sel.length + suffix.length)
        } else {
            EditorBehaviors.insert(v, prefix + placeholder + suffix, cursorOffset = prefix.length, selectLen = placeholder.length)
        }
    }

    /** Apply [cmd]. Returns the new value and whether the wiki-link picker should open. */
    fun apply(v: TextFieldValue, cmd: SlashCommand): EditOutcome = when (cmd.id) {
        "h1" -> EditOutcome(EditorBehaviors.insert(v, "= "))
        "h2" -> EditOutcome(EditorBehaviors.insert(v, "== "))
        "h3" -> EditOutcome(EditorBehaviors.insert(v, "=== "))
        "bold" -> EditOutcome(wrap(v, "*", "*", "bold"))
        "italic" -> EditOutcome(wrap(v, "_", "_", "italic"))
        "code" -> EditOutcome(wrap(v, "`", "`", "code"))
        "strike" -> EditOutcome(wrap(v, "#strike[", "]", "text"))
        "math" -> EditOutcome(wrap(v, "$", "$", "x = y"))
        "bullet" -> EditOutcome(EditorBehaviors.insert(v, "- "))
        "numbered" -> EditOutcome(EditorBehaviors.insert(v, "+ "))
        "checkbox" -> EditOutcome(checklist(v))
        "codeblock" -> EditOutcome(EditorBehaviors.insert(v, "```\n\n```", cursorOffset = 4))
        "mathblock" -> EditOutcome(EditorBehaviors.insert(v, "$ x = y $", cursorOffset = 2, selectLen = 5))
        "quote" -> EditOutcome(EditorBehaviors.insert(v, "#quote[\n\n]", cursorOffset = 8))
        "table" -> {
            val t = "#table(\n  columns: 3,\n  [*A*], [*B*], [*C*],\n  [], [], [],\n)\n"
            EditOutcome(EditorBehaviors.insert(v, t, cursorOffset = t.indexOf("[],") + 1))
        }
        "divider" -> EditOutcome(EditorBehaviors.insert(v, "\n---\n"))
        "wikilink" -> EditOutcome(EditorBehaviors.insert(v, "[[]]", cursorOffset = 2), EditorTrigger.WIKILINK)
        "url" -> EditOutcome(EditorBehaviors.insert(v, "#link(\"url\")[text]", cursorOffset = 7, selectLen = 3))
        "tags" -> EditOutcome(focusTags(v))
        "datetime" -> EditOutcome(EditorBehaviors.insert(v, NoteParsing.dateLabel()))
        else -> EditOutcome(v)
    }

    private fun checklist(v: TextFieldValue): TextFieldValue {
        var text = v.text
        var cursor = v.selection.min
        var selEnd = v.selection.max
        if (!text.contains("@preview/cheq")) {
            val block = "#import \"@preview/cheq:0.3.0\": checklist\n#show: checklist\n"
            val tags = text.indexOf("// @tags:")
            val at = if (tags >= 0) text.indexOf('\n', tags).let { if (it < 0) text.length else it + 1 } else 0
            text = text.substring(0, at) + (if (at == text.length && at > 0 && !text.endsWith("\n")) "\n" else "") + block + text.substring(at)
            if (cursor >= at) { cursor += block.length; selEnd += block.length }
        }
        val item = "- [ ] item"
        text = text.substring(0, cursor) + item + text.substring(selEnd)
        return TextFieldValue(text, TextRange(cursor + 6, cursor + 10))
    }

    private fun focusTags(v: TextFieldValue): TextFieldValue {
        val idx = v.text.indexOf("// @tags:")
        if (idx >= 0) {
            val end = v.text.indexOf('\n', idx).let { if (it < 0) v.text.length else it }
            return v.copy(selection = TextRange(end))
        }
        val line = "// @tags: \n"
        return TextFieldValue(line + v.text, TextRange(line.length - 1))
    }
}
