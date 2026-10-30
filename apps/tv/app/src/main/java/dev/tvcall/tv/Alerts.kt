package dev.tvcall.tv

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat

object Alerts {
    const val CHANNEL = "incoming-v1"
    const val ID = 1001
    fun channels(c: Context) {
        c.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Incoming TV calls", NotificationManager.IMPORTANCE_HIGH).apply { description = "Incoming invitation alerts; test visibility on this TV" })
    }
    fun activity(c: Context, type: Class<*>, id: String, action: String = ""): Intent = Intent(c, type)
        .putExtra("callId", id).putExtra("action", action).setData(android.net.Uri.parse("tvcall://call/$id/$action/${type.simpleName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    fun notification(c: Context, id: String, expiresAt: Long): Notification {
        c.getSharedPreferences("alerts", Context.MODE_PRIVATE).edit().putString("active", id).apply()
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val accept = PendingIntent.getActivity(c, 1, activity(c, CallActivity::class.java, id, "accept"), flags)
        val open = PendingIntent.getActivity(c, 2, activity(c, IncomingActivity::class.java, id), flags)
        val reject = PendingIntent.getBroadcast(c, 3, Intent(c, ActionReceiver::class.java).putExtra("callId", id).setData(android.net.Uri.parse("tvcall://reject/$id")), flags)
        val builder = NotificationCompat.Builder(c, CHANNEL).setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle("Incoming TV call").setContentText("Accept or reject with your remote")
            .setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC).setOngoing(true).setOnlyAlertOnce(true)
            .setTimeoutAfter((expiresAt - System.currentTimeMillis()).coerceAtLeast(1))
            .setContentIntent(open).setFullScreenIntent(open, true)
            .addAction(android.R.drawable.sym_action_call, "Accept", accept).addAction(android.R.drawable.ic_delete, "Reject", reject)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        builder.extend(NotificationCompat.TvExtender().setContentIntent(open))
        return builder.build()
    }
    fun clear(c: Context, id: String) {
        val prefs = c.getSharedPreferences("alerts", Context.MODE_PRIVATE)
        if(prefs.getString("active", null) == id) c.getSystemService(NotificationManager::class.java).cancel(ID)
    }
}
object Ui {
    fun column(c: Context): LinearLayout = LinearLayout(c).apply {
        orientation = LinearLayout.VERTICAL; setPadding(64, 36, 64, 36); setBackgroundColor(Color.rgb(18, 38, 31))
    }
    fun text(c: Context, label: String, size: Float = 22f): TextView = TextView(c).apply { text = label; textSize = size; setTextColor(Color.WHITE); setPadding(0, 8, 0, 12) }
    fun input(c: Context, label: String, value: String = ""): EditText = EditText(c).apply {
        hint = label; setText(value); setSingleLine(true); textSize = 19f; isFocusable = true
        setPadding(18, 14, 18, 14)
        setOnFocusChangeListener { _, focused ->
            setTextColor(if (focused) Color.BLACK else Color.WHITE)
            setHintTextColor(if (focused) Color.DKGRAY else Color.LTGRAY)
            setBackgroundColor(if (focused) Color.rgb(211, 239, 177) else Color.rgb(48, 80, 62))
        }
        setTextColor(Color.WHITE); setHintTextColor(Color.LTGRAY); setBackgroundColor(Color.rgb(48, 80, 62))
    }
    fun button(c: Context, label: String, click: () -> Unit): Button = Button(c).apply {
        text = label; textSize = 20f; isFocusable = true; setOnClickListener { click() }
        setOnFocusChangeListener { _, focused -> setTextColor(if(focused) Color.BLACK else Color.WHITE); setBackgroundColor(if(focused) Color.rgb(211,239,177) else Color.rgb(48,80,62)) }
    }
}
