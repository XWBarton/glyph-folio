package com.glyph.folio.data.local

import com.glyph.folio.model.Note
import com.glyph.folio.model.NoteParsing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Instant
import java.time.ZoneId

/**
 * Notes as plain `<id>.typ` files — the same layout as desktop and iOS.
 * Local and server-mode notes live in separate directories so switching modes never mixes them.
 */
class NoteFileStore(val dir: File) {
    init { dir.mkdirs() }

    private fun file(id: String): File {
        require(NoteParsing.isValidId(id)) { "Invalid note id: $id" }
        return File(dir, "$id.typ")
    }

    suspend fun list(): List<Note> = withContext(Dispatchers.IO) {
        (dir.listFiles { f -> f.isFile && f.extension == "typ" } ?: emptyArray())
            .mapNotNull { f -> f.nameWithoutExtension.takeIf(NoteParsing::isValidId)?.let { toNote(it, f) } }
            .sortedByDescending { it.modifiedAt }
    }

    suspend fun read(id: String): Note? = withContext(Dispatchers.IO) {
        val f = file(id)
        if (f.exists()) toNote(id, f) else null
    }

    suspend fun exists(id: String): Boolean = withContext(Dispatchers.IO) { file(id).exists() }

    /** Writes atomically. [modifiedAt] pins the mtime (e.g. to the server's) for stable ordering. */
    suspend fun write(id: String, body: String, modifiedAt: Instant? = null) = withContext(Dispatchers.IO) {
        val f = file(id)
        val tmp = File(dir, ".$id.typ.tmp")
        tmp.writeText(body)
        if (!tmp.renameTo(f)) { f.writeText(body); tmp.delete() }
        if (modifiedAt != null) f.setLastModified(modifiedAt.toEpochMilli())
    }

    suspend fun delete(id: String) = withContext(Dispatchers.IO) {
        file(id).delete()
        File(dir, "attachments/$id").deleteRecursively()
    }

    private fun toNote(id: String, f: File): Note {
        val body = f.readText()
        val modified = Instant.ofEpochMilli(f.lastModified())
        val created = NoteParsing.dateFromId(id)?.atStartOfDay(ZoneId.systemDefault())?.toInstant() ?: modified
        return Note(id, NoteParsing.extractTitle(body, id), body, created, modified)
    }
}
