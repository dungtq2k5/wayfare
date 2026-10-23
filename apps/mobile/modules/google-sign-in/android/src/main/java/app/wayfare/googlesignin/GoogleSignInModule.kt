package app.wayfare.googlesignin

import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Continue with Google through Credential Manager (ADR 0062): the button's flow, which always shows
 * Google's chooser, with the server's nonce in the token. Rejects with `CANCELLED` when the chooser
 * is closed, `NO_ACCOUNT` when the phone has no Google account, and `FAILED` otherwise.
 */
class GoogleSignInModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GoogleSignIn")

    AsyncFunction("signIn") Coroutine { serverClientId: String, nonce: String ->
      val activity = appContext.currentActivity
        ?: throw CodedException("FAILED", "No activity to show the chooser over", null)
      val option = GetSignInWithGoogleOption.Builder(serverClientId).setNonce(nonce).build()
      val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
      val credential = try {
        CredentialManager.create(activity).getCredential(activity, request).credential
      } catch (error: GetCredentialCancellationException) {
        throw CodedException("CANCELLED", error.message, error)
      } catch (error: NoCredentialException) {
        throw CodedException("NO_ACCOUNT", error.message, error)
      } catch (error: GetCredentialException) {
        throw CodedException("FAILED", error.message, error)
      }
      if (credential !is CustomCredential ||
        credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
      ) {
        throw CodedException("FAILED", "Not a Google ID token", null)
      }
      val google = GoogleIdTokenCredential.createFrom(credential.data)
      mapOf("idToken" to google.idToken, "email" to google.id)
    }

    // Signing out forgets the pick: the next tap shows the chooser again (frame S1g).
    AsyncFunction("signOut") Coroutine { ->
      val context = appContext.reactContext ?: return@Coroutine
      CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest())
    }
  }
}
