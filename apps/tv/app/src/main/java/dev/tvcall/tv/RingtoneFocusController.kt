package dev.tvcall.tv

/** Focus recovery belongs to the live invitation, never to a released player. */
internal class RingtoneFocusController(
    private val request: () -> Boolean,
    private val resume: () -> Unit,
    private val pause: () -> Unit,
    private val schedule: () -> Unit,
    private val cancel: () -> Unit
) {
    private var active = false
    private var retryPending = false
    fun start() {
        if (active) return
        active = true
        retry()
    }
    fun lost() {
        if (!active) return
        pause()
        if (!retryPending) { retryPending = true; schedule() }
    }
    fun gained() {
        if (!active) return
        retryPending = false; cancel(); resume()
    }
    fun retry() {
        if (!active) return
        retryPending = false
        if (request()) gained() else lost()
    }
    fun close() {
        active = false; retryPending = false; cancel(); pause()
    }
}
