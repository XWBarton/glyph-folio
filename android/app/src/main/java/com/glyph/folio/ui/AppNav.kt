package com.glyph.folio.ui

import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.glyph.folio.ui.editor.EditorScreen
import com.glyph.folio.ui.notes.NotesListScreen
import com.glyph.folio.ui.pdf.PdfPreviewScreen
import com.glyph.folio.ui.settings.SettingsScreen

@Composable
fun AppNav() {
    val nav = rememberNavController()
    NavHost(nav, startDestination = "notes") {
        composable("notes") {
            NotesListScreen(
                onOpen = { nav.navigate("editor/$it") },
                onSettings = { nav.navigate("settings") },
            )
        }
        composable("editor/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) {
            EditorScreen(
                onBack = { nav.popBackStack() },
                onOpenNote = { id -> nav.navigate("editor/$id") },
                onPreview = { id -> nav.navigate("pdf/$id") },
            )
        }
        composable("pdf/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) {
            PdfPreviewScreen(onBack = { nav.popBackStack() })
        }
        composable("settings") { SettingsScreen(onBack = { nav.popBackStack() }) }
    }
}
