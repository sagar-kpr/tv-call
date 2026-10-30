package dev.tvcall.tv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceModePolicyTest {
    @Test fun ordinaryPhoneOpensCaller() {
        assertFalse(DeviceModePolicy.isTv("auto", false, false))
    }
    @Test fun televisionUiAloneOpensTvReceiver() {
        assertTrue(DeviceModePolicy.isTv("auto", true, false))
    }
    @Test fun leanbackAloneOpensTvReceiver() {
        assertTrue(DeviceModePolicy.isTv("auto", false, true))
    }
    @Test fun bothTvSignalsOpenReceiver() {
        assertTrue(DeviceModePolicy.isTv("auto", true, true))
    }
    @Test fun manualTvOverrideHandlesMisreportedFirmware() {
        assertTrue(DeviceModePolicy.isTv("tv", false, false))
    }
    @Test fun manualPhoneOverrideTakesPriority() {
        assertFalse(DeviceModePolicy.isTv("phone", true, true, true))
    }
    @Test fun legacyTvOverrideStillWorks() {
        assertTrue(DeviceModePolicy.isTv("auto", false, false, true))
    }
    @Test fun clearingOverrideRestoresDetection() {
        assertFalse(DeviceModePolicy.isTv("auto", false, false, false))
    }
}
