package dev.tvcall.tv

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import android.os.Looper
import java.lang.ref.WeakReference

/** Tracks only a resumed app activity; it never starts an activity from Home.
 * Background presentation stays with notifications or the explicitly enabled overlay. */
internal object IncomingPresentation : Application.ActivityLifecycleCallbacks {
    private var initialized = false
    private var lastForegroundCall: String? = null
    private var foreground: WeakReference<Activity>? = null

    fun initialize(context: Context) {
        if (initialized) return
        val application = context.applicationContext as Application
        application.registerActivityLifecycleCallbacks(this)
        initialized = true
    }
    fun screen(): IncomingPromptPolicy.Screen = when (val activity = foreground?.get()) {
        null -> IncomingPromptPolicy.Screen.BACKGROUND
        is SetupActivity -> if (activity.isFinishing || activity.isDestroyed) IncomingPromptPolicy.Screen.BACKGROUND else IncomingPromptPolicy.Screen.SETUP
        is IncomingActivity -> IncomingPromptPolicy.Screen.INCOMING
        is CallActivity -> IncomingPromptPolicy.Screen.CALL
        else -> IncomingPromptPolicy.Screen.OTHER
    }
    fun showInForeground(callId: String): Boolean {
        check(Looper.myLooper() == Looper.getMainLooper())
        val activity = foreground?.get() as? SetupActivity ?: return false
        if (activity.isFinishing || activity.isDestroyed) return false
        if (lastForegroundCall == callId) return true
        lastForegroundCall = callId
        return try {
            activity.startActivity(Alerts.activity(activity, IncomingActivity::class.java, callId))
            DebugEvents.add(activity, "Incoming prompt opened in foreground for ${callId.take(8)}")
            true
        } catch (_: Exception) {
            lastForegroundCall = null
            DebugEvents.add(activity, "Foreground incoming prompt launch unavailable")
            false
        }
    }
    override fun onActivityResumed(activity: Activity) { foreground = WeakReference(activity) }
    override fun onActivityPaused(activity: Activity) { if (foreground?.get() === activity) foreground = null }
    override fun onActivityDestroyed(activity: Activity) { if (foreground?.get() === activity) foreground = null }
    override fun onActivityCreated(activity: Activity, state: Bundle?) {}
    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityStopped(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
}
