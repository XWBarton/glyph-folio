package com.glyph.folio

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.glyph.folio.ui.AppNav
import com.glyph.folio.ui.theme.GlyphTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val repo = (application as GlyphApp).container.notes

        // Sync on launch/resume, then every 60s while the app is visible (same cadence as desktop).
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                repo.loaded.first { it }
                while (true) {
                    if (repo.settings.value.serverEnabled) repo.syncNow()
                    delay(60_000)
                }
            }
        }
        setContent { GlyphTheme { AppNav() } }
    }
}
