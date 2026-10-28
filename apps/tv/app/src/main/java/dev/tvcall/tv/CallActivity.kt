package dev.tvcall.tv

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class CallActivity : Activity() {
    private var id = ""
    private var accepted = false
    private var busy = false
    private lateinit var status: android.widget.TextView
    private lateinit var accept: android.widget.Button
    private lateinit var end: android.widget.Button
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        id = intent.getStringExtra("callId") ?: run { finish(); return }
        val layout = Ui.column(this)
        status = Ui.text(this, "Validating invitation…", 30f); layout.addView(status)
        accept = Ui.button(this, "Retry acceptance") { accept() }.apply { isEnabled = false }; layout.addView(accept)
        end = Ui.button(this, "Return home") { if(accepted) end() else home() }; layout.addView(end)
        setContentView(layout); accept()
    }
    private fun accept() {
        if (busy) return
        busy = true; accept.isEnabled = false
        Backend.io.execute {
            try {
                val call = Backend.action(this, id, "accept")
                runOnUiThread {
                    busy = false
                    if (isDestroyed) return@runOnUiThread
                    if(call.getString("status") != "accepted") { status.text = "Invitation is no longer available"; return@runOnUiThread }
                    accepted = true; closePrompt()
                    status.text = "Call accepted\n\nInvitation prototype — video and audio are not connected."
                    accept.visibility = android.view.View.GONE; end.text = "End call and return home"; end.requestFocus()
                }
            } catch(e: Exception) { runOnUiThread { busy = false; status.text = "Could not accept: ${e.message}"; accept.isEnabled = true; end.requestFocus() } }
        }
    }
    private fun closePrompt() { sendBroadcast(Intent("$packageName.CLOSE").setPackage(packageName).putExtra("callId", id)); Alerts.clear(this, id) }
    private fun end() {
        if(busy) return
        busy = true; end.isEnabled = false
        Backend.io.execute {
            try { Backend.action(this, id, "end"); runOnUiThread { busy = false; accepted = false; home() } }
            catch(e: Exception) { runOnUiThread { busy = false; end.isEnabled = true; status.text = "Could not end: ${e.message}\nRetry when the network returns." } }
        }
    }
    private fun home() {
        closePrompt()
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finishAndRemoveTask()
    }
    @Deprecated("Remote back ends the placeholder call")
    override fun onBackPressed() { if(accepted) end() else home() }
}
