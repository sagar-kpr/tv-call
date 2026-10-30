package dev.tvcall.tv

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.ImageView
import android.widget.ScrollView
import com.google.android.gms.common.GoogleApiAvailability
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import com.google.zxing.common.BitMatrix
import org.json.JSONObject

class SetupActivity : Activity() {
    @Volatile private var alive = true
    private var ringtonePreview: IncomingRinger? = null
    private val ringtonePreviewHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val stopRingtonePreview = Runnable { ringtonePreview?.stop(); ringtonePreview = null }
    private var presentationStatus: android.widget.TextView? = null
    private var overlayPermissionButton: android.widget.Button? = null
    @Volatile private var foregroundCheck = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        render()
    }
    override fun onResume() {
        super.onResume()
        updatePresentationStatus()
        // Existing ringing invitations are offered when this screen is resumed,
        // even if the vendor did not display the earlier notification.
        if (!Backend.authorized(this) || !Backend.isTvMode(this) || foregroundCheck) return
        foregroundCheck = true
        Backend.io.execute {
            try {
                val call = Backend.api(this, "/tv/active-call").optJSONObject("call")
                runOnUiThread {
                    if (alive && call != null && IncomingPromptPolicy.choose(call.optString("status"),
                        call.optLong("expiresAt"), System.currentTimeMillis(), IncomingPresentation.screen(),
                        Backend.overlay(this), Settings.canDrawOverlays(this)) == IncomingPromptPolicy.Path.FOREGROUND)
                        IncomingPresentation.showInForeground(call.getString("id"))
                }
            } catch (_: Exception) { /* FCM and the recovery control remain available. */ }
            finally { foregroundCheck = false }
        }
    }
    private fun updatePresentationStatus() {
        val allowed = Settings.canDrawOverlays(this)
        presentationStatus?.text = if (!Backend.overlay(this))
            "Home-screen prompt: standard notification only. TV firmware may hide it. Enable the overlay to test another presentation method."
        else if (allowed) "Home-screen overlay: enabled and permission granted. Test a call while the TV is on Home."
        else "Home-screen overlay is blocked: display-over-other-apps permission has not been granted. Turning the switch ON alone is not enough."
        overlayPermissionButton?.visibility = if (Backend.overlay(this) && !allowed) View.VISIBLE else View.GONE
    }
    private fun openOverlayPermission(status: android.widget.TextView) {
        try { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }
        catch (_: Exception) { status.text = "This TV does not expose overlay settings. One-time ADB setup: adb shell appops set $packageName SYSTEM_ALERT_WINDOW allow" }
    }
    override fun onPause() {
        ringtonePreviewHandler.removeCallbacks(stopRingtonePreview)
        stopRingtonePreview.run()
        super.onPause()
    }
    private fun render() {
        if (Backend.base(this).isNotBlank() && Backend.authorized(this)) renderSettings() else renderAuthorization()
    }
    private fun page(content: View) = setContentView(ScrollView(this).apply { isFillViewport = true; addView(content) })
    private fun title(layout: android.widget.LinearLayout): android.widget.TextView {
        val heading = Ui.text(this, "HomePing", 32f)
        heading.isFocusable = true
        heading.setOnFocusChangeListener { _, focused ->
            heading.setTextColor(if (focused) Color.rgb(211, 239, 177) else Color.WHITE)
        }
        heading.setOnLongClickListener {
            startActivity(Intent(this, ModeActivity::class.java))
            true
        }
        layout.addView(heading)
        return heading
    }
    private fun renderAuthorization() {
        val layout = Ui.column(this); title(layout)
        val tvMode = Backend.isTvMode(this)
        layout.addView(Ui.text(this,
            "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}\n" +
                "TV mode: ${if (tvMode) "detected" else "not detected"}\n" +
                "Google Play services: ${GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this)} (0 = available)", 16f))
        if (!tvMode) layout.addView(Ui.text(this, "This device was not detected as a TV. Long-press the HomePing heading to enable the hidden Run as TV override.", 17f))
        val status = Ui.text(this, "Sign in to link this TV to your HomePing account.", 19f)
        lateinit var connect: android.widget.Button
        connect = Ui.button(this, "Sign in to HomePing") {
            status.text = "Creating device authorization…"
            Backend.io.execute {
                try {
                    check(Backend.base(this).isNotBlank()) { "HomePing is not available in this build yet." }
                    Backend.configure(this, Backend.base(this))
                    val started = Backend.beginAuthorization(this)
                    val code = started.getString("code")
                    val approvalUrl = "${Backend.approvalBase(this)}/?activate=${Uri.encode(code)}"
                    runOnUiThread {
                        status.text = "Code: $code\nExpires in 10 minutes\n\nApprove only if this code is on your own TV.\nOpen: ${Backend.approvalBase(this)}"
                        val qr = ImageView(this).apply {
                            setImageBitmap(qr(approvalUrl)); contentDescription = "QR code for $approvalUrl"
                            layoutParams = android.widget.LinearLayout.LayoutParams(360, 360)
                        }
                        layout.addView(qr, layout.indexOfChild(status))
                        connect.isEnabled = false
                    }
                    poll(started.getString("authorizationId"), started.getLong("expiresAt"), status)
                } catch (e: Exception) { runOnUiThread { status.text = "Setup failed: ${e.message}" } }
            }
        }
        layout.addView(connect); layout.addView(status)
        addPresentationSettings(layout, status)
        page(layout); connect.requestFocus()
    }
    private fun poll(id: String, expiresAt: Long, status: android.widget.TextView) {
        while (alive && System.currentTimeMillis() < expiresAt) {
            try {
                val result = Backend.pollAuthorization(this, id)
                if (result.optString("status") == "approved") {
                    Backend.register(this)
                    runOnUiThread { if (alive) renderSettings() }
                    return
                }
            } catch (e: HttpFailure) {
                if (e.status == 410 || e.status == 409) {
                    runOnUiThread { status.text = "Authorization expired or already used. Start again." }
                    return
                }
            } catch (_: Exception) { /* retry until the local deadline */ }
            Thread.sleep(5_000)
        }
        runOnUiThread { if (alive) status.text = "Authorization expired. Start again." }
    }
    private fun renderSettings() {
        val layout = Ui.column(this); title(layout)
        val status = Ui.text(this, "Refreshing TV registration…", 17f)
        val name = Ui.input(this, "TV name", Backend.localName(this))
        val room = Ui.input(this, "Room (optional)", Backend.localRoom(this))
        var dnd = Backend.localDnd(this)
        val dndButton = Ui.button(this, "Do Not Disturb: ${if (dnd) "ON" else "OFF"}") {}
        dndButton.setOnClickListener { dnd = !dnd; dndButton.text = "Do Not Disturb: ${if (dnd) "ON" else "OFF"}" }
        layout.addView(Ui.text(this, "TV settings", 25f)); layout.addView(name); layout.addView(room); layout.addView(dndButton)
        layout.addView(Ui.button(this, "Save settings") {
            status.text = "Saving…"
            Backend.io.execute {
                try { Backend.updateSettings(this, name.text.toString(), room.text.toString(), dnd); runOnUiThread { status.text = "Settings saved" } }
                catch (e: Exception) { runOnUiThread { status.text = "Save failed: ${e.message}" } }
            }
        })
        val hardware = Backend.hardware(this, null)
        layout.addView(Ui.text(this,
            "Detected information (read only)\n" +
                "${hardware.getString("manufacturer")} ${hardware.getString("model")}\n" +
                "Android ${hardware.getString("androidVersion")} · API ${hardware.getInt("apiLevel")}\n" +
                "${hardware.getInt("screenWidthPx")} × ${hardware.getInt("screenHeightPx")}\n" +
                "Camera API devices: ${hardware.getInt("cameraApiCount")}\n" +
                "USB host: ${hardware.getBoolean("usbHostSupported")} · USB camera attached: ${hardware.getBoolean("usbCameraAttached")}\n" +
                "Firmware: ${hardware.getString("firmwareFingerprint")}", 15f))
        layout.addView(status)
        addPresentationSettings(layout, status)
        layout.addView(Ui.button(this, "Recover active call") {
            Backend.io.execute {
                try {
                    val call = Backend.api(this, "/tv/active-call").optJSONObject("call") ?: JSONObject()
                    runOnUiThread {
                        when (call.optString("status")) {
                            "accepted" -> startActivity(Alerts.activity(this, CallActivity::class.java, call.getString("id"), "accept"))
                            "ringing" -> startActivity(Alerts.activity(this, IncomingActivity::class.java, call.getString("id")))
                            else -> status.text = "No active invitation or call"
                        }
                    }
                } catch (e: Exception) { runOnUiThread { status.text = "Recovery failed: ${e.message}" } }
            }
        })
        val events = Ui.text(this, "Last 20 events\n${DebugEvents.text(this)}", 14f)
        layout.addView(events)
        layout.addView(Ui.button(this, "Refresh debug events") { events.text = "Last 20 events\n${DebugEvents.text(this)}" })
        page(layout)
        name.requestFocus()
        Backend.io.execute {
            try { Backend.register(this); runOnUiThread { status.text = "TV registered · last seen updated" } }
            catch (e: HttpFailure) {
                if (e.status == 403) { Backend.signOutRemoved(this); runOnUiThread { renderAuthorization() } }
                else runOnUiThread { status.text = "Registration failed: ${e.message}" }
            } catch (e: Exception) { runOnUiThread { status.text = "Registration failed: ${e.message}" } }
        }
    }
    private fun addPresentationSettings(layout: android.widget.LinearLayout, status: android.widget.TextView) {
        val overlay = Ui.button(this, "Experimental overlay: ${if (Backend.overlay(this)) "ON" else "OFF"}") {}
        overlay.setOnClickListener {
            Backend.setOverlay(this, !Backend.overlay(this)); overlay.text = "Experimental overlay: ${if (Backend.overlay(this)) "ON" else "OFF"}"
            updatePresentationStatus()
            if (Backend.overlay(this) && !Settings.canDrawOverlays(this)) openOverlayPermission(status)
        }
        layout.addView(overlay)
        presentationStatus = Ui.text(this, "", 16f).also { layout.addView(it) }
        overlayPermissionButton = Ui.button(this, "Allow display over other apps") { openOverlayPermission(status) }.also { layout.addView(it) }
        updatePresentationStatus()
        val ringtone = Ui.button(this, "Incoming ringtone: ${if (Backend.ringtone(this)) "ON" else "OFF"}") {}
        ringtone.setOnClickListener {
            Backend.setRingtone(this, !Backend.ringtone(this))
            ringtone.text = "Incoming ringtone: ${if (Backend.ringtone(this)) "ON" else "OFF"}"
            if (!Backend.ringtone(this)) stopRingtonePreview.run()
            status.text = "Ringtone uses the TV media volume and selected sound output."
        }
        layout.addView(ringtone)
        layout.addView(Ui.button(this, "Test ringtone") {
            ringtonePreviewHandler.removeCallbacks(stopRingtonePreview); stopRingtonePreview.run()
            if (Backend.ringtone(this)) {
                volumeControlStream = android.media.AudioManager.STREAM_MUSIC
                ringtonePreview = IncomingRinger(this).also { it.start() }
                ringtonePreviewHandler.postDelayed(stopRingtonePreview, 8_000)
                status.text = "Playing an 8-second melodic ringtone test. Check TV speakers, mute and media volume."
            } else status.text = "Turn Incoming ringtone ON to test it."
        })
        val audio = Ui.button(this, "TV audio compatibility: ${if (Backend.tvAudioCompatibility(this)) "ON" else "OFF"}") {}
        audio.setOnClickListener {
            Backend.setTvAudioCompatibility(this, !Backend.tvAudioCompatibility(this))
            audio.text = "TV audio compatibility: ${if (Backend.tvAudioCompatibility(this)) "ON" else "OFF"}"
            status.text = "Audio mode saved for the next call. ON uses TV media playback and normal microphone capture; OFF uses communication audio."
        }
        layout.addView(audio)
        val reliable = Ui.button(this, "Reliable mode: ${if (Backend.reliable(this)) "ON" else "OFF"}") {}
        reliable.setOnClickListener {
            Backend.setReliable(this, !Backend.reliable(this))
            reliable.text = "Reliable mode: ${if (Backend.reliable(this)) "ON" else "OFF"}"
        }
        layout.addView(reliable)
        if (Build.VERSION.SDK_INT >= 34) layout.addView(Ui.button(this, "Full-screen notification permission") {
            try { startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName"))) }
            catch (_: Exception) { status.text = "Full-screen settings unavailable" }
        })
    }
    private fun qr(value: String): Bitmap {
        val matrix: BitMatrix = MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 360, 360)
        return Bitmap.createBitmap(360, 360, Bitmap.Config.RGB_565).apply {
            for (x in 0 until 360) for (y in 0 until 360) setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
        }
    }
    override fun onDestroy() { alive = false; super.onDestroy() }
}
