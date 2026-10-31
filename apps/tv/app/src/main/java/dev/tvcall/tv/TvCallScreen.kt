package dev.tvcall.tv

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.view.WindowManager

/** Exit ambient/screensaver mode only when a call has been accepted. */
internal object TvCallScreen {
    fun open(context: Context, callId: String) {
        wake(context)
        context.startActivity(Alerts.activity(context, CallActivity::class.java, callId, "accept"))
    }
    fun prepare(activity: Activity) {
        if (Build.VERSION.SDK_INT >= 27) {
            activity.setShowWhenLocked(true)
            activity.setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        wake(activity)
    }
    @Suppress("DEPRECATION")
    private fun wake(context: Context) {
        // Android TV 11/12 can keep an already-running dream over a new task.
        // The short wake pulse precedes launch; the activity then keeps its screen on.
        // No privileged DreamManager calls, input injection or persistent wake lock.
        runCatching {
            context.getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "HomePing:accepted-call")
                .acquire(3_000)
        }.onFailure { DebugEvents.add(context, "Call display wake unavailable; relying on activity screen flags") }
    }
}
