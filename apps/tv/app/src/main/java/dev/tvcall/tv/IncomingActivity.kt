package dev.tvcall.tv

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper

class IncomingActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private var alive = true
    private var id = ""
    private val poll = object : Runnable {
        override fun run() {
            Backend.io.execute {
                try {
                    val call = Backend.api(this@IncomingActivity, "/calls/$id")
                    if (call.getString("status") != "ringing") runOnUiThread { if(alive) finish() }
                } catch (_: Exception) { /* local expiry below remains authoritative for visibility */ }
                if(alive) main.postDelayed(this, 1000)
            }
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        id = intent.getStringExtra("callId") ?: run { finish(); return }
        val status = TvUi.text(this, "Checking invitation…", 14f, true)
        val prompt = TvUi.incoming(this, accept = {
            startActivity(Alerts.activity(this, CallActivity::class.java, id, "accept")); finish()
        }, reject = {
            Backend.io.execute {
                try { Backend.action(this, id, "decline"); runOnUiThread { dismiss(); finish() } }
                catch (_: Exception) { runOnUiThread { status.text = "Could not reject. Please try again." } }
            }
        })
        val accept = prompt.accept.apply { isEnabled = false }
        val reject = prompt.reject.apply { isEnabled = false }
        prompt.panel.addView(status)
        val layout = TvUi.screen(this).apply { gravity = android.view.Gravity.CENTER }
        layout.addView(prompt.panel, android.widget.LinearLayout.LayoutParams(minOf(TvUi.dp(this, 560), (resources.displayMetrics.widthPixels * .85f).toInt()), -2))
        setContentView(layout)
        Backend.io.execute {
            try {
                val call = Backend.action(this, id, "receive")
                val remaining = call.getLong("expiresAt") - System.currentTimeMillis()
                runOnUiThread {
                    if (!alive) return@runOnUiThread
                    if (call.getString("status") != "ringing" || remaining <= 0) { dismiss(); finish(); return@runOnUiThread }
                    status.text = "Use the remote to accept or reject."
                    accept.isEnabled = true; reject.isEnabled = true; accept.requestFocus()
                    main.postDelayed({ if(alive) { dismiss(); finish() } }, remaining)
                    main.post(poll)
                }
            } catch(e: Exception) { runOnUiThread { status.text = "Invitation unavailable: ${e.message}"; main.postDelayed({ finish() }, 5000) } }
        }
    }
    private fun dismiss() { sendBroadcast(Intent("$packageName.CLOSE").setPackage(packageName).putExtra("callId", id)); Alerts.clear(this, id) }
    override fun onDestroy() { alive = false; main.removeCallbacksAndMessages(null); super.onDestroy() }
}
