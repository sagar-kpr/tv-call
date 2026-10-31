package dev.tvcall.tv

import org.junit.Assert.*
import org.junit.Test

class TvRemoteGuardTest {
    @Test fun quickDoublePressIsIgnoredAfterAcceptance() {
        val guard = TvRemoteGuard(1_000)
        assertTrue(guard.consume(1_100, false, false, 0))
        assertTrue(guard.consume(1_150, false, true, 0))
        assertTrue(guard.consume(1_250, false, false, 0))
        assertTrue(guard.consume(1_300, false, true, 0))
        assertFalse(guard.consume(2_500, false, false, 0))
    }
    @Test fun heldKeyMustBeReleasedBeforeAnotherAction() {
        val guard = TvRemoteGuard(1_000)
        assertTrue(guard.consume(1_100, false, false, 0))
        assertTrue(guard.consume(3_000, false, false, 8))
        assertTrue(guard.consume(3_100, false, true, 0))
        assertFalse(guard.consume(3_200, false, false, 0))
    }
    @Test fun connectingBlocksRemoteEvenAfterGraceTime() {
        val guard = TvRemoteGuard(1_000)
        assertTrue(guard.consume(8_000, true, false, 0))
        assertTrue(guard.consume(8_100, false, true, 0))
        assertFalse(guard.consume(8_200, false, false, 0))
    }
}
