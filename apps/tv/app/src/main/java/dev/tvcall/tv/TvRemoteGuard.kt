package dev.tvcall.tv

/** A remote's Accept key must not activate controls in the newly opened activity. */
internal class TvRemoteGuard(private val openedAt: Long) {
    private var swallowUntilRelease = false
    fun consume(now: Long, connecting: Boolean, released: Boolean, repeats: Int): Boolean {
        if (connecting || now - openedAt < 1_500 || repeats > 0 || swallowUntilRelease) {
            swallowUntilRelease = !released
            return true
        }
        return false
    }
}
