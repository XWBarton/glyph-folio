package com.glyph.folio.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily

private val Light = lightColorScheme(
    primary = Color(0xFF1D4ED8), onPrimary = Color.White,
    primaryContainer = Color(0xFFDBE4FF), onPrimaryContainer = Color(0xFF0B1E5B),
    secondary = Color(0xFF7C3AED), tertiary = Color(0xFF0F766E),
    background = Color(0xFFF8FAFC), surface = Color(0xFFF8FAFC),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF93B4FF), onPrimary = Color(0xFF0B1E5B),
    primaryContainer = Color(0xFF1E3A8A), onPrimaryContainer = Color(0xFFDBE4FF),
    secondary = Color(0xFFA78BFA), tertiary = Color(0xFF2DD4BF),
    background = Color(0xFF0F1117), surface = Color(0xFF0F1117),
)

val EditorFont = FontFamily.Monospace

@Composable
fun GlyphTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val ctx = LocalContext.current
            if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        }
        dark -> Dark
        else -> Light
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
