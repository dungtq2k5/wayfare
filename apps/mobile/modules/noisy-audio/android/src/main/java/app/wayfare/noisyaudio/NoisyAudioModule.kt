package app.wayfare.noisyaudio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Tells JavaScript when Android reports that the audio output is about to become noisy: headphones
 * unplugged, or a Bluetooth headset disconnected. The player pauses on it, so nothing plays out
 * loud by surprise. expo-audio does not listen for it.
 */
class NoisyAudioModule : Module() {
  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("NoisyAudio")

    Events("onBecomingNoisy")

    OnStartObserving {
      val context = appContext.reactContext ?: return@OnStartObserving
      val registered = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
            sendEvent("onBecomingNoisy")
          }
        }
      }
      context.registerReceiver(registered, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
      receiver = registered
    }

    OnStopObserving {
      receiver?.let { appContext.reactContext?.unregisterReceiver(it) }
      receiver = null
    }
  }
}
