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
    private val retryFocus = Runnable { focusController.retry() }
    private val focusController: RingtoneFocusController = RingtoneFocusController(
        request = { runCatching { focus?.let { audio.requestAudioFocus(it) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED } ?: false }.getOrDefault(false) },
        resume = {
            try {
                if (!audio.isVolumeFixed && ringVolume == null) {
                    val boost = RingVolume(audio.getStreamVolume(AudioManager.STREAM_MUSIC), audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC))
                    ringVolume = boost
                    audio.setStreamVolume(AudioManager.STREAM_MUSIC, boost.raised, 0)
                }
                player?.setVolume(1f, 1f); player?.start()
            } catch (_: Exception) { stop(); DebugEvents.add(context, "Ringtone could not resume") }
        },
        pause = { runCatching { player?.let { if (it.isPlaying) it.pause() } } },
        schedule = { main.postDelayed(retryFocus, 1_000) },
        cancel = { main.removeCallbacks(retryFocus) }
    )
    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()

    fun start() {
        if (player != null) return
        try {
            val resource = context.resources.getIdentifier("homeping_ring", "raw", context.packageName)
            check(resource != 0) { "Ringtone resource missing" }
            lateinit var request: AudioFocusRequest
            request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                .setAudioAttributes(attributes)
                .setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener({ change ->
                    if (focus === request) when (change) {
                        AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> focusController.lost()
                        AudioManager.AUDIOFOCUS_GAIN -> focusController.gained()
                    }
                }, main).build()
            focus = request
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
                    focusController.start()
                    DebugEvents.add(context, "Incoming ringtone prepared; requesting exclusive audio focus")
                }
            }
            candidate.prepareAsync()
        } catch (_: Exception) {
            stop(); DebugEvents.add(context, "Ringtone unavailable; check TV sound output and media volume")
        }
    }
    fun stop() {
        focusController.close()
        val old = player; player = null
        runCatching { old?.setOnPreparedListener(null); old?.setOnErrorListener(null); old?.release() }
        val request = focus; focus = null
        if (request != null) runCatching { audio.abandonAudioFocusRequest(request) }
        val boost = ringVolume; ringVolume = null
        if (boost != null) runCatching { boost.restore(audio.getStreamVolume(AudioManager.STREAM_MUSIC))?.let { audio.setStreamVolume(AudioManager.STREAM_MUSIC, it, 0) } }
        if (old != null) DebugEvents.add(context, "Incoming ringtone stopped")
    }
}
