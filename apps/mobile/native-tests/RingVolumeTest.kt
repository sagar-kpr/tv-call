package dev.tvcall.tv

import org.junit.Assert.*
import org.junit.Test

class RingVolumeTest {
    @Test fun quietVolumeIsRaisedAndRestored() {
        val volume = RingVolume(2, 10)
        assertEquals(7, volume.raised)
        assertEquals(2, volume.restore(7))
    }
    @Test fun userVolumeChangeIsPreserved() { assertNull(RingVolume(2, 10).restore(5)) }
    @Test fun alreadyLoudVolumeIsNotLoweredOrRestored() {
        val volume = RingVolume(9, 10)
        assertEquals(9, volume.raised)
        assertNull(volume.restore(9))
    }
}
