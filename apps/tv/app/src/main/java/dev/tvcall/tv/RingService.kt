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
    private val ringer by lazy { IncomingRinger(this) }
    private val sound by lazy { RingingSoundController({ ringer.start() }, { ringer.stop() }) }
    private var deadline = 0L
    @Volatile private var closed = false
    private var presentationRequested = false
    private var permissionWarningLogged = false
    private var autoAcceptUntil = 0L
    @Volatile private var autoPicking = false
    private val expire = Runnable { finishRinging() }
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
        DebugEvents.add(this, "Notification posted for call ${id.take(8)}")
        main.postDelayed(expire, (expires - System.currentTimeMillis()).coerceAtLeast(1))
        // Perform receipt + validation outside the main thread; polling reconciles dropped cancellation pushes.
        var acknowledged = false
        polling = poller.scheduleWithFixedDelay({
            try {
                val call = if (!acknowledged) Backend.action(this, id, "receive") else Backend.api(this, "/calls/$id")
                acknowledged = true
                if (autoPicking) return@scheduleWithFixedDelay
                if (call.optString("status") != "ringing") main.post { close() }
                else main.post {
                    if (closed || autoPicking) return@post
                    autoAcceptUntil = call.optLong("autoAcceptUntil", 0L)
                    if (System.currentTimeMillis() >= deadline) { finishRinging(); return@post }
                    sound.update(call.optString("status"), call.optLong("expiresAt"), System.currentTimeMillis(), Backend.ringtone(this))
                    if (overlay != null) return@post
                    val enabled = Backend.overlay(this)
                    val allowed = Settings.canDrawOverlays(this)
                    when (IncomingPromptPolicy.choose(call.optString("status"), call.optLong("expiresAt"),
                        System.currentTimeMillis(), IncomingPresentation.screen(), enabled, allowed)) {
                        IncomingPromptPolicy.Path.FOREGROUND -> if (!presentationRequested) {
                            presentationRequested = IncomingPresentation.showInForeground(id)
                            if (!presentationRequested && enabled && allowed) showOverlay()
                        }
                        IncomingPromptPolicy.Path.OVERLAY -> showOverlay()
                        IncomingPromptPolicy.Path.NOTIFICATION -> if (enabled && !allowed && !permissionWarningLogged) {
                            permissionWarningLogged = true
                            DebugEvents.add(this, "Overlay blocked: display-over-other-apps permission is missing")
                        }
                        IncomingPromptPolicy.Path.NONE -> close()
                        IncomingPromptPolicy.Path.ALREADY_VISIBLE -> {}
                    }
                }
            } catch (e: Exception) {
                // close() interrupts an in-flight read intentionally.
                if (!closed && !Thread.currentThread().isInterrupted) Log.w("HomePing", "Call state unavailable; local deadline remains active", e)
            }
        }, 0, 1, TimeUnit.SECONDS)
        return START_NOT_STICKY
    }
    private fun finishRinging() {
        if (closed || autoPicking) return
        sound.close()
        val foreground = IncomingPresentation.screen() in listOf(IncomingPromptPolicy.Screen.SETUP, IncomingPromptPolicy.Screen.INCOMING)
        if (!AutoAcceptPolicy.due(Backend.localAutoAccept(this), deadline, autoAcceptUntil, System.currentTimeMillis()) ||
            (!foreground && !Settings.canDrawOverlays(this))) { close(); return }
        autoPicking = true
        // The server atomically rechecks the TV preference, deadline and cancellation.
        Backend.io.execute {
            var accepted = false
            while (!closed && System.currentTimeMillis() < autoAcceptUntil) {
                try { accepted = Backend.action(this, callId, "auto-accept").optString("status") == "accepted"; break }
                catch (error: HttpFailure) {
                    if (error.status != 409 || error.message != "Auto-accept is not due yet") break
                    Thread.sleep(500)
                } catch (_: Exception) { break }
            }
            main.post {
                if (!closed && accepted) {
                    try { startActivity(Alerts.activity(this, CallActivity::class.java, callId, "accept")); DebugEvents.add(this, "Call auto-accepted after 60 seconds") }
                    catch (_: Exception) { DebugEvents.add(this, "Automatic call launch blocked by firmware") }
                }
                close()
            }
        }
        main.postDelayed({ close() }, 10_000)
    }
    private fun showOverlay() {
        if (System.currentTimeMillis() >= deadline) { close(); return }
        val prompt = TvUi.incoming(this, accept = {
            if (System.currentTimeMillis() >= deadline) { close(); return@incoming }
            try { startActivity(Alerts.activity(this, CallActivity::class.java, callId, "accept")) }
            catch (e: Exception) { Log.e("HomePing", "Overlay activity launch blocked", e) }
            close()
        }, reject = {
            val id = callId
            Backend.io.execute { try { Backend.action(this, id, "decline") } catch (e: Exception) { Log.w("HomePing", "Decline failed", e) } }
            close()
        })
        val column = prompt.panel
        val accept = prompt.accept
        val width = minOf(TvUi.dp(this, 560), (resources.displayMetrics.widthPixels * .85f).toInt())
        val params = WindowManager.LayoutParams(width, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT).apply { gravity = Gravity.CENTER }
        try {
            getSystemService(WindowManager::class.java).addView(column, params); overlay = column; accept.requestFocus()
            Log.i("HomePing", "Overlay shown call=$callId at=${System.currentTimeMillis()}; verify focus on hardware")
            DebugEvents.add(this, "Overlay shown for call ${callId.take(8)}")
        } catch (e: Exception) { Log.e("HomePing", "Overlay unavailable; notification remains", e) }
    }
    private fun close() {
        if (closed) return
        closed = true; sound.close(); polling?.cancel(true); main.removeCallbacks(expire)
        overlay?.let { try { getSystemService(WindowManager::class.java).removeView(it) } catch (_: Exception) {} }; overlay = null
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onDestroy() {
        close(); unregisterReceiver(receiver); poller.shutdownNow(); super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
}
