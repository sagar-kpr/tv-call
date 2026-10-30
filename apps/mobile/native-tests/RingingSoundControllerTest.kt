package dev.tvcall.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class RingingSoundControllerTest {
    @Test fun repeatedValidatedUpdatesStartSoundOnlyOnce() {
        var starts = 0; var stops = 0
        val sound = RingingSoundController({ starts++ }, { stops++ })
        repeat(4) { sound.update("ringing", 2000, 1000, true) }
        assertEquals(1, starts); assertEquals(0, stops)
        sound.close(); sound.close(); assertEquals(1, stops)
    }
    @Test fun everyTerminalStateStopsAndCannotBeRestartedByStaleUpdate() {
        for (state in listOf("accepted", "declined", "cancelled", "missed", "ended", "failed", "busy")) {
            var starts = 0; var stops = 0
            val sound = RingingSoundController({ starts++ }, { stops++ })
            sound.update("ringing", 2000, 1000, true)
            sound.update(state, 2000, 1100, true)
            sound.update("ringing", 2000, 1200, true)
            assertEquals(1, starts); assertEquals(1, stops)
        }
    }
    @Test fun expiredOrAlreadyCancelledInvitationNeverStartsSound() {
        var starts = 0
        RingingSoundController({ starts++ }, {}).update("ringing", 1000, 1000, true)
        RingingSoundController({ starts++ }, {}).update("cancelled", 2000, 1000, true)
        assertEquals(0, starts)
    }
    @Test fun disabledSettingIsRespectedAndCanSilenceAnExistingRing() {
        var starts = 0; var stops = 0
        val sound = RingingSoundController({ starts++ }, { stops++ })
        sound.update("ringing", 2000, 1000, false); assertEquals(0, starts)
        sound.update("ringing", 2000, 1100, true); assertEquals(1, starts)
        sound.update("ringing", 2000, 1200, false); assertEquals(1, stops)
        sound.close(); assertEquals(1, stops)
    }
    @Test fun closingBeforeValidationPreventsLatePlayback() {
        var starts = 0
        val sound = RingingSoundController({ starts++ }, {})
        sound.close(); sound.update("ringing", 2000, 1000, true)
        assertEquals(0, starts)
    }
}
