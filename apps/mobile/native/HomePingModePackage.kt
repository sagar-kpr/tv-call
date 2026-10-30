package dev.tvcall.caller

import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import dev.tvcall.tv.ModeActivity
import dev.tvcall.tv.Backend

class HomePingModeModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "HomePingMode"
    override fun getConstants(): Map<String, Any> =
        mapOf("backendUrl" to Backend.configuredBase(reactApplicationContext))

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
