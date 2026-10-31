package dev.tvcall.tv

import org.junit.Assert.*
import org.junit.Test

class VideoQualityPolicyTest {
    @Test fun dataSavingUsesCallAcceptanceTimeAndNeverRaisesQualityAfterThreshold() {
        assertFalse(VideoQualityPolicy.saveData(1_000, 900_999))
        assertTrue(VideoQualityPolicy.saveData(1_000, 901_000))
        assertTrue(VideoQualityPolicy.saveData(1_000, 1_800_000))
        assertFalse(VideoQualityPolicy.saveData(0, 1_800_000))
        assertFalse(VideoQualityPolicy.saveData(2_000, 1_000))
    }
}
