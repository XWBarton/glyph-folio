package com.glyph.folio.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.glyph.folio.data.sync.SyncStatus

fun SyncStatus.label(): String = when (this) {
    SyncStatus.Idle -> "Local"
    SyncStatus.Syncing -> "Syncing…"
    SyncStatus.Synced -> "Synced"
    SyncStatus.Offline -> "Offline"
    is SyncStatus.Error -> message
}

@Composable
fun SyncStatus.color(): Color = when (this) {
    SyncStatus.Idle -> MaterialTheme.colorScheme.outline
    SyncStatus.Syncing -> Color(0xFFF59E0B)
    SyncStatus.Synced -> Color(0xFF10B981)
    SyncStatus.Offline -> MaterialTheme.colorScheme.outline
    is SyncStatus.Error -> MaterialTheme.colorScheme.error
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncDot(status: SyncStatus, modifier: Modifier = Modifier) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(status.label()) } },
        state = rememberTooltipState(),
    ) {
        Box(modifier.size(10.dp).background(status.color(), CircleShape))
    }
}
