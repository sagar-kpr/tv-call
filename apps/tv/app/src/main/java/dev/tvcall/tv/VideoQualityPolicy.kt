package dev.tvcall.tv

internal object VideoQualityPolicy {
    fun saveData(acceptedAt: Long, now: Long): Boolean = acceptedAt > 0 && now - acceptedAt >= 15 * 60_000L
}
