package com.glyph.folio.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.FormatIndentDecrease
import androidx.compose.material.icons.automirrored.filled.FormatIndentIncrease
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.KeyboardHide
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.glyph.folio.model.Note
import com.glyph.folio.ui.theme.EditorFont

@Composable
fun FormatToolbar(
    onChar: (Char) -> Unit,
    onSlash: () -> Unit,
    onIndent: (outdent: Boolean) -> Unit,
    onHideKeyboard: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(tonalElevation = 3.dp, modifier = modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 4.dp)) {
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                ToolKey("/", onSlash, emphasised = true)
                "=*_-+[(#\$@".forEach { c -> ToolKey(c.toString(), { onChar(c) }) }
                IconButton(onClick = { onIndent(true) }) { Icon(Icons.AutoMirrored.Filled.FormatIndentDecrease, "Outdent") }
                IconButton(onClick = { onIndent(false) }) { Icon(Icons.AutoMirrored.Filled.FormatIndentIncrease, "Indent") }
            }
            IconButton(onClick = onHideKeyboard) { Icon(Icons.Default.KeyboardHide, "Hide keyboard") }
        }
    }
}

@Composable
private fun ToolKey(label: String, onClick: () -> Unit, emphasised: Boolean = false) {
    Box(
        Modifier.padding(horizontal = 2.dp, vertical = 6.dp).size(width = 38.dp, height = 36.dp)
            .background(
                if (emphasised) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHighest,
                RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label, fontFamily = EditorFont, fontWeight = FontWeight.Bold,
            color = if (emphasised) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SlashCommandSheet(onDismiss: () -> Unit, onSelect: (SlashCommand) -> Unit) {
    var search by remember { mutableStateOf("") }
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column {
            Text("Insert block", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 20.dp))
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = search, onValueChange = { search = it },
                placeholder = { Text("Search commands…") }, singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, null) },
                shape = RoundedCornerShape(28.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            )
            val pool = if (search.isBlank()) allSlashCommands else allSlashCommands.filter {
                it.name.contains(search, true) || it.category.contains(search, true) ||
                    it.description.contains(search, true) || it.id.contains(search, true)
            }
            val grouped = pool.groupBy { it.category }
            LazyColumn(Modifier.padding(top = 8.dp, bottom = 16.dp)) {
                slashCategoryOrder.forEach { cat ->
                    val cmds = grouped[cat] ?: return@forEach
                    item(key = "h-$cat") {
                        Text(cat, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(start = 20.dp, top = 12.dp, bottom = 4.dp))
                    }
                    items(cmds, key = { it.id }) { cmd ->
                        ListItem(
                            headlineContent = { Text(cmd.name) },
                            supportingContent = { Text(cmd.description) },
                            leadingContent = {
                                Box(Modifier.size(36.dp).background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                                    Icon(cmd.icon, null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                                }
                            },
                            colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                            modifier = Modifier.clickable { onSelect(cmd) },
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WikiLinkSheet(notes: List<Note>, currentId: String, onDismiss: () -> Unit, onSelect: (String) -> Unit) {
    var search by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Text("Link a note", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 20.dp))
        OutlinedTextField(
            value = search, onValueChange = { search = it }, singleLine = true,
            placeholder = { Text("Note title…") }, leadingIcon = { Icon(Icons.Default.Search, null) },
            shape = RoundedCornerShape(28.dp),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
        )
        val pool = notes.filter { it.id != currentId && (search.isBlank() || it.title.contains(search, true)) }
        LazyColumn(Modifier.padding(bottom = 16.dp)) {
            items(pool, key = { it.id }) { n ->
                ListItem(
                    headlineContent = { Text(n.title) },
                    leadingContent = { Icon(Icons.Default.Description, null) },
                    modifier = Modifier.clickable { onSelect(n.title) },
                )
                HorizontalDivider()
            }
        }
    }
}
