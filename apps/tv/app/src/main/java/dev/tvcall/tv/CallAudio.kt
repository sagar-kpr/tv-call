package dev.tvcall.tv

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRecorder
import io.livekit.android.AudioOptions
import io.livekit.android.AudioType
import io.livekit.android.LiveKitOverrides
import io.livekit.android.audio.AudioFocusHandler

internal object CallAudio {
    /** TV firmware often has media/USB paths but no working telephony path.
     * Phones keep LiveKit's normal communication mode and headset routing. */
    fun overrides(context: Context, tvCompatibility: Boolean): LiveKitOverrides =
        if (!tvCompatibility) LiveKitOverrides() else LiveKitOverrides(audioOptions = AudioOptions(
            audioOutputType = AudioType.MediaAudioType(),
            audioHandler = AudioFocusHandler(context.applicationContext),
            disableAudioPrewarming = true,
            javaAudioDeviceModuleCustomizer = { builder ->
                builder.setAudioSource(MediaRecorder.AudioSource.MIC)
                    .setUseHardwareAcousticEchoCanceler(false)
                    .setUseHardwareNoiseSuppressor(false)
                // LiveKit's software echo cancellation/noise suppression stay on.
            },
        ))

    fun inputDescription(context: Context): String {
        val manager = context.getSystemService(AudioManager::class.java)
        val inputs = manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .map { label(it.type) }.distinct()
        return if (inputs.isEmpty()) "No Android microphone input detected" else "Available inputs: ${inputs.joinToString(", ")}"
    }
    fun hasUsbInput(context: Context): Boolean = context.getSystemService(AudioManager::class.java)
        .getDevices(AudioManager.GET_DEVICES_INPUTS).any {
            it.type in listOf(AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_ACCESSORY)
        }
    fun recordingRoute(context: Context): String {
        val manager = context.getSystemService(AudioManager::class.java)
        return runCatching {
            manager.activeRecordingConfigurations.firstOrNull()?.audioDevice?.let { label(it.type) }
        }.getOrNull() ?: "not reported"
    }
    private fun label(type: Int): String = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_MIC -> "built-in mic"
        AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB mic"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET -> "Bluetooth mic"
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> "headset mic"
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
        else -> "audio input type $type"
    }
}
