package dev.tvcall.tv

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.app.AlertDialog
import android.media.AudioManager
import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.RemoteAudioTrack
import livekit.org.webrtc.AudioTrackSink
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.renderer.SurfaceViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.LocalVideoTrackOptions
import io.livekit.android.room.track.Track
import io.livekit.android.room.participant.VideoTrackPublishDefaults
import io.livekit.android.room.track.VideoEncoding
import io.livekit.android.room.track.VideoCaptureParameter
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.*
import org.json.JSONObject

/** Shared native video screen used by TV acceptance and the React Native caller. */
class CallActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var api: CallApi
    private var id = ""
    private var accepted = false
    private var acceptedAt = 0L
    private var savingVideoData = false
    private var ending = false
    private var connected = false
    private var connecting = true
    private val remoteGuard = TvRemoteGuard(SystemClock.elapsedRealtime())
    private var endConfirmation: AlertDialog? = null
    private var started = false
    private var micOn = false
    private var cameraOn = false
    private val micLevel = AudioLevel()
    private val incomingLevel = AudioLevel()
    private val micSink = AudioTrackSink { data, bits, _, _, _, _ -> micLevel.accept(data, bits) }
    private val incomingSink = AudioTrackSink { data, bits, _, _, _, _ -> incomingLevel.accept(data, bits) }
    private var localAudio: LocalAudioTrack? = null
    private var remoteAudio: RemoteAudioTrack? = null
    private lateinit var audioStatus: TextView
    private lateinit var remotePlaceholder: TextView
    private lateinit var connectionLoader: android.widget.ProgressBar
    private var tvCompatibility = false
    private var room: Room? = null
    private var localTrack: VideoTrack? = null
    private var remoteTrack: VideoTrack? = null
    private var rendererReady = false
    private lateinit var remote: SurfaceViewRenderer
    private lateinit var local: SurfaceViewRenderer
    private lateinit var status: TextView
    private lateinit var mic: Button
    private lateinit var camera: Button
    private lateinit var switch: Button
    private lateinit var end: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        id = intent.getStringExtra("callId") ?: run { finish(); return }
        api = CallApi(this, intent.getStringExtra("callerToken"), intent.getStringExtra("callerRefresh"), intent.getStringExtra("apiKey"))
        if (!api.caller) TvCallScreen.prepare(this)
        for (key in listOf("callerToken", "callerRefresh", "apiKey")) intent.removeExtra(key)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_SECURE)
        val layout = if (api.caller) Ui.column(this).apply { setPadding(24, 12, 24, 12) }
            else TvUi.screen(this).apply { setPadding(TvUi.dp(context, 32), TvUi.dp(context, 20), TvUi.dp(context, 32), TvUi.dp(context, 24)) }
        status = if (api.caller) Ui.text(this, "Connecting your call…", 18f) else TvUi.text(this, "Connecting your call…", 16f)
        connectionLoader = android.widget.ProgressBar(this).apply { indeterminateTintList = android.content.res.ColorStateList.valueOf(if (api.caller) android.graphics.Color.rgb(36, 78, 58) else TvUi.accent) }
        if (api.caller) {
            layout.addView(status)
            layout.addView(connectionLoader, LinearLayout.LayoutParams(TvUi.dp(this, 24), TvUi.dp(this, 24)))
        } else {
            val header = LinearLayout(this).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
            header.addView(TvUi.brand(this))
            header.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
            header.addView(connectionLoader, LinearLayout.LayoutParams(TvUi.dp(this, 20), TvUi.dp(this, 20)).apply { marginEnd = TvUi.dp(this@CallActivity, 12) })
            status.apply {
                maxWidth = TvUi.dp(this@CallActivity, 480)
                gravity = android.view.Gravity.END or android.view.Gravity.CENTER_VERTICAL
                // Neutral initial focus absorbs acceptance presses without drawing a full-width focus box.
                isFocusable = true; isFocusableInTouchMode = true; defaultFocusHighlightEnabled = false
            }
            header.addView(status, LinearLayout.LayoutParams(-2, -2))
            layout.addView(header, LinearLayout.LayoutParams(-1, -2))
        }
        tvCompatibility = !api.caller && Backend.tvAudioCompatibility(this)
        volumeControlStream = if (tvCompatibility) AudioManager.STREAM_MUSIC else AudioManager.STREAM_VOICE_CALL
        audioStatus = Ui.text(this, "Audio: waiting for connection", 14f); if (api.caller) layout.addView(audioStatus)
        val stage = android.widget.FrameLayout(this)
        remote = SurfaceViewRenderer(this).apply { contentDescription = "Remote video"; isFocusable = false }
        local = SurfaceViewRenderer(this).apply { contentDescription = "Your camera"; isFocusable = false; setZOrderMediaOverlay(true) }
        stage.addView(remote, android.widget.FrameLayout.LayoutParams(-1, -1))
        remotePlaceholder = (if (api.caller) Ui.text(this, "Waiting for TV video…", 16f) else TvUi.text(this, "Waiting for caller video…", 18f, true)).apply { gravity = android.view.Gravity.CENTER }
        stage.addView(remotePlaceholder, android.widget.FrameLayout.LayoutParams(-1, -1))
        stage.addView(local, android.widget.FrameLayout.LayoutParams(if (api.caller) 240 else TvUi.dp(this, 176), if (api.caller) 135 else TvUi.dp(this, 99), android.view.Gravity.BOTTOM or android.view.Gravity.END).apply {
            if (!api.caller) { bottomMargin = TvUi.dp(this@CallActivity, 12); marginEnd = TvUi.dp(this@CallActivity, 12) }
        })
        layout.addView(stage, LinearLayout.LayoutParams(-1, 0, 1f).apply {
            if (!api.caller) { topMargin = TvUi.dp(this@CallActivity, 16); bottomMargin = TvUi.dp(this@CallActivity, 20) }
        })
        val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER }
        fun control(label: String, danger: Boolean = false, click: () -> Unit): Button = if (api.caller) Ui.button(this, label, click) else TvUi.button(this, label, danger = danger, click = click)
        mic = control( "Enable mic") { toggle(false) }
        camera = control( "Enable camera") { toggle(true) }
        switch = control( "Switch camera") { (localTrack as? LocalVideoTrack)?.switchCamera() }
        end = control( "End call", danger = true) { requestEndCall() }
        val audio = Ui.button(this, "Audio info") { showAudioInfo() }
        for (button in if (api.caller) listOf(mic, camera, switch, audio, end) else listOf(mic, camera, switch, end))
            controls.addView(button, if (api.caller) LinearLayout.LayoutParams(0, -2, 1f) else LinearLayout.LayoutParams(TvUi.dp(this, 160), TvUi.dp(this, 56)).apply {
                marginStart = TvUi.dp(this@CallActivity, 8); marginEnd = TvUi.dp(this@CallActivity, 8)
            })
        layout.addView(controls, LinearLayout.LayoutParams(-1, -2)); setContentView(layout)
        if (api.caller) end.requestFocus() else {
            status.isFocusable = true; status.isFocusableInTouchMode = true
            status.requestFocus()
        }
        controlsEnabled(false)
        scope.launch {
            try {
                val call = withContext(Dispatchers.IO) { if (api.caller) api.request("/calls/$id") else api.action(id, "accept") }
                check(call.optString("status") == "accepted") { "Invitation is no longer available" }
                accepted = true; acceptedAt = call.optLong("acceptedAt", System.currentTimeMillis()); savingVideoData = VideoQualityPolicy.saveData(acceptedAt, System.currentTimeMillis()); closePrompt()
                DebugEvents.add(this@CallActivity, "Call ${id.take(8)} accepted; starting media")
                monitor()
                val permissions = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
                    .filter { it != Manifest.permission.CAMERA || cameraAvailable() }
                    .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                if (permissions.isEmpty()) connect() else requestPermissions(permissions.toTypedArray(), 201)
            } catch (error: Exception) { if (error is CancellationException) throw error; connecting = false; controlsEnabled(false); connectionLoader.visibility = android.view.View.GONE; status.text = error.message ?: "Could not start call" }
        }
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 201 && !ending) connect()
    }
    private fun controlsEnabled(value: Boolean) {
        mic.isEnabled = value; camera.isEnabled = value; switch.isEnabled = value
        end.isEnabled = api.caller || !connecting
    }
    private fun hasPermission(name: String) = checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED
    private fun connect() {
        if (started || ending) return
        started = true
        scope.launch {
            try {
                val credentials = withContext(Dispatchers.IO) { api.request("/calls/$id/media", JSONObject()) }
                val active = LiveKit.create(applicationContext, overrides = CallAudio.overrides(this@CallActivity, tvCompatibility)); room = active
                val manager = getSystemService(CameraManager::class.java)
                val external = if (!api.caller) runCatching { manager.cameraIdList.firstOrNull {
                    manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_EXTERNAL
                } }.getOrNull() else null
                active.videoTrackCaptureDefaults = LocalVideoTrackOptions(deviceId = external,
                    captureParams = if (savingVideoData) VideoCaptureParameter(854, 480, 20) else VideoCaptureParameter(1280, 720, 24))
                active.videoTrackPublishDefaults = VideoTrackPublishDefaults(videoEncoding = VideoEncoding(1_500_000, 24), simulcast = true)
                active.initVideoRenderer(remote); active.initVideoRenderer(local); local.setMirror(api.caller); rendererReady = true
                launch { active.events.collect { event ->
                    if (ending || room !== active) return@collect
                    when (event) {
                        is RoomEvent.TrackSubscribed -> when (val track = event.track) {
                            is VideoTrack -> attachRemote(track)
                            is RemoteAudioTrack -> attachRemoteAudio(track)
                            else -> {}
                        }
                        is RoomEvent.TrackUnsubscribed -> {
                            if (event.track === remoteTrack) { remoteTrack?.removeRenderer(remote); remoteTrack = null; remote.clearImage(); remotePlaceholder.visibility = View.VISIBLE; remotePlaceholder.text = if (api.caller) "TV camera is off or not connected" else "Caller camera is off" }
                            if (event.track === remoteAudio) { remoteAudio?.removeSink(incomingSink); remoteAudio = null }
                        }
                        is RoomEvent.Reconnecting -> status.text = "Connection lost. Reconnecting…"
                        is RoomEvent.Reconnected -> status.text = "Connected"
                        is RoomEvent.Disconnected -> { status.text = "Video connection ended"; endCall(true) }
                        else -> {}
                    }
                } }
                withTimeout(35_000) { active.connect(credentials.getString("url"), credentials.getString("token")) }
                connected = true; connectionLoader.visibility = android.view.View.GONE
                val notices = mutableListOf<String>()
                if (hasPermission(Manifest.permission.RECORD_AUDIO)) {
                    try { micOn = active.localParticipant.setMicrophoneEnabled(true); if (!micOn) notices.add("Microphone unavailable") }
                    catch (error: Exception) { if (error is CancellationException) throw error; notices.add("Microphone unavailable") }
                } else notices.add("Microphone permission denied")
                val cameraPresent = cameraAvailable()
                if (!cameraPresent) notices.add("No camera connected")
                else if (hasPermission(Manifest.permission.CAMERA)) {
                    cameraOn = OptionalCamera.enable(cameraPresent) { active.localParticipant.setCameraEnabled(true) }
                    if (cameraOn) attachLocal() else notices.add("No camera connected")
                } else notices.add("Camera permission denied")
                startVideoDataSaver()
                attachLocalAudio()
                active.setSpeakerMute(false)
                startAudioMeter()
                DebugEvents.add(this@CallActivity, "Audio profile=${if (tvCompatibility) "TV media/MIC" else "communication"}; USB mic=${CallAudio.hasUsbInput(this@CallActivity)}")
                active.remoteParticipants.values.firstOrNull()?.getTrackPublication(Track.Source.MICROPHONE)?.track
                    ?.let { if (it is RemoteAudioTrack) attachRemoteAudio(it) }
                refreshLabels()
                active.remoteParticipants.values.firstOrNull()?.getTrackPublication(Track.Source.CAMERA)?.track
                    ?.let { if (it is VideoTrack) attachRemote(it) }
                if (remoteTrack == null) remotePlaceholder.text = if (api.caller) "TV camera is off or not connected" else "Waiting for caller video…"
                status.text = if (notices.isEmpty()) "Connected" else "Connected · ${notices.joinToString(" · ")}"
                connecting = false; controlsEnabled(true)
                DebugEvents.add(this@CallActivity, "Media connected; camera=$cameraOn microphone=$micOn")
            } catch (error: Exception) {
                if (error is CancellationException && error !is TimeoutCancellationException) throw error
                connected = false; connecting = false; connectionLoader.visibility = android.view.View.GONE; controlsEnabled(false); releaseMedia()
                status.text = "Could not connect video: ${error.message ?: "connection failed"}. End this call and try again."
                DebugEvents.add(this@CallActivity, "Media connection failed")
            }
        }
    }
    private fun startVideoDataSaver() = scope.launch {
        while (isActive && !ending && !savingVideoData) {
            delay(1_000)
            if (!VideoQualityPolicy.saveData(acceptedAt, System.currentTimeMillis())) continue
            val active = room ?: return@launch
            try {
                val capture = VideoCaptureParameter(854, 480, 20)
                active.videoTrackCaptureDefaults = active.videoTrackCaptureDefaults.copy(captureParams = capture)
                (localTrack as? LocalVideoTrack)?.let { track ->
                    track.capturer.changeCaptureFormat(854, 480, 20)
                    track.options = track.options.copy(captureParams = capture)
                }
                savingVideoData = true
                DebugEvents.add(this@CallActivity, "Video data saver enabled after 15 minutes")
            } catch (_: Exception) { DebugEvents.add(this@CallActivity, "Video data saver will retry") }
        }
    }
    private fun attachLocalAudio() {
        val track = room?.localParticipant?.getTrackPublication(Track.Source.MICROPHONE)?.track as? LocalAudioTrack
        if (localAudio === track) return
        localAudio?.removeSink(micSink); localAudio = track; track?.addSink(micSink)
    }
    private fun attachRemoteAudio(track: RemoteAudioTrack) {
        if (remoteAudio === track) return
        remoteAudio?.removeSink(incomingSink); remoteAudio = track
        track.enabled = true; track.setVolume(1.0); track.addSink(incomingSink)
        DebugEvents.add(this, "Remote audio subscribed")
    }
    private fun startAudioMeter() = scope.launch {
        while (isActive && connected && !ending) {
            val sending = if (micOn) micLevel.read() else "muted"
            val receiving = if (remoteAudio == null) "waiting for peer mic" else incomingLevel.read()
            audioStatus.text = "Mic: $sending · Incoming audio: $receiving"
            delay(1_000)
        }
    }
    private fun showAudioInfo() {
        val profile = if (tvCompatibility) "TV media playback / microphone capture" else "Communication audio"
        val message = "$profile\n${CallAudio.inputDescription(this)}\nRecording route: ${CallAudio.recordingRoute(this)}\n" +
            "USB mic detected: ${CallAudio.hasUsbInput(this)}\nMicrophone permission: ${hasPermission(Manifest.permission.RECORD_AUDIO)}\n" +
            "${audioStatus.text}\n\n" +
            "Video working does not prove the webcam has an Android-compatible microphone. " +
            "If incoming audio has a level but you hear nothing, check TV Sound → Audio output, mute and volume."
        AlertDialog.Builder(this).setTitle("Call audio").setMessage(message).setPositiveButton("Close", null).show()
    }
    private fun attachRemote(track: VideoTrack) {
        if (remoteTrack === track) return
        remoteTrack?.removeRenderer(remote); remoteTrack = track; track.addRenderer(remote); remotePlaceholder.visibility = View.GONE
    }
    private fun attachLocal() {
        localTrack?.removeRenderer(local)
        localTrack = room?.localParticipant?.getTrackPublication(Track.Source.CAMERA)?.track as? VideoTrack
        localTrack?.addRenderer(local)
    }
    @Suppress("DEPRECATION")
    private fun cameraAvailable(): Boolean =
        runCatching { getSystemService(CameraManager::class.java).cameraIdList.isNotEmpty() }.getOrDefault(false) ||
        runCatching { android.hardware.Camera.getNumberOfCameras() > 0 }.getOrDefault(false)
    private fun refreshLabels() { mic.text = if (micOn) "Mute" else "Enable mic"; camera.text = if (cameraOn) "Camera off" else "Enable camera" }
    private fun toggle(video: Boolean) {
        if (!connected || ending) return
        if (!hasPermission(if (video) Manifest.permission.CAMERA else Manifest.permission.RECORD_AUDIO)) {
            status.text = "Enable camera/microphone permissions in Android app settings, then call again."; return
        }
        controlsEnabled(false)
        scope.launch {
            try {
                val participant = room?.localParticipant ?: return@launch
                if (video) {
                    if (cameraOn) { participant.setCameraEnabled(false); cameraOn = false; local.clearImage() }
                    else {
                        cameraOn = OptionalCamera.enable(cameraAvailable()) { participant.setCameraEnabled(true) }
                        if (cameraOn) attachLocal() else status.text = "No camera connected · Call stays connected"
                    }
                } else if (participant.setMicrophoneEnabled(!micOn)) { micOn = !micOn; attachLocalAudio() }
                refreshLabels()
            } catch (error: Exception) { if (error is CancellationException) throw error; status.text = "Could not change camera/microphone" }
            finally { if (!ending) controlsEnabled(connected) }
        }
    }
    private fun monitor() = scope.launch {
        var lastHeartbeat = 0L
        while (isActive && !ending) {
            delay(2_000)
            try {
                val heartbeat = connected && System.currentTimeMillis() - lastHeartbeat >= 10_000
                val call = withContext(Dispatchers.IO) {
                    if (heartbeat) api.request("/calls/$id/heartbeat", JSONObject()) else api.request("/calls/$id")
                }
                if (heartbeat) lastHeartbeat = System.currentTimeMillis()
                if (call.optString("status") != "accepted") { endCall(false); break }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (error is HttpFailure && error.status in listOf(401, 403, 404, 409)) { endCall(false); break }
                status.text = "HomePing connection interrupted. Waiting for network…"
            }
        }
    }
    private fun releaseMedia() {
        localAudio?.removeSink(micSink); remoteAudio?.removeSink(incomingSink); localAudio = null; remoteAudio = null
        localTrack?.removeRenderer(local); remoteTrack?.removeRenderer(remote); localTrack = null; remoteTrack = null
        val closing = room; room = null
        closing?.disconnect(); closing?.release()
        if (rendererReady) { local.release(); remote.release(); rendererReady = false }
    }
    private fun closePrompt() {
        if (api.caller) return
        sendBroadcast(Intent("$packageName.CLOSE").setPackage(packageName).putExtra("callId", id)); Alerts.clear(this, id)
    }
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (::api.isInitialized && !api.caller && event.keyCode in listOf(
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_BUTTON_A) &&
            remoteGuard.consume(SystemClock.elapsedRealtime(), connecting, event.action == KeyEvent.ACTION_UP, event.repeatCount)) return true
        return super.dispatchKeyEvent(event)
    }
    private fun requestEndCall() {
        if (ending) return
        if (api.caller) { endCall(true); return }
        if (endConfirmation?.isShowing == true) return
        val dialog = AlertDialog.Builder(this).setTitle("End this call?")
            .setPositiveButton("Keep calling") { _, _ -> }
            .setNegativeButton("End call") { _, _ -> endCall(true) }.create()
        endConfirmation = dialog
        dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).requestFocus() }
        dialog.setOnDismissListener { endConfirmation = null; if (!ending) status.requestFocus() }
        dialog.show()
    }
    private fun endCall(notify: Boolean) {
        if (ending) return
        ending = true; endConfirmation?.dismiss(); connected = false; scope.cancel(); releaseMedia(); closePrompt()
        if (notify && accepted) Backend.io.execute {
            try { api.action(id, "end") } catch (_: Exception) { DebugEvents.add(this, "End pending; server media lease will expire") }
        }
        if (api.caller) finish() else {
            startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finishAndRemoveTask()
        }
    }
    override fun onStop() {
        super.onStop()
        // Calls record media only while this screen is visible. Background/Home
        // ends the call instead of silently keeping camera/mic active.
        if (!isChangingConfigurations && !ending && ::api.isInitialized) endCall(true)
    }
    override fun onDestroy() { endConfirmation?.dismiss(); scope.cancel(); releaseMedia(); super.onDestroy() }
    @Deprecated("Remote Back ends the call")
    override fun onBackPressed() { requestEndCall() }
}
