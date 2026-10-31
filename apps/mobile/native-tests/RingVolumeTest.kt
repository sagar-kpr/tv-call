package dev.tvcall.tv

import org.junit.Assert.*
import org.junit.Test

class RingVolumeTest {
    @Test fun quietVolumeIsRaisedAndRestored() {
        val volume = RingVolume(1, 10)
        assertEquals(2, volume.raised)
        assertEquals(1, volume.restore(2))
    }
    @Test fun tvScaleOf100Raises10To20AndRestores10() {
        val volume = RingVolume(10, 100)
        assertEquals(20, volume.raised)
        assertEquals(10, volume.restore(20))
    }
    @Test fun volumeAtOrAbove20StaysUnchanged() {
        assertEquals(20, RingVolume(20, 100).raised)
        assertEquals(35, RingVolume(35, 100).raised)
        assertNull(RingVolume(35, 100).restore(35))
    }
    @Test fun userVolumeChangeIsPreserved() { assertNull(RingVolume(1, 10).restore(5)) }
    @Test fun alreadyLoudVolumeIsNotLoweredOrRestored() {
        val volume = RingVolume(9, 10)
        assertEquals(9, volume.raised)
        assertNull(volume.restore(9))
    }
}
