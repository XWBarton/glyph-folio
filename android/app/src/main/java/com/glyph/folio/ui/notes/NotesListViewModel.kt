package com.glyph.folio.ui.notes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.glyph.folio.data.NoteRepository
import com.glyph.folio.model.Note
import com.glyph.folio.ui.components.container
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId

data class NoteSection(val title: String, val notes: List<Note>)

class NotesListViewModel(private val repo: NoteRepository) : ViewModel() {
    val query = MutableStateFlow("")
    val refreshing = MutableStateFlow(false)
    val syncStatus = repo.syncStatus
    val settings = repo.settings

    val sections = combine(repo.notes, query) { notes, q ->
        val filtered = if (q.isBlank()) notes else notes.filter { n ->
            n.title.contains(q, true) || n.body.contains(q, true) || n.tags.any { it.contains(q, true) }
        }
        group(filtered)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun refresh() = viewModelScope.launch {
        refreshing.value = true
        if (repo.settings.value.serverEnabled) repo.syncNow() else repo.refresh()
        refreshing.value = false
    }

    suspend fun create(): String = repo.create()
    suspend fun delete(id: String): Note? = repo.delete(id)
    fun commitDelete(id: String) = repo.commitDelete(id)
    fun restore(note: Note) = viewModelScope.launch { repo.restore(note) }

    private fun group(notes: List<Note>): List<NoteSection> {
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val buckets = linkedMapOf<String, MutableList<Note>>(
            "Today" to mutableListOf(), "Yesterday" to mutableListOf(), "This Week" to mutableListOf(),
            "This Month" to mutableListOf(), "Older" to mutableListOf(),
        )
        for (n in notes) {
            val d = n.modifiedAt.atZone(zone).toLocalDate()
            val key = when {
                d >= today -> "Today"
                d == today.minusDays(1) -> "Yesterday"
                d > today.minusDays(7) -> "This Week"
                d > today.minusDays(30) -> "This Month"
                else -> "Older"
            }
            buckets.getValue(key) += n
        }
        return buckets.filterValues { it.isNotEmpty() }.map { (k, v) -> NoteSection(k, v) }
    }

    companion object {
        val Factory = viewModelFactory { initializer { NotesListViewModel(container.notes) } }
    }
}
