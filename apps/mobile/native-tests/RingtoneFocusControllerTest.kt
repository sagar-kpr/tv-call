package dev.tvcall.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class RingtoneFocusControllerTest {
    private class Fixture {
        var granted = true
        var requests = 0
        var resumes = 0
        var pauses = 0
        var scheduled = 0
        var cancelled = 0
        val control = RingtoneFocusController(
            { requests++; granted }, { resumes++ }, { pauses++ }, { scheduled++ }, { cancelled++ })
    }
    @Test fun newMediaTrackCannotPermanentlySilenceActiveInvitation() {
        val f = Fixture()
        f.control.start()
        repeat(3) { f.control.lost(); f.control.retry() }
        assertEquals(4, f.requests); assertEquals(4, f.resumes)
        assertEquals(3, f.scheduled)
    }
    @Test fun deniedFocusRetriesWithoutPlayingUntilGranted() {
        val f = Fixture(); f.granted = false
        f.control.start(); f.control.retry()
        assertEquals(0, f.resumes); assertEquals(2, f.scheduled)
        f.granted = true; f.control.retry()
        assertEquals(1, f.resumes)
    }
    @Test fun repeatedLossOnlySchedulesOneRecoveryAndGainCancelsIt() {
        val f = Fixture(); f.control.start()
        repeat(4) { f.control.lost() }
        assertEquals(1, f.scheduled)
        val cancelled = f.cancelled
        f.control.gained()
        assertEquals(cancelled + 1, f.cancelled)
    }
    @Test fun closingOnAcceptRejectCancelOrExpiryBlocksLateFocusEvents() {
        val f = Fixture(); f.control.start(); f.control.lost(); f.control.close()
        f.control.retry(); f.control.gained(); f.control.lost()
        assertEquals(1, f.requests); assertEquals(1, f.resumes); assertEquals(1, f.scheduled)
    }
    @Test fun ringtoneCanBeDisabledThenEnabledForAnActiveInvitation() {
        val f = Fixture(); f.control.start(); f.control.close(); f.control.start()
        assertEquals(2, f.requests); assertEquals(2, f.resumes)
    }
}
