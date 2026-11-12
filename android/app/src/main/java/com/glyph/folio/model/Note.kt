package com.glyph.folio.model

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** A single Typst note, stored on disk as `<id>.typ`. */
data class Note(
    val id: String,
    val title: String,
    val body: String,
    val createdAt: Instant,
    val modifiedAt: Instant,
) {
    val tags: List<String> get() = NoteParsing.extractTags(body)
    val links: List<String> get() = NoteParsing.extractLinks(body)
    val previewLine: String get() = NoteParsing.previewLine(body)
}

/** Ports of the parsing rules in ios/GlyphFolio/Models/Note.swift — keep them in step. */
object NoteParsing {
    /** IDs are `yyyy-MM-dd-slug`, slug restricted to `[a-z0-9-]` (also blocks path traversal). */
    private val validId = Regex("^[a-z0-9][a-z0-9-]{0,120}$")

    fun isValidId(id: String): Boolean = validId.matches(id)

    fun makeId(title: String?, today: LocalDate = LocalDate.now()): String {
        val slug = (title ?: "note")
            .lowercase(Locale.ROOT)
            .split(Regex("[^a-z0-9]+"))
            .filter { it.isNotEmpty() }
            .take(8)
            .joinToString("-")
        return "$today-${slug.ifEmpty { "note" }}"
    }

    /** [makeId] plus a `-N` suffix when the id is already taken. */
    fun uniqueId(title: String?, existing: Set<String>, today: LocalDate = LocalDate.now()): String {
        val base = makeId(title, today)
        var id = base
        var n = 1
        while (id in existing) id = "$base-${n++}"
        return id
    }

    private val tagLine = Regex("""//\s*@?tags:\s*""")

    fun extractTags(body: String): List<String> {
        for (line in body.lineSequence()) {
            val m = tagLine.find(line) ?: continue
            val tags = line.substring(m.range.last + 1)
                .split(",")
                .map { it.trim().lowercase(Locale.ROOT) }
                .filter { it.isNotEmpty() }
            if (tags.isNotEmpty()) return tags
        }
        return emptyList()
    }

    private val wikiLink = Regex("""\[\[([^\]]+)\]\]""")

    fun extractLinks(body: String): List<String> =
        wikiLink.findAll(body).map { it.groupValues[1].trim() }.toList()

    private val titleOverride = Regex("""^//\s*=\s+(.+)$""")

    fun extractTitle(body: String, id: String): String {
        val lines = body.lines()
        for (line in lines) {
            val m = titleOverride.find(line) ?: continue
            val t = m.groupValues[1].trim()
            if (t.isNotEmpty()) return t
        }
        lines.firstOrNull { it.startsWith("=") }?.let { line ->
            val t = line.trimStart('=').trim()
            if (t.isNotEmpty()) return t
        }
        val clean = id.replace(Regex("""^\d{4}-\d{2}-\d{2}-"""), "").replace("-", " ")
        if (clean.isBlank()) return "Untitled"
        return clean.split(" ").joinToString(" ") { w ->
            w.replaceFirstChar { it.titlecase(Locale.getDefault()) }
        }
    }

    private val headingStart = Regex("""^={1,6}\s""")
    private val listPrefix = Regex("""^([-+*]|\d+\.)\s+""")
    private val markup = Regex("""[*_`$]""")

    fun previewLine(body: String): String {
        for (raw in body.lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty() || line.startsWith("//") || line.startsWith("#")) continue
            if (headingStart.containsMatchIn(line)) continue
            val clean = line.replace(listPrefix, "").replace(markup, "").trim()
            if (clean.isNotEmpty()) return if (clean.length > 120) clean.take(117) + "…" else clean
        }
        return ""
    }

    /** createdAt from the id's date prefix, if it has one. */
    fun dateFromId(id: String): LocalDate? = runCatching {
        LocalDate.parse(id.take(10))
    }.getOrNull()

    private val dateLabelFormat = DateTimeFormatter.ofPattern("MMMM d, yyyy · h:mm a", Locale.getDefault())

    fun dateLabel(now: LocalDateTime = LocalDateTime.now()): String = now.format(dateLabelFormat)

    fun newNoteBody(title: String, now: LocalDateTime = LocalDateTime.now()): String = listOf(
        "// @tags: ",
        "#text(9pt, fill: gray)[${dateLabel(now)}]",
        "#line(length: 100%, stroke: 0.4pt + gray)",
        "",
        "= $title",
        "",
        "",
    ).joinToString("\n")

    /** Same palette and hash as iOS `tagHashHex` so tags look the same on every device. */
    val tagPalette = listOf(
        0xFF2563EB, 0xFF059669, 0xFF7C3AED, 0xFFEA580C, 0xFFDB2777, 0xFF0891B2,
        0xFF65A30D, 0xFFDC2626, 0xFFD97706, 0xFF4F46E5, 0xFF0F766E, 0xFF9333EA,
    )

    fun tagColor(tag: String): Long {
        var h = 0u
        tag.codePoints().forEach { h = h * 31u + it.toUInt() }
        return tagPalette[(h % tagPalette.size.toUInt()).toInt()]
    }
}
