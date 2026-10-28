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
        val layout = Ui.column(this)
        layout.addView(Ui.text(this, "Incoming TV call", 36f))
        val status = Ui.text(this, "Checking invitation…")
        layout.addView(status)
        val accept = Ui.button(this, "Accept") {
            startActivity(Alerts.activity(this, CallActivity::class.java, id, "accept")); finish()
        }.apply { isEnabled = false }
        val reject = Ui.button(this, "Reject") {
            Backend.io.execute {
                try { Backend.action(this, id, "reject"); runOnUiThread { dismiss(); finish() } }
                catch(e: Exception) { runOnUiThread { status.text = "Could not reject: ${e.message}" } }
            }
        }.apply { isEnabled = false }
        layout.addView(accept); layout.addView(reject); setContentView(layout)
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
