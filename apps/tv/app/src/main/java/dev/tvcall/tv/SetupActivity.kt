package dev.tvcall.tv

import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.*
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import org.json.JSONObject

class SetupActivity : Activity() {
    @Volatile private var alive = true
    @Volatile private var activeAuthorization: String? = null
    @Volatile private var foregroundCheck = false
    private var pageName = "home"
    private var revision = 0
    private var working = false
    private var refreshPermission = false
    private var loader: Dialog? = null
    private var preview: IncomingRinger? = null
    private val main = Handler(Looper.getMainLooper())
    private val stopPreview = Runnable { preview?.stop(); preview = null }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN, android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        if (Backend.authorized(this)) {
            if (intent.getBooleanExtra("advanced", false)) advanced() else {
                home()
                work("Getting your TV ready…", { Backend.register(this) }, { home() })
            }
        } else welcome()
    }
    override fun onResume() {
        super.onResume()
        if (refreshPermission && Backend.authorized(this)) { refreshPermission = false; home() }
        if (!Backend.authorized(this) || !Backend.isTvMode(this) || foregroundCheck) return
        foregroundCheck = true
        Backend.io.execute {
            try {
                val call = Backend.api(this, "/tv/active-call").optJSONObject("call")
                runOnUiThread {
                    if (alive && call != null && IncomingPromptPolicy.choose(call.optString("status"), call.optLong("expiresAt"),
                        System.currentTimeMillis(), IncomingPresentation.screen(), Backend.overlay(this), Settings.canDrawOverlays(this)) == IncomingPromptPolicy.Path.FOREGROUND)
                        IncomingPresentation.showInForeground(call.getString("id"))
                }
            } catch (_: Exception) { /* The incoming service remains the primary delivery path. */ }
            finally { foregroundCheck = false }
        }
    }
    override fun onPause() {
        main.removeCallbacks(stopPreview); stopPreview.run(); loader?.dismiss(); loader = null
        super.onPause()
    }
    private fun page(name: String, body: LinearLayout): LinearLayout {
        revision++; pageName = name
        val root = TvUi.screen(this)
        root.addView(TvUi.brand(this) { startActivity(Intent(this, ModeActivity::class.java)) })
        root.addView(TvUi.space(this, 16))
        root.addView(body, LinearLayout.LayoutParams(-1, -2))
        val scroll = ScrollView(this).apply { isFillViewport = true; clipToPadding = false; addView(root) }
        setContentView(scroll)
        return root
    }
    private fun stack() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun gap(view: LinearLayout, value: Int = 14) { view.addView(TvUi.space(this, value)) }
    private fun message(value: String) = Toast.makeText(this, value, Toast.LENGTH_LONG).show()
    private fun back(body: LinearLayout, title: String, action: () -> Unit) {
        val bar = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        bar.addView(TvUi.button(this, "Back", click = action), LinearLayout.LayoutParams(TvUi.dp(this, 100), -2))
        bar.addView(TvUi.heading(this, title, 30f), LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = TvUi.dp(this@SetupActivity, 20) })
        body.addView(bar); gap(body, 16)
    }
    private fun <T> work(label: String, action: () -> T, done: (T) -> Unit) {
        if (working) return
        working = true
        val screen = revision
        loader = TvUi.loading(this, label)
        Backend.io.execute {
            val result = runCatching(action)
            runOnUiThread {
                working = false; loader?.dismiss(); loader = null
                if (!alive || screen != revision) return@runOnUiThread
                result.onSuccess(done).onFailure {
                    if (it is HttpFailure && it.status == 403 && Backend.authorized(this)) {
                        Backend.signOutRemoved(this); welcome()
                    } else message("Couldn’t connect. Check your internet connection and try again.")
                }
            }
        }
    }
    private fun home() {
        val body = stack()
        val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val intro = stack()
        intro.addView(TvUi.text(this, "YOUR HOME, A LITTLE CLOSER", 12f, true).apply { letterSpacing = .15f })
        gap(intro, 16)
        intro.addView(TvUi.heading(this, Backend.localName(this), 42f))
        if (Backend.localRoom(this).isNotBlank()) { gap(intro, 6); intro.addView(TvUi.text(this, Backend.localRoom(this), 18f, true)) }
        gap(intro, 20)
        intro.addView(TvUi.text(this, "Call this TV from HomePing on your phone or browser.\nYou can return to Home and keep watching.", 18f, true))
        gap(intro, 22)
        intro.addView(TvUi.text(this, if (Backend.localDnd(this)) "Do Not Disturb is on" else "Connected to your HomePing account", 15f))
        row.addView(intro, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = TvUi.dp(this@SetupActivity, 32) })
        val actions = TvUi.card(this)
        actions.addView(TvUi.heading(this, "Make yourself at home.", 23f)); gap(actions)
        actions.addView(TvUi.text(this, "Your next conversation is only a call away.", 15f, true)); gap(actions, 24)
        val settings = TvUi.button(this, "TV settings", primary = true) { settings() }; actions.addView(settings)
        gap(actions, 12); actions.addView(TvUi.button(this, "Go to Home") { goHome() })
        row.addView(actions, LinearLayout.LayoutParams(TvUi.dp(this, 300), -2)); body.addView(row)
        if (!Backend.overlay(this) || !Settings.canDrawOverlays(this)) {
            gap(body, 24)
            val permission = TvUi.card(this)
            permission.addView(TvUi.heading(this, "Allow call pop-ups", 20f)); gap(permission, 6)
            permission.addView(TvUi.text(this, "A one-time permission lets calls appear while you watch TV.", 15f, true)); gap(permission, 14)
            permission.addView(TvUi.button(this, "Enable call pop-ups") { enablePopups() })
            body.addView(permission)
        }
        page("home", body); settings.requestFocus()
    }
    private fun settings() {
        val body = stack(); back(body, "TV settings") { home() }
        val row = LinearLayout(this)
        val identity = TvUi.card(this).apply { setPadding(TvUi.dp(this@SetupActivity, 20), TvUi.dp(this@SetupActivity, 12), TvUi.dp(this@SetupActivity, 20), TvUi.dp(this@SetupActivity, 12)) }
        identity.addView(TvUi.text(this, "TV name", 14f, true)); gap(identity, 8)
        val name = TvUi.input(this, "TV name", Backend.localName(this)); identity.addView(name); gap(identity, 12)
        identity.addView(TvUi.text(this, "Room", 14f, true)); gap(identity, 8)
        val room = TvUi.input(this, "Optional", Backend.localRoom(this)); identity.addView(room); gap(identity, 16)
        identity.addView(TvUi.button(this, "Save changes", primary = true) {
            if (name.text.toString().trim().isEmpty()) { message("Give your TV a name."); return@button }
            work("Saving changes…", { Backend.updateSettings(this, name.text.toString(), room.text.toString(), Backend.localDnd(this)) }, { message("Changes saved"); home() })
        })
        row.addView(identity, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = TvUi.dp(this@SetupActivity, 22) })
        val preferences = TvUi.card(this).apply { setPadding(TvUi.dp(this@SetupActivity, 20), TvUi.dp(this@SetupActivity, 12), TvUi.dp(this@SetupActivity, 20), TvUi.dp(this@SetupActivity, 12)) }
        preferences.addView(TvUi.heading(this, "Call preferences", 22f)); gap(preferences, 12)
        val dnd = TvUi.button(this, "Do Not Disturb: ${if (Backend.localDnd(this)) "On" else "Off"}") {}
        dnd.setOnClickListener {
            work("Updating preferences…", { Backend.updateSettings(this, Backend.localName(this), Backend.localRoom(this), !Backend.localDnd(this)) }, { dnd.text = "Do Not Disturb: ${if (Backend.localDnd(this)) "On" else "Off"}" })
        }
        preferences.addView(dnd); gap(preferences, 10)
        val ringtone = TvUi.button(this, "Ringtone: ${if (Backend.ringtone(this)) "On" else "Off"}") {}
        ringtone.setOnClickListener {
            Backend.setRingtone(this, !Backend.ringtone(this)); ringtone.text = "Ringtone: ${if (Backend.ringtone(this)) "On" else "Off"}"
            if (!Backend.ringtone(this)) stopPreview.run()
        }
        preferences.addView(ringtone); gap(preferences, 10)
        preferences.addView(TvUi.button(this, "Test ringtone") {
            main.removeCallbacks(stopPreview); stopPreview.run()
            if (!Backend.ringtone(this)) { message("Turn on the ringtone to play a preview."); return@button }
            volumeControlStream = android.media.AudioManager.STREAM_MUSIC
            preview = IncomingRinger(this).also { it.start() }; main.postDelayed(stopPreview, 8_000)
        }); gap(preferences, 12)
        preferences.addView(TvUi.button(this, "About this TV") { about() })
        row.addView(preferences, LinearLayout.LayoutParams(0, -2, 1f)); body.addView(row)
        page("settings", body); name.requestFocus()
    }
    private fun about() {
        val body = stack(); back(body, "About this TV") { settings() }
        val card = TvUi.card(this)
        val hardware = Backend.hardware(this, null)
        for ((label, value) in listOf(
            "TV" to "${hardware.getString("manufacturer")} ${hardware.getString("model")}",
            "Android" to hardware.getString("androidVersion"),
            "Display" to "${hardware.getInt("screenWidthPx")} × ${hardware.getInt("screenHeightPx")}",
            "Camera" to if (hardware.getInt("cameraApiCount") > 0) "Available" else "Not detected")) {
            card.addView(TvUi.text(this, label, 13f, true)); gap(card, 5); card.addView(TvUi.text(this, value, 18f)); gap(card, 18)
        }
        body.addView(card); page("about", body)
    }
    private fun advanced() {
        val body = stack(); back(body, "Advanced TV preferences") { finish() }
        body.addView(TvUi.text(this, "Change these only when troubleshooting this TV.", 15f, true)); gap(body, 20)
        val audio = TvUi.button(this, "TV audio compatibility: ${if (Backend.tvAudioCompatibility(this)) "On" else "Off"}") {}
        audio.setOnClickListener { Backend.setTvAudioCompatibility(this, !Backend.tvAudioCompatibility(this)); advanced() }
        body.addView(audio); gap(body, 12)
        val reliable = TvUi.button(this, "Reliable mode: ${if (Backend.reliable(this)) "On" else "Off"}") {}
        reliable.setOnClickListener { Backend.setReliable(this, !Backend.reliable(this)); advanced() }
        body.addView(reliable); gap(body, 12)
        body.addView(TvUi.button(this, "Allow call pop-ups") { enablePopups() })
        page("advanced", body)
    }
    private fun enablePopups() {
        Backend.setOverlay(this, true)
        if (Settings.canDrawOverlays(this)) { home(); return }
        try { refreshPermission = true; startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }
        catch (_: Exception) { message("This TV needs one-time setup to allow call pop-ups. See the HomePing setup guide.") }
    }
    private fun welcome() {
        val body = stack()
        body.addView(TvUi.heading(this, "Bring home a little closer.", 40f)); gap(body, 14)
        body.addView(TvUi.text(this, "Connect this TV to your HomePing account.\nUse your phone to sign in—no password typing on your remote.", 19f, true)); gap(body, 28)
        val connect = TvUi.button(this, "Connect this TV", primary = true) {
            work("Connecting to HomePing…", {
                Backend.configure(this, Backend.base(this)); Backend.beginAuthorization(this)
            }, { authorization(it) })
        }
        body.addView(connect, LinearLayout.LayoutParams(TvUi.dp(this, 250), -2)); page("welcome", body); connect.requestFocus()
    }
    private fun authorization(started: JSONObject) {
        val id = started.getString("authorizationId"); activeAuthorization = id
        val code = started.getString("code")
        val body = stack()
        val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val steps = stack()
        steps.addView(TvUi.heading(this, "Connect in a moment.", 36f)); gap(steps, 18)
        steps.addView(TvUi.text(this, "1  Scan the QR code with your phone.\n2  Sign in to your HomePing account.\n3  Confirm this TV to finish connecting.", 18f, true)); gap(steps, 22)
        steps.addView(TvUi.text(this, "Approve only if this code is on your own TV.", 14f))
        row.addView(steps, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = TvUi.dp(this@SetupActivity, 30) })
        val qrCard = TvUi.card(this).apply { gravity = Gravity.CENTER_HORIZONTAL }
        val url = "${Backend.approvalBase(this)}/?activate=${Uri.encode(code)}"
        qrCard.addView(ImageView(this).apply {
            setImageBitmap(qr(url)); contentDescription = "Scan to connect this TV"; setBackgroundColor(Color.WHITE)
            setPadding(12, 12, 12, 12)
        }, LinearLayout.LayoutParams(TvUi.dp(this, 185), TvUi.dp(this, 185)))
        gap(qrCard, 14); qrCard.addView(TvUi.heading(this, code.chunked(4).joinToString(" "), 25f))
        gap(qrCard, 8); qrCard.addView(TvUi.text(this, "Code expires in 10 minutes", 12f, true))
        gap(qrCard, 12); qrCard.addView(TvUi.text(this, Backend.approvalBase(this), 12f, true))
        row.addView(qrCard, LinearLayout.LayoutParams(TvUi.dp(this, 300), -2)); body.addView(row)
        gap(body, 20)
        val status = TvUi.text(this, "Waiting for approval on your phone…", 15f, true); body.addView(status)
        gap(body, 12)
        val retry = TvUi.button(this, "Get a new code") { activeAuthorization = null; welcome() }.apply { visibility = View.GONE }
        body.addView(retry); page("authorization", body)
        Backend.io.execute {
            while (alive && activeAuthorization == id && System.currentTimeMillis() < started.getLong("expiresAt")) {
                try {
                    if (Backend.pollAuthorization(this, id).optString("status") == "approved") {
                        Backend.register(this)
                        runOnUiThread { if (alive && activeAuthorization == id) { activeAuthorization = null; home() } }; return@execute
                    }
                } catch (e: HttpFailure) { if (e.status in listOf(409, 410)) break }
                catch (_: Exception) { /* The ten-minute deadline still applies. */ }
                Thread.sleep(5_000)
            }
            runOnUiThread { if (alive && activeAuthorization == id) { status.text = "This code has expired. Get a new code to continue."; retry.visibility = View.VISIBLE; retry.requestFocus() } }
        }
    }
    private fun qr(value: String): Bitmap {
        val matrix = MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 360, 360)
        return Bitmap.createBitmap(360, 360, Bitmap.Config.RGB_565).apply {
            for (x in 0 until 360) for (y in 0 until 360) setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
        }
    }
    private fun goHome() { startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); finish() }
    @Deprecated("TV back follows the local page hierarchy")
    override fun onBackPressed() {
        when (pageName) { "settings" -> home(); "about" -> settings(); "advanced" -> finish(); else -> goHome() }
    }
    override fun onDestroy() { alive = false; activeAuthorization = null; main.removeCallbacks(stopPreview); stopPreview.run(); loader?.dismiss(); super.onDestroy() }
}
