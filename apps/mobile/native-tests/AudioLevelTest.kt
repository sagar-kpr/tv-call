package dev.tvcall.tv

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Test

class AudioLevelTest {
    @Test fun distinguishesMissingSamplesAndDigitalSilence() {
        val meter = AudioLevel()
        assertEquals("no samples", meter.read())
        meter.accept(ByteBuffer.wrap(byteArrayOf(0, 0, 0, 0)), 16)
        assertEquals("silent", meter.read())
        assertEquals("no samples", meter.read())
    }
    @Test fun handlesFullNegativeScaleWithoutShortOverflow() {
        val meter = AudioLevel()
        meter.accept(ByteBuffer.wrap(byteArrayOf(0, -128)), 16)
        assertEquals("100%", meter.read())
    }
    @Test fun respectsBufferBoundsWithoutChangingItsPosition() {
        val data = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
        data.putShort(32767); data.putShort(16384); data.putShort(0); data.putShort(32767)
        data.position(2); data.limit(6)
        val meter = AudioLevel(); meter.accept(data, 16)
        assertEquals("50%", meter.read()); assertEquals(2, data.position()); assertEquals(6, data.limit())
    }
    @Test fun unsupportedFormatIsNotReportedAsSilent() {
        val meter = AudioLevel(); meter.accept(ByteBuffer.allocate(8), 32)
        assertEquals("meter unavailable", meter.read())
    }
}
