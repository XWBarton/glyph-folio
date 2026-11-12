package com.glyph.folio.ui.components

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import com.glyph.folio.AppContainer
import com.glyph.folio.GlyphApp

val CreationExtras.container: AppContainer get() = (this[APPLICATION_KEY] as GlyphApp).container
