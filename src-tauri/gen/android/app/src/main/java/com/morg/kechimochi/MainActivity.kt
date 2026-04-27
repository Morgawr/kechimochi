package com.morg.kechimochi

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT

    WindowInsetsControllerCompat(window, window.decorView).apply {
      isAppearanceLightStatusBars = false
    }

    applySystemBarsVisibility()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      applySystemBarsVisibility()
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applySystemBarsVisibility()
  }

  private fun applySystemBarsVisibility() {
    val isLandscape =
      resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

    WindowInsetsControllerCompat(window, window.decorView).apply {
      if (isLandscape) {
        systemBarsBehavior =
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        hide(WindowInsetsCompat.Type.systemBars())
      } else {
        show(WindowInsetsCompat.Type.systemBars())
      }
    }
  }
}