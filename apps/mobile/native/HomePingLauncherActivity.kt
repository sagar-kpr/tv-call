package dev.tvcall.caller

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import dev.tvcall.tv.Backend
import dev.tvcall.tv.SetupActivity

/** The same launcher entry point is visible to phone and Leanback launchers. */
class HomePingLauncherActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val destination = if (Backend.isTvMode(this)) SetupActivity::class.java else MainActivity::class.java
        startActivity(Intent(this, destination).apply {
            // Preserve OAuth/deep-link data while routing normal launcher starts.
            data = intent.data
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        })
        finish()
    }
}
