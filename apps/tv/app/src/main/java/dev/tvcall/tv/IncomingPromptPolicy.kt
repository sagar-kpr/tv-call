package dev.tvcall.tv

/** A background notification is not proof that a visible prompt is allowed. */
internal object IncomingPromptPolicy {
    enum class Screen { SETUP, INCOMING, CALL, OTHER, BACKGROUND }
    enum class Path { NONE, FOREGROUND, ALREADY_VISIBLE, OVERLAY, NOTIFICATION }
    fun choose(status: String, expiresAt: Long, now: Long, screen: Screen,
        overlayEnabled: Boolean, overlayAllowed: Boolean): Path {
        if (status != "ringing" || expiresAt <= now) return Path.NONE
        return when (screen) {
            Screen.SETUP -> Path.FOREGROUND
            Screen.INCOMING, Screen.CALL -> Path.ALREADY_VISIBLE
            else -> if (overlayEnabled && overlayAllowed) Path.OVERLAY else Path.NOTIFICATION
        }
    }
}
