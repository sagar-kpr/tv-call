package dev.tvcall.tv

import android.app.Application
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.hardware.camera2.CameraManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class TvApp : Application() {
    override fun onCreate() {
        super.onCreate()
        TvRuntime.initialize(this)
    }
}

/** Shared by the legacy native test host and the unified React Native host. */
object TvRuntime {
    fun initialize(c: Context) {
        Backend.restore(c)
        Alerts.channels(c)
        IncomingPresentation.initialize(c)
        DebugEvents.add(c, "HomePing process started")
        if (Backend.isTvMode(c) && Backend.base(c).isNotBlank() && Backend.authorized(c))
            RegistrationWorker.enqueue(c)
    }
}

class HttpFailure(val status: Int, message: String) : Exception(message)

object DebugEvents {
    private const val KEY = "events"
    fun add(c: Context, message: String) {
        Log.i("HomePing", message)
        val prefs = c.getSharedPreferences("debug-events", Context.MODE_PRIVATE)
        val existing = prefs.getString(KEY, "")?.lines()?.filter { it.isNotBlank() } ?: emptyList()
        val time = SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(Date())
        prefs.edit().putString(KEY, (listOf("$time  $message") + existing).take(20).joinToString("\n")).apply()
    }
    fun text(c: Context) = c.getSharedPreferences("debug-events", Context.MODE_PRIVATE)
        .getString(KEY, "No events yet") ?: "No events yet"
}

object Backend {
    val io = Executors.newFixedThreadPool(4)
    private fun prefs(c: Context) = c.getSharedPreferences("homeping-tv", Context.MODE_PRIVATE)
    private fun secure(c: Context) = EncryptedSharedPreferences.create(
        c,
        "homeping-tv-secure",
        MasterKey.Builder(c).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    fun configuredBase(c: Context): String =
        c.packageManager.getApplicationInfo(c.packageName, PackageManager.GET_META_DATA)
            .metaData?.getString("dev.homeping.BACKEND_URL").orEmpty().trimEnd('/')
    fun base(c: Context) = configuredBase(c).ifBlank { prefs(c).getString("backend", "") ?: "" }
    fun approvalBase(c: Context): String {
        val config = prefs(c).getString("firebase", null)?.let { JSONObject(it) }
        return config?.optString("webUrl")?.takeIf { it.startsWith("https://") }?.trimEnd('/') ?: base(c)
    }
    fun deviceId(c: Context): String {
        val current = prefs(c).getString("deviceId", null)
        if (current != null) return current
        return UUID.randomUUID().toString().also { prefs(c).edit().putString("deviceId", it).commit() }
    }
    fun deviceSecret(c: Context): String {
        val current = secure(c).getString("deviceSecret", null)
        if (current != null) return current
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            .also { secure(c).edit().putString("deviceSecret", it).commit() }
    }
    fun restore(c: Context) {
        val saved = prefs(c).getString("firebase", null) ?: return
        if (FirebaseApp.getApps(c).isEmpty()) initialize(c, JSONObject(saved))
        if (FirebaseAuth.getInstance().currentUser?.isAnonymous == true) FirebaseAuth.getInstance().signOut()
    }
    private fun initialize(c: Context, config: JSONObject) {
        FirebaseApp.initializeApp(c, FirebaseOptions.Builder()
            .setApiKey(config.getString("apiKey"))
            .setApplicationId(config.getString("androidAppId"))
            .setProjectId(config.getString("projectId"))
            .setGcmSenderId(config.getString("messagingSenderId")).build())
    }
    fun configure(c: Context, rawUrl: String) {
        val normalized = rawUrl.trim().trimEnd('/')
        require(normalized.startsWith("https://") && URL(normalized).host.isNotBlank()) { "Enter an HTTPS backend URL" }
        val config = http("$normalized/api/config", null, null, "GET")
        val old = prefs(c).getString("firebase", null)
        if (old != null) require(JSONObject(old).getString("projectId") == config.getString("projectId")) {
            "Clear app data before changing Firebase projects"
        }
        prefs(c).edit().putString("backend", normalized).putString("firebase", config.toString()).commit()
        if (FirebaseApp.getApps(c).isEmpty()) initialize(c, config)
    }
    fun authorized(c: Context) = FirebaseApp.getApps(c).isNotEmpty() && FirebaseAuth.getInstance().currentUser != null
    private fun token(): String {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Authorize this TV first")
        return Tasks.await(user.getIdToken(false), 10, TimeUnit.SECONDS).token!!
    }
    fun api(c: Context, path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST"): JSONObject {
        require(base(c).isNotBlank()) { "Configure the TV app first" }
        return http("${base(c)}/api$path", body, token(), method)
    }
    fun beginAuthorization(c: Context): JSONObject {
        val body = JSONObject().put("registration", hardware(c, null)).put("deviceSecret", deviceSecret(c))
        return http("${base(c)}/api/device-authorizations", body, null, "POST")
    }
    fun pollAuthorization(c: Context, authorizationId: String): JSONObject {
        val result = http("${base(c)}/api/device-authorizations/poll",
            JSONObject().put("authorizationId", authorizationId).put("deviceSecret", deviceSecret(c)), null, "POST")
        if (result.optString("status") == "approved") {
            Tasks.await(FirebaseAuth.getInstance().signInWithCustomToken(result.getString("customToken")), 15, TimeUnit.SECONDS)
            DebugEvents.add(c, "TV authorization completed")
        }
        return result
    }
    fun action(c: Context, id: String, action: String) =
        api(c, "/calls/$id/action", JSONObject().put("action", action))
    fun hardware(c: Context, suppliedToken: String?): JSONObject {
        val pm = c.packageManager
        val metrics = c.resources.displayMetrics
        val cameraCount = try { c.getSystemService(CameraManager::class.java).cameraIdList.size } catch (_: Exception) { 0 }
        val usb = c.getSystemService(UsbManager::class.java)
        val usbCamera = usb.deviceList.values.any { device ->
            (0 until device.interfaceCount).any { device.getInterface(it).interfaceClass == UsbConstants.USB_CLASS_VIDEO }
        }
        return JSONObject()
            .put("deviceId", deviceId(c))
            .put("manufacturer", Build.MANUFACTURER)
            .put("model", Build.MODEL)
            .put("androidVersion", Build.VERSION.RELEASE)
            .put("apiLevel", Build.VERSION.SDK_INT)
            .put("screenWidthPx", metrics.widthPixels)
            .put("screenHeightPx", metrics.heightPixels)
            .put("firmwareFingerprint", Build.FINGERPRINT)
            .put("builtInCameraAvailable", pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY))
            .put("usbHostSupported", pm.hasSystemFeature(PackageManager.FEATURE_USB_HOST))
            .put("usbCameraAttached", usbCamera)
            .put("cameraApiCount", cameraCount)
            .put("fcmToken", suppliedToken ?: JSONObject.NULL)
    }
    fun register(c: Context, supplied: String? = null): JSONObject {
        if (base(c).isBlank() || FirebaseAuth.getInstance().currentUser == null) return JSONObject()
        val push = supplied ?: Tasks.await(FirebaseMessaging.getInstance().token, 10, TimeUnit.SECONDS)
        val result = api(c, "/tv/register", hardware(c, push))
        prefs(c).edit()
            .putString("name", result.optString("name", "Living Room TV"))
            .putString("room", result.optString("room", "Bedroom"))
            .putBoolean("dnd", result.optBoolean("doNotDisturb", false))
            .putBoolean("autoAccept", result.optBoolean("autoAccept", false)).apply()
        DebugEvents.add(c, "Registration and last-seen updated")
        return result
    }
    fun updateSettings(c: Context, name: String, room: String, dnd: Boolean, autoAccept: Boolean = localAutoAccept(c)): JSONObject {
        val result = api(c, "/tv/settings", JSONObject().put("name", name).put("room", room.ifBlank { JSONObject.NULL }).put("doNotDisturb", dnd).put("autoAccept", autoAccept), "PATCH")
        prefs(c).edit().putString("name", name).putString("room", room).putBoolean("dnd", dnd).putBoolean("autoAccept", autoAccept).apply()
        DebugEvents.add(c, "TV settings saved")
        return result
    }
    fun localName(c: Context) = prefs(c).getString("name", "Living Room TV") ?: "Living Room TV"
    fun localRoom(c: Context) = prefs(c).getString("room", "Bedroom").orEmpty().ifBlank { "Bedroom" }
    fun localAutoAccept(c: Context) = prefs(c).getBoolean("autoAccept", false)
    fun localDnd(c: Context) = prefs(c).getBoolean("dnd", false)
    fun ringtone(c: Context) = prefs(c).getBoolean("ringtone", true)
    fun setRingtone(c: Context, value: Boolean) { prefs(c).edit().putBoolean("ringtone", value).apply() }
    fun overlay(c: Context) = prefs(c).getBoolean("overlay", false)
    fun setOverlay(c: Context, value: Boolean) { prefs(c).edit().putBoolean("overlay", value).apply() }
    fun tvAudioCompatibility(c: Context) = prefs(c).getBoolean("tvAudioCompatibility", true)
    fun setTvAudioCompatibility(c: Context, value: Boolean) { prefs(c).edit().putBoolean("tvAudioCompatibility", value).apply() }
    fun reliable(c: Context) = prefs(c).getBoolean("reliable", false)
    fun setReliable(c: Context, value: Boolean) {
        prefs(c).edit().putBoolean("reliable", value).apply()
        RegistrationWorker.configurePeriodic(c, value)
        DebugEvents.add(c, "Reliable mode ${if (value) "enabled" else "disabled"}")
    }
    fun runAsTv(c: Context) = prefs(c).getBoolean("runAsTv", false)
    fun setRunAsTv(c: Context, value: Boolean) { prefs(c).edit().putBoolean("runAsTv", value).apply() }
    fun deviceMode(c: Context) = prefs(c).getString("deviceMode", "auto") ?: "auto"
    fun setDeviceMode(c: Context, mode: String) {
        require(mode in listOf("auto", "tv", "phone"))
        prefs(c).edit().putString("deviceMode", mode).putBoolean("runAsTv", mode == "tv").commit()
        if (!isTvMode(c)) RegistrationWorker.configurePeriodic(c, false)
    }
    fun isTvMode(c: Context): Boolean {
        val ui = c.getSystemService(UiModeManager::class.java).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
        return DeviceModePolicy.isTv(deviceMode(c), ui,
            c.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK), runAsTv(c))
    }
    fun signOutRemoved(c: Context) {
        FirebaseAuth.getInstance().signOut()
        prefs(c).edit().remove("name").remove("room").remove("dnd").apply()
        DebugEvents.add(c, "TV authorization removed; approval required")
    }
    private fun http(url: String, body: JSONObject?, token: String?, method: String): JSONObject {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 8_000
        conn.readTimeout = if (url.endsWith("/api/config")) 90_000 else 12_000
        conn.requestMethod = method
        conn.setRequestProperty("Content-Type", "application/json")
        if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
        try {
            if (body != null) { conn.doOutput = true; conn.outputStream.use { it.write(body.toString().toByteArray()) } }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (status !in 200..299) throw HttpFailure(status, json.optString("error", "HTTP $status"))
            return json
        } finally { conn.disconnect() }
    }
}
