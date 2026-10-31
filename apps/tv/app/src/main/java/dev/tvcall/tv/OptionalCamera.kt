package dev.tvcall.tv

import kotlinx.coroutines.CancellationException

/** Capture is optional: LiveKit 2.29 can throw NotImplementedError without a camera. */
internal object OptionalCamera {
    suspend fun enable(available: Boolean, capture: suspend () -> Boolean): Boolean {
        if (!available) return false
        return try { capture() }
        catch (error: CancellationException) { throw error }
        catch (_: NotImplementedError) { false }
        catch (_: Exception) { false }
    }
}
