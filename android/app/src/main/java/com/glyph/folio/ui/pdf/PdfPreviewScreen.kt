package com.glyph.folio.ui.pdf

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color as AColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.glyph.folio.data.NoteRepository
import com.glyph.folio.ui.components.container
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

sealed interface PdfState {
    data object Loading : PdfState
    data class Ready(val file: File, val pages: List<Bitmap>) : PdfState
    data class Failed(val message: String) : PdfState
}

class PdfViewModel(private val repo: NoteRepository, handle: SavedStateHandle, private val cacheDir: File) : ViewModel() {
    val noteId: String = checkNotNull(handle["id"])
    var state by mutableStateOf<PdfState>(PdfState.Loading)
        private set
    var title by mutableStateOf("Preview")
        private set

    init { compile() }

    fun compile() = viewModelScope.launch {
        state = PdfState.Loading
        val note = repo.load(noteId) ?: run { state = PdfState.Failed("Note not found"); return@launch }
        title = note.title
        state = repo.compilePdf(note).fold(
            onSuccess = { bytes ->
                withContext(Dispatchers.IO) {
                    val f = File(cacheDir, "pdf/$noteId.pdf").apply { parentFile?.mkdirs(); writeBytes(bytes) }
                    PdfState.Ready(f, render(f))
                }
            },
            onFailure = { PdfState.Failed(it.message ?: "Compilation failed") },
        )
    }

    private fun render(f: File, widthPx: Int = 1600): List<Bitmap> =
        ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { r ->
                (0 until r.pageCount).map { i ->
                    r.openPage(i).use { p ->
                        val h = (widthPx.toFloat() * p.height / p.width).toInt()
                        Bitmap.createBitmap(widthPx, h, Bitmap.Config.ARGB_8888).also { bmp ->
                            bmp.eraseColor(AColor.WHITE)
                            p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        }
                    }
                }
            }
        }

    fun share(context: Context) {
        val f = (state as? PdfState.Ready)?.file ?: return
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", f)
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "Share PDF"))
    }

    companion object {
        val Factory = viewModelFactory {
            initializer {
                val c = container
                PdfViewModel(c.notes, createSavedStateHandle(), (this[androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY]!!).cacheDir)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PdfPreviewScreen(onBack: () -> Unit) {
    val vm: PdfViewModel = viewModel(factory = PdfViewModel.Factory)
    val context = LocalContext.current
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(vm.title) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                actions = {
                    IconButton(onClick = { vm.compile() }) { Icon(Icons.Default.Refresh, "Recompile") }
                    if (vm.state is PdfState.Ready) IconButton(onClick = { vm.share(context) }) { Icon(Icons.Default.Share, "Share PDF") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainer)) {
            when (val s = vm.state) {
                PdfState.Loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                is PdfState.Failed -> CompileError(s.message, onRetry = { vm.compile() })
                is PdfState.Ready -> ZoomablePages(s.pages)
            }
        }
    }
}

@Composable
private fun ZoomablePages(pages: List<Bitmap>) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    val transform = rememberTransformableState { zoom, pan, _ ->
        scale = (scale * zoom).coerceIn(1f, 4f)
        offsetX = if (scale == 1f) 0f else offsetX + pan.x
    }
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
            .transformable(transform, lockRotationOnZoomPan = true)
            .graphicsLayer { scaleX = scale; scaleY = scale; translationX = offsetX },
    ) {
        itemsIndexed(pages) { _, bmp ->
            Surface(shadowElevation = 3.dp, shape = RoundedCornerShape(4.dp)) {
                Image(bmp.asImageBitmap(), contentDescription = null, contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun CompileError(message: String, onRetry: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(32.dp))
        Icon(Icons.Default.ErrorOutline, null, tint = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(12.dp))
        Text("Couldn’t compile this note", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(16.dp))
        Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
            SelectionContainer {
                Text(message, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.padding(16.dp))
            }
        }
        Spacer(Modifier.height(16.dp))
        FilledTonalButton(onClick = onRetry) { Text("Try again") }
    }
}
