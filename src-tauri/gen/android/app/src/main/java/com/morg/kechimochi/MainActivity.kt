package com.morg.kechimochi

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.webkit.JavascriptInterface
import android.webkit.WebView

class MainActivity : TauriActivity() {

    private lateinit var webView: WebView
    private val TAG = "MainActivity"

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        this.webView = webView
        Log.d(TAG, "WebView created, adding JavascriptInterface")
        try {
            // Add MainActivity itself as JavaScript interface for status bar control
            this.webView.addJavascriptInterface(this, "AndroidStatusBar")
            Log.d(TAG, "JavascriptInterface added successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to add JavascriptInterface", e)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "onCreate")

        try {
            WindowCompat.setDecorFitsSystemWindows(window, false)
            window.statusBarColor = Color.TRANSPARENT
            window.navigationBarColor = Color.TRANSPARENT

            WindowInsetsControllerCompat(window, window.decorView).apply {
                isAppearanceLightStatusBars = false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in onCreate window setup", e)
        }

        try {
            applySystemBarsVisibility()
        } catch (e: Exception) {
            Log.e(TAG, "Error in applySystemBarsVisibility", e)
        }
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
        try {
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
        } catch (e: Exception) {
            Log.e(TAG, "applySystemBarsVisibility error", e)
        }
    }

    @JavascriptInterface
    fun postMessage(isLight: Boolean) {
        Log.d(TAG, "postMessage: isLight=$isLight")
        setStatusBar(isLight)
    }

    fun setStatusBar(isLight: Boolean) {
        Log.d(TAG, "setStatusBar: isLight=$isLight")
        runOnUiThread {
            try {
                val controller = WindowCompat.getInsetsController(window, window.decorView)
                if (controller != null) {
                    controller.isAppearanceLightStatusBars = isLight
                    Log.d(TAG, "setStatusBar: success")
                } else {
                    Log.w(TAG, "setStatusBar: controller is null")
                }
            } catch (e: Exception) {
                Log.e(TAG, "setStatusBar error", e)
            }
        }
    }
}