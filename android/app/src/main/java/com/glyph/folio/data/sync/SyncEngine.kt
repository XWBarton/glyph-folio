package com.glyph.folio.data.sync

import com.glyph.folio.data.local.NoteFileStore
import com.glyph.folio.data.remote.GlyphApi
import com.glyph.folio.data.remote.NoteDto
import com.glyph.folio.data.remote.PutNoteDto
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import retrofit2.HttpException
import java.io.IOException
import java.time.Instant

sealed interface SyncStatus {
    data object Idle : SyncStatus
    data object Syncing : SyncStatus
    data object Synced : SyncStatus
    data object Offline : SyncStatus
    data class Error(val message: String) : SyncStatus
}

data class SyncReport(val downloaded: Int = 0, val uploaded: Int = 0, val merged: Int = 0, val conflicts: List<String> = emptyList(), val deleted: Int = 0)

/**
 * Port of desktop `syncAll` (useServerSync.ts), with base-tracking improvements:
 *  - "Did the server change?" compares the server's modifiedAt against the one recorded at last
 *    sync (server clock vs server clock), so device clock skew can't pick the wrong winner.
 *  - "Did we change?" compares the local body with the base body.
 *  - Remote deletions propagate when the local copy is untouched; offline local deletions are
 *    retried from [SyncBaseStore.pendingDeletes] instead of being resurrected.
 */
class SyncEngine(
    private val store: NoteFileStore,
    private val bases: SyncBaseStore,
) {
    private val mutex = Mutex()
    private val _status = MutableStateFlow<SyncStatus>(SyncStatus.Idle)
    val status: StateFlow<SyncStatus> = _status.asStateFlow()

    fun reset() { _status.value = SyncStatus.Idle }

    suspend fun syncAll(api: GlyphApi, serverUrl: String): SyncReport = mutex.withLock {
        _status.value = SyncStatus.Syncing
        try {
            bases.bindTo(serverUrl)
            var report = SyncReport()

            for (id in bases.pendingDeletes()) {
                api.deleteNote(id)
                bases.clearPendingDelete(id)
            }

            val remote = api.listNotes().filter { com.glyph.folio.model.NoteParsing.isValidId(it.id) }
            val remoteIds = remote.map { it.id }.toSet()
            val local = store.list().associateBy { it.id }

            val gate = Semaphore(6)
            val results = coroutineScope {
                val tasks = remote.map { meta -> async { gate.withPermit { syncRemoteNote(api, meta.id, meta.modifiedAt) } } } +
                    local.values.filter { it.id !in remoteIds }.map { n -> async { gate.withPermit { syncLocalOnly(api, n.id) } } }
                tasks.awaitAll()
            }
            for (r in results) report = SyncReport(
                downloaded = report.downloaded + r.downloaded,
                uploaded = report.uploaded + r.uploaded,
                merged = report.merged + r.merged,
                conflicts = report.conflicts + r.conflicts,
                deleted = report.deleted + r.deleted,
            )
            _status.value = SyncStatus.Synced
            report
        } catch (e: Exception) {
            _status.value = classify(e)
            throw e
        }
    }

    /** Push a single note right after an edit. Failures are fine: the next full sync catches up. */
    suspend fun push(api: GlyphApi, serverUrl: String, id: String) = mutex.withLock {
        val note = store.read(id) ?: return@withLock
        _status.value = SyncStatus.Syncing
        try {
            bases.bindTo(serverUrl)
            val base = bases.get(id)
            if (base != null && base.body == note.body) { _status.value = SyncStatus.Synced; return@withLock }
            if (base != null) {
                // If the server moved on since our base, don't clobber it — let the full sync merge.
                val current = runCatching { api.getNote(id) }.getOrNull()
                if (current != null && current.modifiedAt != base.serverModifiedAt) {
                    mergeAndStore(api, id, base, note.body, current)
                    _status.value = SyncStatus.Synced
                    return@withLock
                }
            }
            upload(api, id, note.body)
            _status.value = SyncStatus.Synced
        } catch (e: Exception) {
            _status.value = classify(e)
        }
    }

    suspend fun delete(api: GlyphApi, id: String) {
        bases.addPendingDelete(id)
        try {
            api.deleteNote(id)
            bases.clearPendingDelete(id)
        } catch (e: Exception) {
            _status.value = classify(e) // retried on next sync
        }
    }

    suspend fun markPendingDelete(id: String) = bases.addPendingDelete(id)

    // ── per-note cases ────────────────────────────────────────────────────────

    private suspend fun syncRemoteNote(api: GlyphApi, id: String, serverModifiedAt: String): SyncReport {
        val local = store.read(id)
        val base = bases.get(id)

        if (local == null) {
            // Only on the server (we never delete locally without queueing a pending delete).
            val remote = api.getNote(id)
            store.write(id, remote.body, parseInstant(remote.modifiedAt))
            bases.set(id, SyncBase(remote.body, remote.modifiedAt))
            return SyncReport(downloaded = 1)
        }

        if (base == null) {
            // No shared history (first sync against this server). Fall back to desktop's rule.
            val remote = api.getNote(id)
            return when {
                remote.body == local.body -> { bases.set(id, SyncBase(remote.body, remote.modifiedAt)); SyncReport() }
                local.modifiedAt > (parseInstant(remote.modifiedAt) ?: Instant.EPOCH) -> { upload(api, id, local.body); SyncReport(uploaded = 1) }
                else -> {
                    store.write(id, remote.body, parseInstant(remote.modifiedAt))
                    bases.set(id, SyncBase(remote.body, remote.modifiedAt))
                    SyncReport(downloaded = 1)
                }
            }
        }

        val serverChanged = serverModifiedAt != base.serverModifiedAt
        val localChanged = local.body != base.body
        return when {
            !serverChanged && !localChanged -> SyncReport()
            !serverChanged -> { upload(api, id, local.body); SyncReport(uploaded = 1) }
            else -> {
                val remote = api.getNote(id)
                when {
                    remote.body == base.body && localChanged -> { upload(api, id, local.body); SyncReport(uploaded = 1) }
                    !localChanged || remote.body == local.body -> {
                        store.write(id, remote.body, parseInstant(remote.modifiedAt))
                        bases.set(id, SyncBase(remote.body, remote.modifiedAt))
                        SyncReport(downloaded = 1)
                    }
                    else -> {
                        val conflicted = mergeAndStore(api, id, base, local.body, remote)
                        SyncReport(merged = 1, conflicts = if (conflicted) listOf(id) else emptyList())
                    }
                }
            }
        }
    }

    private suspend fun syncLocalOnly(api: GlyphApi, id: String): SyncReport {
        val local = store.read(id) ?: return SyncReport()
        val base = bases.get(id)
        return if (base != null && base.body == local.body) {
            // It was synced before and is untouched here, so it was deleted on another device.
            store.delete(id)
            bases.remove(id)
            SyncReport(deleted = 1)
        } else {
            upload(api, id, local.body) // new here, or edited after a remote delete (edit wins)
            SyncReport(uploaded = 1)
        }
    }

    /** Returns true when conflict markers were inserted. */
    private suspend fun mergeAndStore(api: GlyphApi, id: String, base: SyncBase, localBody: String, remote: NoteDto): Boolean {
        val result = Merge3.merge(base.body, localBody, remote.body)
        store.write(id, result.merged)
        upload(api, id, result.merged)
        return result.hasConflicts
    }

    /** PUT, then read back the server's modifiedAt so the base matches what the server holds. */
    private suspend fun upload(api: GlyphApi, id: String, body: String) {
        api.putNote(id, PutNoteDto(body))
        val after = api.getNote(id)
        bases.set(id, SyncBase(body, after.modifiedAt))
    }

    private fun parseInstant(s: String): Instant? = runCatching { Instant.parse(s) }.getOrNull()

    companion object {
        fun classify(e: Throwable): SyncStatus = when (e) {
            is HttpException -> if (e.code() == 401) SyncStatus.Error("Unauthorized — check the auth token")
            else SyncStatus.Error("Server error ${e.code()}")
            is IOException -> SyncStatus.Offline
            else -> SyncStatus.Error(e.message ?: e.javaClass.simpleName)
        }
    }
}
