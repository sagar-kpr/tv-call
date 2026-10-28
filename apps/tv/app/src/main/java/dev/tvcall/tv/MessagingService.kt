package dev.tvcall.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class MessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        RegistrationWorker.enqueue(this)
    }
    override fun onMessageReceived(message: RemoteMessage) {
        val id = message.data["callId"] ?: return
        if (!id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) return
        val expiresAt = message.data["expiresAt"]?.toLongOrNull() ?: return
        Log.i("HomePing", "FCM ${message.data["type"]} call=$id receivedAt=${System.currentTimeMillis()}")
        if (message.data["type"] == "cancel") {
            Alerts.clear(this, id)
            sendBroadcast(Intent("$packageName.CLOSE").setPackage(packageName).putExtra("callId", id))
            return
        }
        if (message.data["type"] != "invite" || expiresAt <= System.currentTimeMillis()) return
        val intent = Intent(this, RingService::class.java).putExtra("callId", id).putExtra("expiresAt", expiresAt)
        try { ContextCompat.startForegroundService(this, intent) }
        catch (e: Exception) {
            Log.e("HomePing", "Foreground service unavailable; notification-only fallback", e)
            try { getSystemService(android.app.NotificationManager::class.java).notify(Alerts.ID, Alerts.notification(this, id, expiresAt)) } catch (failure: Exception) { Log.e("HomePing", "Notification failed", failure) }
            Backend.io.execute { try { if (Backend.action(this, id, "receive").optString("status") != "ringing") Alerts.clear(this, id) } catch (_: Exception) {} }
        }
    }
}
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("callId") ?: return
        val pending = goAsync()
        Backend.io.execute {
            try { Backend.action(context, id, "reject") }
            catch (e: Exception) { Log.w("HomePing", "Reject could not reach backend", e) }
            finally {
                context.sendBroadcast(Intent("${context.packageName}.CLOSE").setPackage(context.packageName).putExtra("callId", id)); pending.finish()
            }
        }
    }
}
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        // FCM restores reception; WorkManager retries registration after network returns.
        if(Backend.base(context).isNotBlank()) RegistrationWorker.enqueue(context)
        Log.i("HomePing", "Boot completed; FCM initialized=${com.google.firebase.FirebaseApp.getApps(context).isNotEmpty()}")
    }
}
