package dev.tvcall.tv

object DeviceModePolicy {
    fun isTv(mode: String, televisionUi: Boolean, leanback: Boolean, legacyTvOverride: Boolean = false): Boolean =
        when (mode) {
            "tv" -> true
            "phone" -> false
            else -> televisionUi || leanback || legacyTvOverride
        }
}
