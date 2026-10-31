# Android TV / Google TV feasibility test and report

Status: **NOT VERIFIED ON HARDWARE**. No claim of notification visibility, remote focus, or boot reliability follows from a successful APK build.

## Device record

| Field | Value |
| --- | --- |
| Test date / tester | Pending |
| TV brand / model | Pending; run `scripts/inspect-tv.sh` |
| Android/API level | Pending |
| Firmware / build fingerprint | Pending |
| Google Play services version/status | Pending; status 0 in setup means available |
| TV APK SHA-256 | See `artifacts/SHA256SUMS` after build |
| Android phone model / version | Pending |
| Browser / OS | Pending |
| Presentation path | Standard notification first; overlay only if necessary |
| One-time permissions / ADB changes | Pending |
| Backend/tunnel availability | Pending |
| TV detection source / override | Pending; UI mode, Leanback, or hidden override |
| Camera API count | Pending |
| USB host / USB camera attached | Pending |
| Reliable mode | OFF for baseline; repeat ON only as a separate experiment |

## Procedure

1. Configure Firebase and start backend + HTTPS tunnel as in README. Confirm Anonymous sign-in is disabled and Firebase's Android app ID matches `dev.tvcall.caller`. Synchronize PC/phone/TV clocks with network time. Install the same `artifacts/homeping.apk` on TV and phone. Verify automatic TV receiver versus phone caller selection. Sign into phone/web with the same verified account. Open TV setup once, record the detected fields, scan its authorization QR, verify the warning and brand/model, and approve it.
2. Start with overlay OFF. Press Home, disconnect ADB/network debugging, and wait at least one minute. Use a caller over mobile data or a different network. Record whether a prompt actually appears over the launcher, whether Accept/Reject are reachable with the remote, and whether OK activates the highlighted action.
3. Accept, verify the native video screen opens only after acceptance, then End and verify Home returns. Repeat with Reject, Cancel, and no answer. Check the caller state each time. Acknowledgment alone is not a visual pass.
4. If standard notifications fail, document the exact failure. Enable overlay permission once (settings or documented ADB appops), then disconnect ADB and repeat. Record input focus, underlying launcher interaction, and activity launch. If this also fails, record the notification gate as failed and assess another Android TV device; do not label this milestone passed.
5. Run ten invitations **per caller**, including after **30 minutes idle**. Keep backend/tunnel running. Each prompt must appear within **10 seconds** under healthy connectivity. Record all attempts rather than discarding failures.
6. Repeat background tests after OS process termination (`adb shell am kill dev.tvcall.caller` while backgrounded), disconnect ADB, and call again. Repeat after a full TV reboot/network restoration without opening HomePing. Record timing separately from ordinary idle tests.
7. Test explicit force-stop (`adb shell am force-stop dev.tvcall.caller`) separately. Android normally leaves a force-stopped package unable to receive pushes until the user launches it again. Record that limitation and verify recovery by opening the app once; do not treat force-stop as ordinary process death.
8. Test TV Wi-Fi loss/restoration, phone network loss, and backend/tunnel interruption. Invite while TV offline, wait beyond 30 seconds, reconnect, and verify no accepted call screen appears. Cancel while TV temporarily offline; verify stale actions fail after reconnection. Turn network off during acceptance: the TV must show an error rather than claim acceptance.
9. Trigger simultaneous calls from web/Android: exactly one rings; the other reports Busy. Enable Do Not Disturb and confirm the caller immediately reports Declined with no TV prompt. Duplicate a push in a controlled test: one invitation, one expiry, no duplicate acceptance. Refresh the FCM token and confirm registration retries and new invitations.
10. Restart the backend while ringing. Reconnect before expiry to verify the persisted call; after expiry, verify acceptance fails. Test dropped cancellation push with server polling still available.

Collect logs in a **separate diagnostic run** with `adb logcat -s HomePing` (the TV stores 20 internal events; the normal UI has no log panel); routine latency/reliability runs must also work disconnected from ADB. Logs include shortened call IDs, FCM receipt, notification posting, overlay display, registration, and call actions without FCM tokens. Record visual appearance time by observation/video; notification posting is not proof of screen visibility.

## Account and removal checks

1. Enter an expired device code and a previously approved code; both must fail.
2. Try calling the TV from another verified account; the backend must return 403.
3. Remove the TV from paired-device settings. It must disappear immediately,
   stop accepting API operations, and return to authorization on its next setup
   refresh. Approve it again and confirm it receives a fresh Firebase session.
4. Confirm name and room edits persist while manufacturer/model, firmware,
   resolution, `usbCameraAttached`, and `cameraApiCount` stay read-only.
5. Keep Reliable mode OFF for the required baseline. Repeat idle/reboot tests
   with it ON only to record whether periodic registration helps this firmware;
   do not treat it as a substitute for the baseline.
6. Long-press HomePing (hold OK on the focused TV heading) and check Auto detect,
   Run as TV, and Run as phone. Restart the app to verify the override persists.
   In phone mode, the app must not present TV invitations or register as a TV.
7. After QR approval on a phone browser, return to the phone app and select
   Refresh TVs. Verify the saved TV's name appears; a second account must see
   No TV detected unless it has authorized its own TV.

## Attempt log

| Caller | Attempt | Condition / path | Call ID | Tap time | Visible prompt time | Latency | Remote action/result | Caller result | Pass/fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Web | 1–10 (one row each) | Pending | | | | | | | |
| Android | 1–10 (one row each) | Pending | | | | | | | |

Add separate rows for idle, OS kill, reboot, force-stop/recovery, duplicate, network loss, cancellation, and backend restart.

## Software verification

See `docs/VERIFICATION.md` for checks executed in this workspace. Emulator tests verify server behavior only. FCM, Firebase project permissions, USB installation, notification rendering, remote focus, and manufacturer firmware behavior require the device test above. Repeat the report for each TV brand/model tested; one successful model does not establish compatibility with all Android TVs.

## Decision

Pending. Pass requires both callers, visible and remote-operable Accept/Reject on the real home screen, accepted call screen launch, return Home, required repetition/latency tests, and documented lifecycle results. If boot delivery needs reopening the app, the requested unattended workflow has failed that condition. Sleep/wake from powered-off or standby is outside this first milestone; TV is assumed on at its home screen.


## LiveKit media gate (separate from the invitation gate)

Software browser media test passed with real LiveKit transport and synthetic
capture. Native camera/audio, USB compatibility and TV presentation remain
**NOT VERIFIED ON HARDWARE**. Configure [LiveKit](LIVEKIT.md) before this test.

1. Install the new single APK on both devices and deploy the new API and web
   assets. Accept a call on TV; confirm the phone/web joins automatically without another tap. Verify
   camera and microphone runtime prompts with the remote, including clear focus.
2. Test grant, deny, and permanently deny for each permission. Missing inputs
   must produce a visible message; remote playback and remaining inputs should
   still work. No camera/mic capture is allowed on an idle/ringing TV.
3. Record cameraApiCount before/after attaching a USB camera, the selected camera,
   and both remote video reception and actual microphone input. A USB attachment
   flag alone does not pass. This build needs a camera exposed through Android's
   camera APIs; no separate UVC driver is included. Do not purchase hardware
   without confirming this on the target firmware.
4. Check local preview, remote video, microphone mute/unmute, camera off/on,
   camera switching when multiple cameras exist, USB mic routing and TV speaker
   volume. Check echo/audio feedback at normal TV volume.
5. Test End from each peer, remote Back, phone Home, TV Home, process kill,
   Wi-Fi loss/restoration, and backend restart during media. Camera/mic indicators
   must stop after leaving the Android call screen. An absent peer must release
   the accepted session after its 90-second lease expires on the next status
   request. End/removal must reject new room credentials and close the room.
6. Test a phone on mobile data while TV uses home internet, then restrictive
   networks. Record LiveKit connection/relay behavior; same-network success is
   insufficient. Test long calls beyond one hour to exercise Firebase token
   refresh on the native phone screen.
7. Confirm a second account/another TV cannot get room credentials, a cancelled
   or expired invite cannot join, and TV removal disconnects an active call.

| Media observation | Result |
| --- | --- |
| Model / firmware and permissions | Pending |
| Camera API device / USB camera / microphone | Pending |
| Phone ↔ TV video and audio | Pending |
| Web ↔ TV video and audio | Pending |
| Different networks / relay | Pending |
| Controls, remote focus and background cleanup | Pending |
| Long call / network loss / removal | Pending |

## Audio investigation — 2026-10-31

User reported TV camera video working but neither direction of audio audible.
Read-only ADB checks on the connected Android 11 TV found:

- HomePing RECORD_AUDIO permission and app-op granted; system mic mute false.
- During a live call, LiveKit listed both participants with published, unmuted
  microphone and camera tracks. Publication alone does not prove audible audio.
- Android recorded HomePing from `VOICE_COMMUNICATION` using a built-in microphone
  device, not a USB microphone.
- TV playback was routed to Bluetooth A2DP named `pop-os`, rather than TV speakers.
- The attached USB camera exposed video-class interfaces but no USB audio-class
  interface. Android's available audio inputs did not include a USB mic.
  This does not establish whether the physical camera lacks a mic or its audio
  interface is unavailable on this firmware. Check the same camera on a PC.

Added TV audio compatibility mode (default ON): normal media output, MIC capture,
software processing instead of TV hardware call processing, and no audio prewarm.
Phone calls retain LiveKit communication routing. OFF restores the previous TV
communication profile for firmware/headset comparisons. Select the mode in TV
settings before the next call. Volume buttons now target the matching stream.

The native call screen has an Audio info dialog with input availability, Android's
reported recording route, mic permission and a USB mic flag. Mic and incoming
PCM peak indicators distinguish no samples, silence and a nonzero signal; they
are not calibrated loudness or proof of speaker playback. Only in-memory numbers
are calculated. No audio samples are retained, uploaded as diagnostics or logged.

The rebuilt unified APK and 12 native tests pass, including four signal-meter
checks (silence vs no samples, full-scale signed PCM, ByteBuffer bounds/position,
and unsupported formats). Audible output and a real usable TV microphone remain
pending. Do not mark the USB microphone gate passed or recommend buying a camera
based on working video alone.

Retest with TV Settings → Sound → Audio output → TV speakers. Install the updated
APK on both sides, allow the mic and make a call. Note both Mic and Incoming
levels, open Audio info and record the selected input. If incoming levels move
but nothing is audible, check playback routing/mute/volume. If TV Mic stays silent
or has no samples and no USB mic appears, check actual microphone hardware/API
support independently. Repeat using a browser caller to isolate Android-phone
capture from TV capture/playback.

## Incoming-prompt investigation — 2026-10-31

User reported that calls were found only through Recover active call and no
incoming prompt appeared either in HomePing or over Home. On the connected TV:

- FCM invite receipt and notification posting were logged; the incoming channel
  had importance 4 (HIGH). This notification-only path did not satisfy the user's
  visible-prompt requirement.
- The app's overlay switch was ON, but `SYSTEM_ALERT_WINDOW` was still in default
  mode with no grant. The old service silently skipped drawing the overlay.
- The permitted one-time setup was applied through ADB:
  `adb shell appops set dev.tvcall.caller SYSTEM_ALERT_WINDOW allow`.
- A subsequent real invitation logged Overlay shown approximately 1,999 ms after
  FCM receipt. This measures receipt-to-addView, not tap-to-visible latency or
  remote usability, and does not replace observation by the tester.

The updated app displays the difference between overlay ON and permission
actually granted, provides a separate permission-settings button, and retains
an explicit ADB setup message when this firmware cannot expose the settings.
A resumed TV setup screen now opens the validated incoming prompt automatically,
including when returning to an existing ringing invitation. Background Home
presentation stays with notifications or the explicitly enabled, permitted
overlay; the code does not try to bypass background activity restrictions.
Cancelled, accepted and expired calls never select a new prompt path. A displayed
incoming/call screen is not covered with another overlay. Dismissing the same
foreground invitation does not cause an automatic relaunch loop.

Five native policy tests cover foreground display without overlay permission,
both requirements for background overlays, terminal/expired states, already-visible
screens and other screens without permission. Rebuilt native tests total 17.
Normal service shutdown no longer logs an expected interrupted HTTP read as a
call-state failure.

Still required: visually confirm the overlay over Home without opening the app
or selecting Recover; test D-pad focus, OK-to-accept, Reject, Cancel, timeout,
idle/process death/reboot, and ten invitations per caller. Disconnect ADB for the
normal-use verification after the one-time grant. Record the permission as
required on this firmware. No complete hardware pass is claimed by these logs.

### User confirmation and ringtone follow-up

After the overlay grant, the user confirmed that the incoming popup appears over
Home. This is a user-observed visual success for that condition, not completion
of the idle/reboot/latency/repetition matrix. The full incoming-call gate remains
pending those tests.

The user then reported no ringtone. Added an original, bundled eight-second
melodic marimba/chime ringtone, repeated only for a server-validated, unexpired ringing invitation.
It uses TV media volume/output and transient audio focus; no system volume,
Bluetooth selection or global sound preference is changed. The local Incoming
ringtone switch defaults ON. Test ringtone plays a eight-second preview and stops
when leaving TV setup. DND-declined calls have no invitation and no sound.

Verify audible ringing over Home and another app, plus prompt focus. Test Accept,
Reject, caller Cancel, no answer/30-second timeout, duplicate delivery and service
termination: all must stop sound promptly without a later restart. Check OFF,
media volume zero/mute, external sound output and return of other app audio after
ringing stops. Ringing in the notification-only fallback when the foreground
service is blocked is not guaranteed; record that firmware limitation separately.

Five new sound-controller tests cover duplicate validation, terminal states,
expired/already cancelled invitations, the disabled setting and closure before
late validation. The single APK builds with 22 passing native tests. The bundled
PCM waveform and its packaged resource were checked; audible TV playback still
requires listening on the device.


### TV UI and loading update — 2026-10-31

The source now uses a HomePing launcher icon and wordmark banner, simplified TV
home/settings, and a centered Accept/Reject card shared by the overlay and incoming
activity. Logs, recovery buttons, and audio diagnostics are removed from normal TV
screens. Advanced preferences are accessible by long-pressing HomePing, then choosing
Advanced TV preferences. Phone layout is retained with small loading cards.

Verify on hardware: launcher artwork after an APK update (the launcher may cache
artwork), all settings with D-pad/Back, visible Accept/Reject focus and OK actions,
loading cards disappearing on success/failure, and TV call connection spinner.
On the updated phone APK, accept on TV and confirm camera/mic open automatically;
repeated status updates and returning from End must not reopen the call. Accepting
while the phone is backgrounded must wait until it returns to the foreground.
Repeat cancellation/expiry and disconnected-ADB tests. Browser media integration
covers automatic connection but does not verify Android or TV hardware.

Local verification for this update: release APK build and 22 Android unit tests
passed; TypeScript checks and backend/client tests passed (28 passed, two emulator
checks skipped because backend/rules were unchanged). Browser smoke testing confirms
the loading card clears on both successful and failed call requests. The live
LiveKit browser test received video frames and audio in both directions after
automatic connection, and checked mute/camera controls and End propagation.
Firebase Hosting was updated. The APK was installed over the existing TV app,
preserving authorization and permissions. TV UI inspection observed the registration
loading card and the new settings form with field focus. Screenshots on this firmware
are unreliable; full visual/D-pad acceptance, updated phone auto-join, and the incoming
card's revised appearance still require a user call test. No new TV microphone
compatibility result is claimed.

Final installed-build check: TV registration loader cleared to HomePing home;
no Debug/Recover controls appeared in the main hierarchy. Remote OK opened TV
settings; Save changes and About this TV were visible without scrolling at this
TV's current display scale. Back and Home returned to the launcher. Shared icon
PNG checksums match across TV, phone, and website assets; the deployed website
serves the matching SVG. This does not replace the incoming-call hardware tests.


### Larger caller video — 2026-10-31

Accepted browser calls now render in a viewport-sized portal, outside the narrow
account card. The native Android caller places remote video across the call surface,
with a corner self-preview and controls overlaid at the bottom; audio diagnostics
are available by long-pressing the status text. The TV call layout is preserved.

Verification: TypeScript and web build passed; live LiveKit integration verified
full-window bounds at 1280×900, 390×844, and 844×390, remote-video stage occupying
most of each viewport, controls staying visible, real media, and mute/camera/End.
APK release build and Android unit tests passed. Install the updated phone APK and
verify the remote video size, local preview, permission dialogs, and all call controls
on a real phone; native call appearance has not been verified by a phone hardware call.


Phone layout rollback: the user reported a white screen after acceptance and asked
to revert the recent phone layout changes before phone logs could be collected.
Restored the previous native phone layout (video above the separate controls row
and audio information). Automatic joining, branding, loaders, and the larger web
view are preserved. The cause of the phone white screen is not yet verified.

### TV without a webcam / built-in microphone — 2026-10-31

On the second TV (ADB endpoint 192.168.1.4), AndroidRuntime recorded a fatal
`kotlin.NotImplementedError` in LiveKit 2.29.2 camera-track creation when no webcam
was attached. The process exited, leaving the caller without remote media.
The app now checks Camera2/legacy camera availability before capture and isolates
the SDK's no-camera error. Camera absence does not disconnect receiving media.
The camera toggle uses the same protection. Phone/web show a remote-camera
placeholder instead of an unexplained empty video area. Missing cameras do not
trigger a camera permission request. Fatal camera errors are covered by five
native regression tests, including cancellation propagation; 27 native tests pass.
Live browser media and responsive-layout tests still pass; these do not test the
native TV's camera absence or microphone hardware.

The second TV's audio policy exposes an available Built-In Mic input. Audio mute
state reports false, and the primary user's RECORD_AUDIO permission is granted.
HomePing's existing TV compatibility mode uses MediaRecorder.AudioSource.MIC
with media output, allowing Android's built-in microphone route. No firmware- or
IP-specific route is hard-coded. Verify with a real accepted call that the TV stays
open without a webcam, phone video/audio reaches TV, and speech near the TV reaches
the phone. An advertised built-in mic is not proof of audible capture; physical
mic switches, firmware restrictions, and actual recording must still be checked.

Post-install live observation on the second TV: accepted call stayed in CallActivity;
HomePing logged `Media connected; camera=false microphone=true`, TV media/MIC audio
profile, no USB microphone, and remote audio subscription. Android's recording
configuration identifies HomePing with source MIC and `silenced:false` (device
16 kHz stereo converted to the WebRTC 48 kHz mono client stream). This verifies
camera-free connection and active microphone capture; the user must still confirm
that TV speech is audible at the phone. The original TV was not changed or
reinstalled during this second-TV test.


### 60-second ringing, custom sound, auto-accept and video update — 2026-10-31

The supplied Downloads MP3 is bundled as `res/raw/homeping_ring.mp3`. Ringing lasts
60 seconds with matching FCM TTL. A temporary media-volume boost to at least 70%
is restored afterward unless the user changes volume themselves. Preview and all
ring-stop paths use the same restoration. Default room is Bedroom for missing/null
rooms; custom room names remain. Auto-accept defaults OFF, has an explicit TV-side
camera/mic consent dialog, and must be saved through the authenticated backend.

Auto-accept is TV initiated after 60 seconds, using a 10-second server completion
window only for an already-received invitation. Rejected, cancelled, DND, disabled,
unreceived and stale invitations are rejected. One active invitation remains enforced.
Test ON/OFF separately on each TV, with manual accept/reject/cancel before 60 seconds,
loss of connectivity at the deadline, repeated delivery, and restored audio volume.

Camera capture targets 720p/24 fps initially (1.5 Mbps main encoding cap, simulcast
and bandwidth adaptation enabled). At 15 minutes since acceptance the capture target
reduces to 854×480/20 fps. Camera hardware may choose a supported nearby format.
LiveKit may adapt below either target and recover up to that limit. Verify the long
call on native hardware and actual data usage; the UI label is a configured limit,
not a measurement of delivered pixels or connection speed.

The user's black remote-video screenshot was an iPhone browser call. Browser video
is now appended to the visible DOM before LiveKit attachment, with playsinline and
muted set before autoplay; audio remains separate. A blocked-video button and visible-
page playback retry avoid requiring app navigation. A Landscape view toggle uses a
portrait-safe CSS rotation and normal landscape viewport behavior. Actual iPhone/Safari
verification is still required. The speculative native texture-renderer change was
removed after the screenshot identified the browser path; Android layout is retained.


Release verification: 34 backend/client/Firestore rules tests pass against the
cached Firestore emulator; 32 native unit tests and the release APK build pass.
The APK's bundled MP3 bytes match the supplied Downloads file. Live LiveKit browser
integration verifies remote video/audio, inline muted playback attached in the DOM,
portrait/landscape view switching, and an accelerated 15-minute switch to a real
<=480px local video stream while media remains connected. iPhone Safari playback,
15-minute native capture, custom ringtone loudness/restoration, and automatic
background call acceptance still need hardware testing. At preparation time both
TVs were absent from ADB; connection to 192.168.1.4:5555 was refused and .8 did not
connect. The Render backend needs deployment of the source update before the
60-second timer and auto-accept can work; Firebase Hosting alone cannot change it.


### Independent TV viewing rotation — 2026-10-31

The web Landscape view button now rotates only `.remote-media` within the measured
video stage. The call layout, self-preview and controls remain upright. Camera capture
is not restarted or reconfigured when toggling the view. The live browser integration
checks outgoing track identity, capture dimensions, preview geometry, control geometry,
and the receiving peer's video orientation/track identity before and after toggling.
Resolution may change independently because adaptive streaming remains enabled.
Typecheck, web build, browser smoke and live media tests pass. Physical phone rotation
and actual iPhone behavior require hardware testing; this change does not lock physical
camera orientation. No TV APK or backend change is required for this display-only fix.
