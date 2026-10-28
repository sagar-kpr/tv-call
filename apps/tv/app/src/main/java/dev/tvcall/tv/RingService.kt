package dev.tvcall.tv

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.PixelFormat
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class RingService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val poller = Executors.newSingleThreadScheduledExecutor()
    private var polling: ScheduledFuture<*>? = null
    private var callId = ""
    private var overlay: View? = null
    private var deadline = 0L
    private var closed = false
    private val expire = Runnable { close() }
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) { if (intent.getStringExtra("callId") == callId) close() }
    }
    override fun onCreate() {
        super.onCreate()
        ContextCompat.registerReceiver(this, receiver, IntentFilter("$packageName.CLOSE"), ContextCompat.RECEIVER_NOT_EXPORTED)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra("callId") ?: run { stopSelf(); return START_NOT_STICKY }
        val expires = intent.getLongExtra("expiresAt", 0)
        if (expires <= System.currentTimeMillis()) { stopSelf(); return START_NOT_STICKY }
        if (id == callId) return START_NOT_STICKY // duplicate delivery must not reset the timeout or re-alert
        if (callId.isNotEmpty()) { stopSelf(); return START_NOT_STICKY }
        callId = id; deadline = expires
        startForeground(Alerts.ID, Alerts.notification(this, id, expires))
        Log.i("HomePing", "Notification posted call=$id at=${System.currentTimeMillis()} overlay=${Backend.overlay(this)}")
        main.postDelayed(expire, (expires - System.currentTimeMillis()).coerceAtLeast(1))
        // Perform receipt + validation outside the main thread; polling reconciles dropped cancellation pushes.
        var acknowledged = false
        polling = poller.scheduleWithFixedDelay({
            try {
                val call = if (!acknowledged) Backend.action(this, id, "receive") else Backend.api(this, "/calls/$id")
                acknowledged = true
                if (call.optString("status") != "ringing") main.post { close() }
                else main.post { if (!closed && overlay == null && Backend.overlay(this) && Settings.canDrawOverlays(this)) showOverlay() }
            } catch (e: Exception) { Log.w("HomePing", "Call state unavailable; local deadline remains active", e) }
        }, 0, 1, TimeUnit.SECONDS)
        return START_NOT_STICKY
    }
    private fun showOverlay() {
        if (System.currentTimeMillis() >= deadline) { close(); return }
        val column = Ui.column(this)
        column.addView(Ui.text(this, "Incoming TV call", 32f))
        column.addView(Ui.text(this, "Use ← / → or ↑ / ↓ and OK to choose.", 18f))
        val accept = Ui.button(this, "Accept") {
            try { startActivity(Alerts.activity(this, CallActivity::class.java, callId, "accept")) }
            catch (e: Exception) { Log.e("HomePing", "Overlay activity launch blocked", e) }
            close()
        }
        column.addView(accept)
        column.addView(Ui.button(this, "Reject") {
            val id = callId
            Backend.io.execute { try { Backend.action(this, id, "reject") } catch (e: Exception) { Log.w("HomePing", "Reject failed", e) } }
            close()
        })
        val params = WindowManager.LayoutParams(700, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT).apply { gravity = Gravity.CENTER }
        try {
            getSystemService(WindowManager::class.java).addView(column, params); overlay = column; accept.requestFocus()
            Log.i("HomePing", "Overlay shown call=$callId at=${System.currentTimeMillis()}; verify focus on hardware")
        } catch (e: Exception) { Log.e("HomePing", "Overlay unavailable; notification remains", e) }
    }
    private fun close() {
        if (closed) return
        closed = true; polling?.cancel(true); main.removeCallbacks(expire)
        overlay?.let { try { getSystemService(WindowManager::class.java).removeView(it) } catch (_: Exception) {} }; overlay = null
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onDestroy() {
        close(); unregisterReceiver(receiver); poller.shutdownNow(); super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
}
