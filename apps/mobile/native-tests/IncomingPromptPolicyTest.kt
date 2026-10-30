package dev.tvcall.tv

import org.junit.Assert.assertEquals
import org.junit.Test
import dev.tvcall.tv.IncomingPromptPolicy.Path
import dev.tvcall.tv.IncomingPromptPolicy.Screen

class IncomingPromptPolicyTest {
    @Test fun foregroundSetupShowsPromptWithoutOverlayPermission() {
        assertEquals(Path.FOREGROUND, IncomingPromptPolicy.choose("ringing", 2000, 1000, Screen.SETUP, false, false))
    }
    @Test fun homeNeedsBothExplicitOverlayEnablementAndPermission() {
        assertEquals(Path.OVERLAY, IncomingPromptPolicy.choose("ringing", 2000, 1000, Screen.BACKGROUND, true, true))
        assertEquals(Path.NOTIFICATION, IncomingPromptPolicy.choose("ringing", 2000, 1000, Screen.BACKGROUND, true, false))
        assertEquals(Path.NOTIFICATION, IncomingPromptPolicy.choose("ringing", 2000, 1000, Screen.BACKGROUND, false, true))
    }
    @Test fun cancelledExpiredAndAcceptedCallsNeverOpenPrompt() {
        for (status in listOf("accepted", "cancelled", "ended", "declined", "missed"))
            for (screen in Screen.entries)
                assertEquals(Path.NONE, IncomingPromptPolicy.choose(status, 2000, 1000, screen, true, true))
        assertEquals(Path.NONE, IncomingPromptPolicy.choose("ringing", 1000, 1000, Screen.SETUP, true, true))
        assertEquals(Path.NONE, IncomingPromptPolicy.choose("ringing", 999, 1000, Screen.BACKGROUND, true, true))
    }
    @Test fun alreadyVisiblePromptOrCallDoesNotGetAnotherOverlay() {
        for (screen in listOf(Screen.INCOMING, Screen.CALL))
            assertEquals(Path.ALREADY_VISIBLE, IncomingPromptPolicy.choose("ringing", 2000, 1000, screen, true, true))
    }
    @Test fun otherScreensDontBecomePermissionBypasses() {
        assertEquals(Path.NOTIFICATION, IncomingPromptPolicy.choose("ringing", 2000, 1000, Screen.OTHER, true, false))
    }
}
