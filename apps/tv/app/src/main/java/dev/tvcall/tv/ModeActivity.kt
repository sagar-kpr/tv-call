package dev.tvcall.tv

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** Hidden setup override for firmware that reports the wrong device category. */
class ModeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = Ui.column(this)
        layout.addView(Ui.text(this, "HomePing device mode", 30f))
        layout.addView(Ui.text(this,
            "Current override: ${Backend.deviceMode(this)}\nAuto detects Android TV / Google TV or opens the phone caller.", 18f))
        val auto = Ui.button(this, "Auto detect") { choose("auto") }
        layout.addView(auto)
        layout.addView(Ui.button(this, "Run as TV") { choose("tv") })
        layout.addView(Ui.button(this, "Run as phone") { choose("phone") })
        layout.addView(Ui.button(this, "Back") { finish() })
        setContentView(layout)
        auto.requestFocus()
    }

    private fun choose(mode: String) {
        Backend.setDeviceMode(this, mode)
        if (Backend.isTvMode(this)) {
            startActivity(Intent(this, SetupActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        } else {
            val phone = Intent().setClassName(packageName, "$packageName.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            if (packageManager.resolveActivity(phone, 0) != null) startActivity(phone)
            else {
                android.widget.Toast.makeText(this, "Install the unified HomePing APK for phone mode.", android.widget.Toast.LENGTH_LONG).show()
                finish()
                return
            }
        }
        finish()
    }
}
