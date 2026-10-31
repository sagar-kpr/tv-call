package dev.tvcall.tv

import org.junit.Assert.*
import org.junit.Test

class AutoAcceptPolicyTest {
    @Test fun onlyDueInsideServerGrantedWindow() {
        assertFalse(AutoAcceptPolicy.due(false, 60_000, 70_000, 60_000))
        assertFalse(AutoAcceptPolicy.due(true, 60_000, 70_000, 59_999))
        assertTrue(AutoAcceptPolicy.due(true, 60_000, 70_000, 60_000))
        assertFalse(AutoAcceptPolicy.due(true, 60_000, 70_000, 70_000))
        assertFalse(AutoAcceptPolicy.due(true, 60_000, 0, 60_000))
    }
}
