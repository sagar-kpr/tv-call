package dev.tvcall.tv

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.EditText
import com.google.android.gms.common.GoogleApiAvailability

class SetupActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        val layout = Ui.column(this)
        layout.addView(Ui.text(this, "HomePing · invitation prototype", 30f))
        layout.addView(Ui.text(this, "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}\nFirmware: ${Build.DISPLAY}\nGoogle Play services status: ${GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this)} (0 = available)", 16f))
        val url = EditText(this).apply { hint = "https://your-backend-tunnel.example"; setText(Backend.base(this@SetupActivity)); setSingleLine(true); setTextColor(android.graphics.Color.WHITE); inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI }
        layout.addView(url)
        val status = Ui.text(this, "Connect once, pair your callers, then press Home.", 19f)
        val connect = Ui.button(this, "Register TV / get pairing code") {
            val enteredUrl = url.text.toString()
            status.text = "Registering…"
            Backend.io.execute {
                try {
                    Backend.configure(this, enteredUrl)
                    val pair = Backend.api(this, "/devices/pairing-code", org.json.JSONObject())
                    runOnUiThread { status.text = "Pairing code: ${pair.getString("code")}\nValid for 5 minutes; usable by both callers. Press Home after pairing." }
                } catch (e: Exception) { runOnUiThread { status.text = "Setup failed: ${e.message}" } }
            }
        }
        layout.addView(connect); layout.addView(status)
        val overlay = Ui.button(this, "Experimental overlay: ${if(Backend.overlay(this)) "ON" else "OFF"}") { }
        overlay.setOnClickListener {
            Backend.setOverlay(this, !Backend.overlay(this)); overlay.text = "Experimental overlay: ${if(Backend.overlay(this)) "ON" else "OFF"}"
            if (Backend.overlay(this) && !Settings.canDrawOverlays(this)) {
                try { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }
                catch (_: Exception) { status.text = "Overlay settings unavailable. See the ADB setup instructions; remote focus must still be tested." }
            }
        }
        layout.addView(overlay)
        layout.addView(Ui.button(this, "Recover active call") {
            Backend.io.execute {
                try {
                    val call = Backend.api(this, "/devices/active-call").optJSONObject("call") ?: org.json.JSONObject()
                    runOnUiThread {
                        if(call.optString("status") == "accepted") startActivity(Alerts.activity(this, CallActivity::class.java, call.getString("id"), "accept"))
                        else if(call.optString("status") == "ringing") startActivity(Alerts.activity(this, IncomingActivity::class.java, call.getString("id")))
                        else status.text = "No active invitation or call"
                    }
                } catch(e: Exception) { runOnUiThread { status.text = "Recovery failed: ${e.message}" } }
            }
        })
        if (Build.VERSION.SDK_INT >= 34) layout.addView(Ui.button(this, "Full-screen notification permission") {
            try { startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName"))) } catch (_: Exception) { status.text = "Full-screen settings unavailable on this device" }
        })
        setContentView(android.widget.ScrollView(this).apply { isFillViewport = true; addView(layout) })
    }
}
