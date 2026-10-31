package dev.tvcall.tv

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class OptionalCameraTest {
    @Test fun missingCameraNeverStartsCapture() = runBlocking {
        assertFalse(OptionalCamera.enable(false) { fail("Capture must not run without a camera"); true })
    }
    @Test fun sdkNoCameraErrorLeavesReceivingCallAlive() = runBlocking {
        assertFalse(OptionalCamera.enable(true) { throw NotImplementedError("No capturer") })
    }
    @Test fun ordinaryCaptureFailureIsOptional() = runBlocking {
        assertFalse(OptionalCamera.enable(true) { throw IllegalStateException("Camera disconnected") })
    }
    @Test fun availableCameraCanPublish() = runBlocking {
        assertTrue(OptionalCamera.enable(true) { true })
    }
    @Test fun cancellingCallIsNotSwallowed() {
        try {
            runBlocking { OptionalCamera.enable(true) { throw CancellationException("Call ended") } }
            fail("Cancellation must propagate")
        } catch (_: CancellationException) { }
    }
}
