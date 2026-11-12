package com.glyph.folio.ui.editor

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation

/** Rules mirror `tokenRules` in ios/GlyphFolio/Views/NoteEditorView.swift, applied in order (later wins). */
private class Rule(pattern: String, val light: Long, val dark: Long, val bold: Boolean = false, val italic: Boolean = false, multiline: Boolean = true) {
    val regex = if (multiline) Regex(pattern, RegexOption.MULTILINE) else Regex(pattern)
}

private val rules = listOf(
    Rule("""//[^\n]*""", 0xFF9CA3AF, 0xFF6B7280, italic = true),               // comment
    Rule("""^---$""", 0xFFD1D5DB, 0xFF4B5563),                                // hr
    Rule("""\$[^\$\n]+\$""", 0xFFC2410C, 0xFFFB923C),                         // inline math
    Rule("""```[\s\S]*?```""", 0xFF0F766E, 0xFF2DD4BF, multiline = false),    // code block
    Rule("""`[^`\n]+`""", 0xFF0F766E, 0xFF2DD4BF),                            // inline code
    Rule("\"[^\"\\n]*\"", 0xFF059669, 0xFF34D399),                            // string
    Rule("""^\s*[-+]\s""", 0xFF2563EB, 0xFF93C5FD, bold = true),              // list marker
    Rule("""^={1,6}\s.+$""", 0xFF1D4ED8, 0xFF60A5FA, bold = true),            // heading
    Rule("""_[^_\n]+_""", 0xFF374151, 0xFFCBD5E1, italic = true),             // italic
    Rule("""\*[^*\n]+\*""", 0xFF111827, 0xFFF1F5F9, bold = true),             // bold
    Rule("""#(set|let|show|if|else|for|while|import|include|return)\b""", 0xFF7C3AED, 0xFFA78BFA, bold = true),
    Rule("""#[a-zA-Z_][a-zA-Z0-9_]*""", 0xFF0369A1, 0xFF38BDF8),              // function
    Rule("""@[a-zA-Z_][a-zA-Z0-9_:.-]*""", 0xFFBE185D, 0xFFF472B6),           // reference
    Rule("""\[\[[^\]\n]+\]\]""", 0xFF1D4ED8, 0xFF93C5FD, bold = true),         // wiki link
    Rule("""^// <<<<<<< local$|^// =======$|^// >>>>>>> server$""", 0xFFDC2626, 0xFFF87171, bold = true), // conflict markers
)

object TypstHighlighter {
    fun highlight(text: String, dark: Boolean): AnnotatedString {
        val b = AnnotatedString.Builder(text)
        for (r in rules) {
            val color = Color(if (dark) r.dark else r.light)
            val style = SpanStyle(
                color = color,
                fontWeight = if (r.bold) FontWeight.Bold else null,
                fontStyle = if (r.italic) FontStyle.Italic else null,
            )
            for (m in r.regex.findAll(text)) b.addStyle(style, m.range.first, m.range.last + 1)
        }
        return b.toAnnotatedString()
    }
}

/** Identity-mapped highlighting; memoises the last result so recomposition without edits is free. */
class TypstVisualTransformation(private val dark: Boolean) : VisualTransformation {
    private var lastText: String? = null
    private var lastResult: AnnotatedString? = null

    override fun filter(text: AnnotatedString): TransformedText {
        val raw = text.text
        val styled = if (raw == lastText) lastResult!! else TypstHighlighter.highlight(raw, dark).also {
            lastText = raw; lastResult = it
        }
        return TransformedText(styled, OffsetMapping.Identity)
    }

    override fun equals(other: Any?) = other is TypstVisualTransformation && other.dark == dark
    override fun hashCode() = dark.hashCode()
}
