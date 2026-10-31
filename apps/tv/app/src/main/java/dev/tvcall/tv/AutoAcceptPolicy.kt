package dev.tvcall.tv

internal object AutoAcceptPolicy {
    fun due(enabled: Boolean, ringDeadline: Long, allowedUntil: Long, now: Long): Boolean =
        enabled && allowedUntil > ringDeadline && now >= ringDeadline && now < allowedUntil
}
