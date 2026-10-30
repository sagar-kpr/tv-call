package dev.tvcall.tv

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Bundle
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
    private var ending = false
    private var connected = false
    private var started = false
    private var micOn = false
    private var cameraOn = false
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
        for (key in listOf("callerToken", "callerRefresh", "apiKey")) intent.removeExtra(key)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_SECURE)
        val layout = Ui.column(this).apply { setPadding(24, 12, 24, 12) }
        status = Ui.text(this, "Connecting your call…", 18f); layout.addView(status)
        val stage = android.widget.FrameLayout(this)
        remote = SurfaceViewRenderer(this).apply { contentDescription = "Remote video"; isFocusable = false }
        local = SurfaceViewRenderer(this).apply { contentDescription = "Your camera"; isFocusable = false; setZOrderMediaOverlay(true) }
        stage.addView(remote, android.widget.FrameLayout.LayoutParams(-1, -1))
        stage.addView(local, android.widget.FrameLayout.LayoutParams(240, 135, android.view.Gravity.BOTTOM or android.view.Gravity.END))
        layout.addView(stage, LinearLayout.LayoutParams(-1, 0, 1f))
        val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        mic = Ui.button(this, "Enable mic") { toggle(false) }
        camera = Ui.button(this, "Enable camera") { toggle(true) }
        switch = Ui.button(this, "Switch camera") { (localTrack as? LocalVideoTrack)?.switchCamera() }
        end = Ui.button(this, "End call") { endCall(true) }
        for (button in listOf(mic, camera, switch, end)) controls.addView(button, LinearLayout.LayoutParams(0, -2, 1f))
        layout.addView(controls); setContentView(layout); end.requestFocus(); controlsEnabled(false)
        scope.launch {
            try {
                val call = withContext(Dispatchers.IO) { if (api.caller) api.request("/calls/$id") else api.action(id, "accept") }
                check(call.optString("status") == "accepted") { "Invitation is no longer available" }
                accepted = true; closePrompt()
                DebugEvents.add(this@CallActivity, "Call ${id.take(8)} accepted; starting media")
                monitor()
                val permissions = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
                    .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                if (permissions.isEmpty()) connect() else requestPermissions(permissions.toTypedArray(), 201)
            } catch (error: Exception) { if (error is CancellationException) throw error; status.text = error.message ?: "Could not start call" }
        }
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 201 && !ending) connect()
    }
    private fun controlsEnabled(value: Boolean) {
        mic.isEnabled = value; camera.isEnabled = value; switch.isEnabled = value
    }
    private fun hasPermission(name: String) = checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED
    private fun connect() {
        if (started || ending) return
        started = true
        scope.launch {
            try {
                val credentials = withContext(Dispatchers.IO) { api.request("/calls/$id/media", JSONObject()) }
                val active = LiveKit.create(applicationContext); room = active
                val manager = getSystemService(CameraManager::class.java)
                val external = if (!api.caller) runCatching { manager.cameraIdList.firstOrNull {
                    manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_EXTERNAL
                } }.getOrNull() else null
                active.videoTrackCaptureDefaults = LocalVideoTrackOptions(deviceId = external,
                    captureParams = VideoCaptureParameter(640, 360, 24))
                active.initVideoRenderer(remote); active.initVideoRenderer(local); local.setMirror(api.caller); rendererReady = true
                launch { active.events.collect { event ->
                    if (ending || room !== active) return@collect
                    when (event) {
                        is RoomEvent.TrackSubscribed -> if (event.track is VideoTrack) attachRemote(event.track as VideoTrack)
                        is RoomEvent.TrackUnsubscribed -> if (event.track === remoteTrack) { remoteTrack?.removeRenderer(remote); remoteTrack = null; remote.clearImage() }
                        is RoomEvent.Reconnecting -> status.text = "Connection lost. Reconnecting…"
                        is RoomEvent.Reconnected -> status.text = "Connected"
                        is RoomEvent.Disconnected -> { status.text = "Video connection ended"; endCall(true) }
                        else -> {}
                    }
                } }
                withTimeout(35_000) { active.connect(credentials.getString("url"), credentials.getString("token")) }
                connected = true; controlsEnabled(true)
                val notices = mutableListOf<String>()
                if (hasPermission(Manifest.permission.RECORD_AUDIO)) {
                    try { micOn = active.localParticipant.setMicrophoneEnabled(true); if (!micOn) notices.add("Microphone unavailable") }
                    catch (error: Exception) { if (error is CancellationException) throw error; notices.add("Microphone unavailable") }
                } else notices.add("Microphone permission denied")
                if (hasPermission(Manifest.permission.CAMERA)) {
                    try {
                        cameraOn = active.localParticipant.setCameraEnabled(true)
                        if (cameraOn) attachLocal() else notices.add("No compatible camera available")
                    } catch (error: Exception) { if (error is CancellationException) throw error; notices.add("No compatible camera available") }
                } else notices.add("Camera permission denied")
                refreshLabels()
                active.remoteParticipants.values.firstOrNull()?.getTrackPublication(Track.Source.CAMERA)?.track
                    ?.let { if (it is VideoTrack) attachRemote(it) }
                status.text = if (notices.isEmpty()) "Connected" else "Connected · ${notices.joinToString(" · ")}"
                DebugEvents.add(this@CallActivity, "Media connected; camera=$cameraOn microphone=$micOn")
            } catch (error: Exception) {
                if (error is CancellationException && error !is TimeoutCancellationException) throw error
                connected = false; controlsEnabled(false); releaseMedia()
                status.text = "Could not connect video: ${error.message ?: "connection failed"}. End this call and try again."
                DebugEvents.add(this@CallActivity, "Media connection failed")
            }
        }
    }
    private fun attachRemote(track: VideoTrack) {
        if (remoteTrack === track) return
        remoteTrack?.removeRenderer(remote); remoteTrack = track; track.addRenderer(remote)
    }
    private fun attachLocal() {
        localTrack?.removeRenderer(local)
        localTrack = room?.localParticipant?.getTrackPublication(Track.Source.CAMERA)?.track as? VideoTrack
        localTrack?.addRenderer(local)
    }
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
                    if (participant.setCameraEnabled(!cameraOn)) { cameraOn = !cameraOn; if (cameraOn) attachLocal() else local.clearImage() }
                    else status.text = "Camera unavailable"
                } else if (participant.setMicrophoneEnabled(!micOn)) micOn = !micOn
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
        localTrack?.removeRenderer(local); remoteTrack?.removeRenderer(remote); localTrack = null; remoteTrack = null
        val closing = room; room = null
        closing?.disconnect(); closing?.release()
        if (rendererReady) { local.release(); remote.release(); rendererReady = false }
    }
    private fun closePrompt() {
        if (api.caller) return
        sendBroadcast(Intent("$packageName.CLOSE").setPackage(packageName).putExtra("callId", id)); Alerts.clear(this, id)
    }
    private fun endCall(notify: Boolean) {
        if (ending) return
        ending = true; connected = false; scope.cancel(); releaseMedia(); closePrompt()
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
    override fun onDestroy() { scope.cancel(); releaseMedia(); super.onDestroy() }
    @Deprecated("Remote Back ends the call")
    override fun onBackPressed() { endCall(true) }
}
