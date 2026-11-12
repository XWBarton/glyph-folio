package com.glyph.folio.data.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.glyph.folio.GlyphApp
import kotlinx.coroutines.flow.first

/** Background sync every ~15 minutes while the device has network. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val repo = (applicationContext as GlyphApp).container.notes
        repo.loaded.first { it }
        if (!repo.settings.value.serverEnabled) return Result.success()
        return if (repo.syncNow().isSuccess) Result.success() else Result.retry()
    }
}
