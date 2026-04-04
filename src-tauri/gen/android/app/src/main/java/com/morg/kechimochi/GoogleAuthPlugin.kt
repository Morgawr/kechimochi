package com.morg.kechimochi

import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope

private const val GOOGLE_DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata"
private const val GOOGLE_OPENID_SCOPE = "openid"
private const val GOOGLE_USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email"
private const val GOOGLE_USERINFO_PROFILE_SCOPE = "https://www.googleapis.com/auth/userinfo.profile"

@InvokeArg
class ClearTokenArgs {
  lateinit var accessToken: String
}

@TauriPlugin
class GoogleAuthPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun authorizeGoogleDrive(invoke: Invoke) {
    val authorizationRequest = AuthorizationRequest.builder()
      .setRequestedScopes(
        listOf(
          Scope(GOOGLE_DRIVE_APPDATA_SCOPE),
          Scope(GOOGLE_OPENID_SCOPE),
          Scope(GOOGLE_USERINFO_EMAIL_SCOPE),
          Scope(GOOGLE_USERINFO_PROFILE_SCOPE),
        )
      )
      .build()

    Identity.getAuthorizationClient(activity)
      .authorize(authorizationRequest)
      .addOnSuccessListener { authorizationResult ->
        val pendingIntent = authorizationResult.pendingIntent
        if (pendingIntent == null) {
          resolveAuthorizationResult(invoke, authorizationResult)
          return@addOnSuccessListener
        }

        startIntentSenderForResult(
          invoke,
          IntentSenderRequest.Builder(pendingIntent.intentSender).build(),
          "onAuthorizationResult"
        )
      }
      .addOnFailureListener { error ->
        invoke.reject(error.localizedMessage ?: "Google Drive authorization failed.")
      }
  }

  @Command
  fun clearToken(invoke: Invoke) {
    val args = invoke.parseArgs(ClearTokenArgs::class.java)
    if (args.accessToken.isBlank()) {
      invoke.reject("Google Drive token is missing.")
      return
    }

    Identity.getAuthorizationClient(activity)
      .clearToken(ClearTokenRequest.builder().setToken(args.accessToken).build())
      .addOnSuccessListener {
        invoke.resolve()
      }
      .addOnFailureListener { error ->
        invoke.reject(error.localizedMessage ?: "Failed to clear the Google Drive token cache.")
      }
  }

  @ActivityCallback
  fun onAuthorizationResult(invoke: Invoke, result: ActivityResult) {
    try {
      val resultIntent = result.data
      if (resultIntent == null) {
        if (result.resultCode == Activity.RESULT_CANCELED) {
          invoke.reject("Google Drive authorization was cancelled.")
          return
        }

        invoke.reject("Google Drive authorization did not return a result.")
        return
      }

      val authorizationResult = Identity.getAuthorizationClient(activity)
        .getAuthorizationResultFromIntent(resultIntent)
      resolveAuthorizationResult(invoke, authorizationResult)
    } catch (error: ApiException) {
      if (error.statusCode == CommonStatusCodes.CANCELED) {
        invoke.reject("Google Drive authorization was cancelled.")
        return
      }

      invoke.reject(error.localizedMessage ?: "Google Drive authorization failed.")
    }
  }

  private fun resolveAuthorizationResult(invoke: Invoke, authorizationResult: AuthorizationResult) {
    val accessToken = authorizationResult.accessToken
    if (accessToken.isNullOrBlank()) {
      invoke.reject("Google Drive authorization did not return an access token.")
      return
    }

    invoke.resolve(JSObject().apply {
      put("accessToken", accessToken)
    })
  }
}
