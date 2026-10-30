package dev.tvcall.tv

/** Drives one invitation's sound from validated server state. */
internal class RingingSoundController(private val play: () -> Unit, private val stop: () -> Unit) {
    private var playing = false
    private var closed = false
    fun update(status: String, deadline: Long, now: Long, enabled: Boolean) {
        if (closed) return
        if (status != "ringing" || deadline <= now) { close(); return }
        if (enabled && !playing) { playing = true; play() }
        else if (!enabled && playing) { playing = false; stop() }
    }
    fun close() {
        if (closed) return
        closed = true
        if (playing) { playing = false; stop() }
    }
}
