package dev.tvcall.caller

import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import dev.tvcall.tv.CallActivity
import com.facebook.react.bridge.Promise
import dev.tvcall.tv.ModeActivity
import dev.tvcall.tv.Backend

class HomePingModeModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "HomePingMode"
    override fun getConstants(): Map<String, Any> =
        mapOf("backendUrl" to Backend.configuredBase(reactApplicationContext))

    @ReactMethod
    fun startCall(callId: String, idToken: String, refreshToken: String, apiKey: String, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) { promise.reject("NO_ACTIVITY", "Open HomePing before joining a call"); return }
        activity.runOnUiThread {
            try {
                // Non-exported activity, credentials remain in memory only.
                activity.startActivity(Intent(activity, CallActivity::class.java)
                    .putExtra("callId", callId).putExtra("callerToken", idToken)
                    .putExtra("callerRefresh", refreshToken).putExtra("apiKey", apiKey))
                promise.resolve(null)
            } catch (_: Exception) { promise.reject("CALL_START", "Could not open the call screen") }
        }
    }

    @ReactMethod
    fun openSettings() {
        reactApplicationContext.startActivity(Intent(reactApplicationContext, ModeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

class HomePingModePackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(HomePingModeModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
