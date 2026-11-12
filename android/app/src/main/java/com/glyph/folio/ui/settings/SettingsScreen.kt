package com.glyph.folio.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.glyph.folio.BuildConfig
import com.glyph.folio.data.NoteRepository
import com.glyph.folio.data.settings.AppSettings
import com.glyph.folio.data.settings.CitationStyle
import com.glyph.folio.data.settings.SyncMode
import com.glyph.folio.ui.components.SyncDot
import com.glyph.folio.ui.components.container
import com.glyph.folio.ui.components.label
import kotlinx.coroutines.launch

class SettingsViewModel(val repo: NoteRepository) : ViewModel() {
    companion object {
        val Factory = viewModelFactory { initializer { SettingsViewModel(container.notes) } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val vm: SettingsViewModel = viewModel(factory = SettingsViewModel.Factory)
    val saved by vm.repo.settings.collectAsState()
    val status by vm.repo.syncStatus.collectAsState()
    var draft by remember { mutableStateOf<AppSettings?>(null) }
    LaunchedEffect(saved) { if (draft == null) draft = saved }
    val d = draft ?: saved
    val scope = rememberCoroutineScope()
    var testing by remember { mutableStateOf(false) }
    var testResult by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    var syncMessage by remember { mutableStateOf<String?>(null) }
    var showToken by remember { mutableStateOf(false) }

    fun update(s: AppSettings) { draft = s; testResult = null; scope.launch { vm.repo.saveSettings(s) } }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Settings") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Section("Storage") {
                Text("Local keeps notes on this device only. Server syncs with your Glyph Folio server.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(12.dp))
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    SyncMode.entries.forEachIndexed { i, m ->
                        SegmentedButton(
                            selected = d.syncMode == m,
                            onClick = { update(d.copy(syncMode = m)) },
                            shape = SegmentedButtonDefaults.itemShape(i, SyncMode.entries.size),
                        ) { Text(if (m == SyncMode.LOCAL) "Local" else "Server") }
                    }
                }
            }

            if (d.syncMode == SyncMode.SERVER) Section("Server") {
                OutlinedTextField(
                    value = d.serverUrl, onValueChange = { draft = d.copy(serverUrl = it); testResult = null },
                    label = { Text("Server URL") }, placeholder = { Text("http://192.168.1.10:3001") },
                    singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = d.authToken, onValueChange = { draft = d.copy(authToken = it); testResult = null },
                    label = { Text("Auth token (optional)") }, singleLine = true,
                    visualTransformation = if (showToken) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { showToken = !showToken }) {
                            Icon(if (showToken) Icons.Default.VisibilityOff else Icons.Default.Visibility, "Show token")
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = d != saved,
                        onClick = { scope.launch { vm.repo.saveSettings(d) } },
                    ) { Text("Save") }
                    FilledTonalButton(
                        enabled = d.serverUrl.isNotBlank() && !testing,
                        onClick = {
                            scope.launch {
                                testing = true
                                testResult = vm.repo.testConnection(d).fold({ true to it }, { false to (it.message ?: "Couldn’t connect") })
                                testing = false
                            }
                        },
                    ) {
                        if (testing) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text("Test connection")
                    }
                }
                testResult?.let { (ok, msg) ->
                    Spacer(Modifier.height(8.dp))
                    Text(msg, color = if (ok) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium)
                }
                if (saved.serverEnabled) {
                    Spacer(Modifier.height(16.dp))
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        SyncDot(status); Spacer(Modifier.width(8.dp))
                        Text(status.label(), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        FilledTonalButton(onClick = {
                            scope.launch {
                                syncMessage = vm.repo.syncNow().fold(
                                    { r -> "↓${r.downloaded} ↑${r.uploaded}" + (if (r.merged > 0) " · merged ${r.merged}" else "") +
                                        (if (r.conflicts.isNotEmpty()) " · conflicts in ${r.conflicts.size}" else "") },
                                    { it.message ?: "Sync failed" },
                                )
                            }
                        }) { Text("Sync now") }
                    }
                    syncMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }

            Section("PDF") {
                Text("Citation style", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    CitationStyle.entries.forEachIndexed { i, c ->
                        SegmentedButton(
                            selected = d.citationStyle == c,
                            onClick = { update(d.copy(citationStyle = c)) },
                            shape = SegmentedButtonDefaults.itemShape(i, CitationStyle.entries.size),
                        ) { Text(c.label) }
                    }
                }
            }

            Text("Glyph Folio ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp))
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(12.dp))
            content()
        }
    }
}
