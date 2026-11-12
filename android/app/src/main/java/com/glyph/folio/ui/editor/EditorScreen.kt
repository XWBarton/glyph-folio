package com.glyph.folio.ui.editor

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import com.glyph.folio.ui.components.SyncDot
import com.glyph.folio.ui.theme.EditorFont
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(onBack: () -> Unit, onOpenNote: (String) -> Unit, onPreview: (String) -> Unit) {
    val vm: EditorViewModel = viewModel(factory = EditorViewModel.Factory)
    val status by vm.syncStatus.collectAsState()
    val settings by vm.settings.collectAsState()
    val notes by vm.notes.collectAsState()
    val context = LocalContext.current
    val keyboard = LocalSoftwareKeyboardController.current
    val scope = rememberCoroutineScope()
    val dark = isSystemInDarkTheme()
    val transformation = remember(dark) { TypstVisualTransformation(dark) }
    val focus = remember { FocusRequester() }

    var menu by remember { mutableStateOf(false) }
    var slashOpen by rememberSaveable { mutableStateOf(false) }
    var slashTyped by rememberSaveable { mutableStateOf(false) }
    var wikiOpen by rememberSaveable { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    // Flush pending edits when the app goes to the background.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_STOP) vm.flush() }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }

    fun handle(outcome: EditOutcome) {
        vm.onValueChange(outcome.value)
        when (outcome.trigger) {
            EditorTrigger.SLASH -> { slashTyped = true; slashOpen = true }
            EditorTrigger.WIKILINK -> wikiOpen = true
            EditorTrigger.NONE -> Unit
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(vm.title, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        if (settings.serverEnabled) { Spacer(Modifier.width(10.dp)); SyncDot(status) }
                    }
                },
                navigationIcon = { IconButton(onClick = { vm.flush(); onBack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                actions = {
                    IconButton(onClick = { vm.flush(); onPreview(vm.noteId) }) { Icon(Icons.Default.PictureAsPdf, "Preview PDF") }
                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("Share source") }, leadingIcon = { Icon(Icons.Default.Share, null) },
                            onClick = { menu = false; vm.shareSource(context) })
                        DropdownMenuItem(text = { Text("Delete") }, leadingIcon = { Icon(Icons.Default.Delete, null) },
                            onClick = { menu = false; confirmDelete = true })
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().imePadding()) {
            if (vm.missing) {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("This note no longer exists.") }
                return@Column
            }
            val scroll = rememberScrollState()
            BasicTextField(
                value = vm.value,
                onValueChange = { new -> handle(EditorBehaviors.process(vm.value, new)) },
                visualTransformation = transformation,
                textStyle = TextStyle(
                    fontFamily = EditorFont, fontSize = 15.sp, lineHeight = 23.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = false),
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(scroll)
                    .padding(horizontal = 20.dp, vertical = 12.dp)
                    .focusRequester(focus),
            )

            val link = EditorBehaviors.wikiLinkAt(vm.value)
            val target = link?.let { vm.linkTarget(it) }
            if (link != null) {
                AssistChip(
                    onClick = { if (target != null) { vm.flush(); onOpenNote(target) } },
                    label = { Text(if (target != null) "Open “$link”" else "No note titled “$link”") },
                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.OpenInNew, null) },
                    enabled = target != null,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }

            FormatToolbar(
                onChar = { c -> handle(EditorBehaviors.typeChar(vm.value, c)) },
                onSlash = { slashTyped = false; slashOpen = true },
                onIndent = { out -> vm.onValueChange(EditorBehaviors.indentLine(vm.value, out)) },
                onHideKeyboard = { keyboard?.hide() },
                modifier = Modifier.navigationBarsPadding(),
            )
        }
    }

    if (slashOpen) {
        SlashCommandSheet(
            onDismiss = { slashOpen = false },
            onSelect = { cmd ->
                slashOpen = false
                val base = if (slashTyped) SlashActions.stripSlash(vm.value) else vm.value
                handle(SlashActions.apply(base, cmd))
                focus.requestFocus()
            },
        )
    }
    if (wikiOpen) {
        WikiLinkSheet(
            notes = notes, currentId = vm.noteId,
            onDismiss = { wikiOpen = false },
            onSelect = { title ->
                wikiOpen = false
                vm.onValueChange(EditorBehaviors.insert(vm.value, title).let { v ->
                    // Step over the closing ]] so typing continues after the link.
                    val p = v.selection.start
                    if (v.text.startsWith("]]", p)) v.copy(selection = androidx.compose.ui.text.TextRange(p + 2)) else v
                })
                focus.requestFocus()
            },
        )
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete note?") },
            text = { Text("“${vm.title}” will be deleted from this device" + if (settings.serverEnabled) " and the server." else ".") },
            confirmButton = {
                TextButton(onClick = { confirmDelete = false; scope.launch { vm.delete(); onBack() } }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}
