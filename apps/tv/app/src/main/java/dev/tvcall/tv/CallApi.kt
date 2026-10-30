package dev.tvcall.tv

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Phone login lives in JS Firebase; TV login lives in native Firebase.
 * Caller credentials stay in this activity's memory, never in preferences/logs. */
internal class CallApi(private val context: Context, private var token: String?,
    private var refresh: String?, private val apiKey: String?) {
    val caller get() = token != null
    @Synchronized fun request(path: String, body: JSONObject? = null): JSONObject {
        if (!caller) return Backend.api(context, path, body)
        try { return http("${Backend.base(context)}/api$path", body, token) }
        catch (error: HttpFailure) {
            if (error.status != 401 || refresh.isNullOrBlank() || apiKey.isNullOrBlank()) throw error
            val credentials = http("https://securetoken.googleapis.com/v1/token?key=$apiKey",
                JSONObject().put("grant_type", "refresh_token").put("refresh_token", refresh), null)
            token = credentials.getString("id_token"); refresh = credentials.getString("refresh_token")
            return http("${Backend.base(context)}/api$path", body, token)
        }
    }
    fun action(id: String, action: String) = request("/calls/$id/action", JSONObject().put("action", action))
    private fun http(url: String, body: JSONObject?, bearer: String?): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 8_000; connection.readTimeout = 12_000
        connection.requestMethod = if (body == null) "GET" else "POST"
        connection.setRequestProperty("Content-Type", "application/json")
        if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
        try {
            if (body != null) { connection.doOutput = true; connection.outputStream.use { it.write(body.toString().toByteArray()) } }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val data = try { JSONObject(text) } catch (_: Exception) { throw IllegalStateException("HomePing server unavailable") }
            if (code !in 200..299) throw HttpFailure(code, data.optString("error", "HomePing request failed"))
            return data
        } finally { connection.disconnect() }
    }
}
