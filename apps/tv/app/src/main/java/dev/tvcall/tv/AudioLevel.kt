package dev.tvcall.tv

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs

/** In-memory peak meter only. No PCM samples are retained, logged or uploaded. */
internal class AudioLevel {
    private val peak = AtomicInteger(0)
    private val callbacks = AtomicInteger(0)
    @Volatile private var supported = true

    fun accept(data: ByteBuffer, bitsPerSample: Int) {
        supported = bitsPerSample == 16
        callbacks.incrementAndGet()
        if (!supported) return
        val samples = data.duplicate().order(ByteOrder.LITTLE_ENDIAN)
        var maximum = 0
        while (samples.remaining() >= 2) maximum = maxOf(maximum, abs(samples.short.toInt()))
        var old = peak.get()
        while (maximum > old && !peak.compareAndSet(old, maximum)) old = peak.get()
    }
    fun read(): String {
        val received = callbacks.getAndSet(0)
        val maximum = peak.getAndSet(0)
        if (received == 0) return "no samples"
        if (!supported) return "meter unavailable"
        // Peak percentage is a diagnostic indicator, not calibrated loudness.
        return if (maximum == 0) "silent" else "${maxOf(1, maximum * 100 / 32768)}%"
    }
}
