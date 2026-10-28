package dev.tvcall.tv

import android.app.Application
import android.content.Context
import android.os.Build
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.FirebaseMessaging
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class TvApp : Application() {
    override fun onCreate() { super.onCreate(); Backend.restore(this); Alerts.channels(this); if(Backend.base(this).isNotBlank()) RegistrationWorker.enqueue(this) }
}
object Backend {
    val io = Executors.newFixedThreadPool(4)
    private fun prefs(c: Context) = c.getSharedPreferences("tv-call", Context.MODE_PRIVATE)
    fun base(c: Context) = prefs(c).getString("backend", "") ?: ""
    fun restore(c: Context) {
        val saved = prefs(c).getString("firebase", null) ?: return
        if (FirebaseApp.getApps(c).isEmpty()) initialize(c, JSONObject(saved))
    }
    private fun initialize(c: Context, config: JSONObject) {
        FirebaseApp.initializeApp(c, FirebaseOptions.Builder().setApiKey(config.getString("apiKey"))
            .setApplicationId(config.getString("androidAppId")).setProjectId(config.getString("projectId"))
            .setGcmSenderId(config.getString("messagingSenderId")).build())
    }
    fun configure(c: Context, url: String) {
        val normalized = url.trim().trimEnd('/')
        require(normalized.startsWith("https://") && URL(normalized).host.isNotBlank()) { "Enter an HTTPS backend URL" }
        // Firebase identity is retained across setup retries. Changing projects requires clearing app data.
        val config = http("$normalized/api/config", null, null)
        val old = prefs(c).getString("firebase", null)
        if (old != null) require(JSONObject(old).getString("projectId") == config.getString("projectId")) { "Clear app data before changing Firebase projects" }
        prefs(c).edit().putString("backend", normalized).putString("firebase", config.toString()).commit()
        if (FirebaseApp.getApps(c).isEmpty()) initialize(c, config)
        register(c)
    }
    @Synchronized
    private fun token(): String {
        val auth = FirebaseAuth.getInstance()
        if (auth.currentUser == null) Tasks.await(auth.signInAnonymously(), 10, TimeUnit.SECONDS)
        return Tasks.await(auth.currentUser!!.getIdToken(false), 10, TimeUnit.SECONDS).token!!
    }
    fun api(c: Context, path: String, body: JSONObject? = null): JSONObject {
        require(base(c).isNotBlank()) { "Configure the TV app first" }
        return http("${base(c)}/api$path", body, token())
    }
    fun action(c: Context, id: String, action: String) = api(c, "/calls/$id/action", JSONObject().put("action", action))
    fun register(c: Context, supplied: String? = null) {
        if (base(c).isBlank()) return
        val push = supplied ?: Tasks.await(FirebaseMessaging.getInstance().token, 10, TimeUnit.SECONDS)
        val hardware = JSONObject().put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL)
            .put("android", Build.VERSION.RELEASE).put("sdk", Build.VERSION.SDK_INT.toString()).put("firmware", Build.DISPLAY)
        api(c, "/devices/register", JSONObject().put("name", "${Build.MANUFACTURER} ${Build.MODEL}").put("token", push).put("hardware", hardware))
        Log.i("HomePing", "Device registration updated (no token logged)")
    }
    fun overlay(c: Context) = prefs(c).getBoolean("overlay", false)
    fun setOverlay(c: Context, enabled: Boolean) { prefs(c).edit().putBoolean("overlay", enabled).apply() }
    private fun http(url: String, body: JSONObject?, token: String?): JSONObject {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 5000; conn.readTimeout = 5000
        conn.setRequestProperty("Content-Type", "application/json")
        if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
        try {
            if (body != null) { conn.requestMethod = "POST"; conn.doOutput = true; conn.outputStream.use { it.write(body.toString().toByteArray()) } }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val response = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
            val json = JSONObject(response)
            check(status in 200..299) { json.optString("error", "HTTP $status") }
            return json
        } finally { conn.disconnect() }
    }
}
