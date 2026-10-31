package dev.tvcall.tv

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper

/** A bundled local ringtone: TV firmware need not provide notification sounds.
 * Raises media volume while ringing and restores it unless the user changes it. */
internal class IncomingRinger(private val context: Context) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var focus: AudioFocusRequest? = null
    private var ringVolume: RingVolume? = null
    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()

    fun start() {
        if (player != null) return
        try {
            val resource = context.resources.getIdentifier("homeping_ring", "raw", context.packageName)
            check(resource != 0) { "Ringtone resource missing" }
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener({ change ->
                    when (change) {
                        AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> stop()
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> player?.setVolume(.2f, .2f)
                        AudioManager.AUDIOFOCUS_GAIN -> player?.setVolume(1f, 1f)
                    }
                }, main).build()
            focus = request
            if (audio.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                stop(); DebugEvents.add(context, "Ringtone unavailable: audio focus not granted"); return
            }
            if (!audio.isVolumeFixed) {
                val boost = RingVolume(audio.getStreamVolume(AudioManager.STREAM_MUSIC), audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC))
                ringVolume = boost
                audio.setStreamVolume(AudioManager.STREAM_MUSIC, boost.raised, 0)
            }
            val candidate = MediaPlayer(); player = candidate
            candidate.setAudioAttributes(attributes)
            candidate.setDataSource(context, Uri.parse("android.resource://${context.packageName}/$resource"))
            candidate.isLooping = true
            candidate.setVolume(1f, 1f)
            candidate.setOnErrorListener { _, _, _ ->
                if (player === candidate) { stop(); DebugEvents.add(context, "Ringtone playback failed; prompt remains available") }
                true
            }
            candidate.setOnPreparedListener {
                // Release/cancellation can happen while prepareAsync is pending.
                if (player === candidate) {
                    try { candidate.start(); DebugEvents.add(context, "Incoming ringtone started") }
                    catch (_: Exception) { stop(); DebugEvents.add(context, "Ringtone could not start") }
                }
            }
            candidate.prepareAsync()
        } catch (_: Exception) {
            stop(); DebugEvents.add(context, "Ringtone unavailable; check TV sound output and media volume")
        }
    }
    fun stop() {
        val old = player; player = null
        runCatching { old?.setOnPreparedListener(null); old?.setOnErrorListener(null); old?.release() }
        val request = focus; focus = null
        if (request != null) runCatching { audio.abandonAudioFocusRequest(request) }
        val boost = ringVolume; ringVolume = null
        if (boost != null) runCatching { boost.restore(audio.getStreamVolume(AudioManager.STREAM_MUSIC))?.let { audio.setStreamVolume(AudioManager.STREAM_MUSIC, it, 0) } }
        if (old != null) DebugEvents.add(context, "Incoming ringtone stopped")
    }
}
