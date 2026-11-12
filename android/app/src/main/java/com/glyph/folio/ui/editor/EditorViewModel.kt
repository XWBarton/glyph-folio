package com.glyph.folio.ui.editor

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.core.content.FileProvider
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.glyph.folio.data.NoteRepository
import com.glyph.folio.data.sync.Merge3
import com.glyph.folio.model.NoteParsing
import com.glyph.folio.ui.components.container
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class EditorViewModel(private val repo: NoteRepository, handle: SavedStateHandle) : ViewModel() {
    val noteId: String = checkNotNull(handle["id"])
    val notes = repo.notes
    val syncStatus = repo.syncStatus
    val settings = repo.settings

    var value by mutableStateOf(TextFieldValue(""))
        private set
    var loaded by mutableStateOf(false)
        private set
    var missing by mutableStateOf(false)
        private set
    val title: String get() = NoteParsing.extractTitle(value.text, noteId)

    /** Body as last read from / written to disk; the base for merging sync changes into open edits. */
    private var diskBody: String? = null
    private var saveJob: Job? = null
    private var deleted = false

    init {
        viewModelScope.launch {
            val note = repo.load(noteId)
            if (note == null) { missing = true; return@launch }
            diskBody = note.body
            value = TextFieldValue(note.body, TextRange(note.body.length))
            loaded = true
            // Pull in edits that arrive from sync while this note is open.
            repo.notes.collect { list ->
                val disk = list.firstOrNull { it.id == noteId }?.body ?: return@collect
                val known = diskBody ?: return@collect
                if (disk == known || disk == value.text) { diskBody = disk; return@collect }
                val merged = if (value.text == known) disk else Merge3.merge(known, value.text, disk).merged
                diskBody = disk
                val cursor = value.selection.start.coerceAtMost(merged.length)
                value = TextFieldValue(merged, TextRange(cursor))
                if (merged != disk) scheduleSave()
            }
        }
    }

    fun onValueChange(v: TextFieldValue) {
        val changed = v.text != value.text
        value = v
        if (changed) scheduleSave()
    }

    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = viewModelScope.launch { delay(600); persist() }
    }

    private suspend fun persist() {
        val text = value.text
        if (deleted || text == diskBody) return
        diskBody = text
        repo.save(noteId, text)
    }

    /** Save now and push without waiting for the debounce (leaving the screen / backgrounding). */
    @OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
    fun flush() {
        saveJob?.cancel()
        if (deleted || !loaded) return
        // Outlives the ViewModel on purpose: the save must finish after the screen is gone.
        kotlinx.coroutines.GlobalScope.launch(NonCancellable) {
            persist()
            repo.flush(noteId)
        }
    }

    fun linkTarget(title: String): String? = repo.findByTitle(title)?.id

    suspend fun delete() {
        saveJob?.cancel()
        deleted = true
        withContext(NonCancellable) {
            repo.delete(noteId)
            repo.commitDelete(noteId)
        }
    }

    fun shareSource(context: Context) {
        val dir = File(context.cacheDir, "share").apply { mkdirs() }
        val f = File(dir, "$noteId.typ").apply { writeText(value.text) }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", f)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, title)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, "Share source"))
    }

    override fun onCleared() { flush() }

    companion object {
        val Factory = viewModelFactory { initializer { EditorViewModel(container.notes, createSavedStateHandle()) } }
    }
}
