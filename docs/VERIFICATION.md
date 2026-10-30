# Implementation verification

Date: 2026-10-30. Physical Android TV / Google TV verification is still pending.

## Completed software checks

- Root TypeScript typecheck passes for backend, React web, React Native phone,
  and shared client; backend production compilation and Vite production build
  pass. The LiveKit web client is loaded separately from the login screen.
- All **29 backend/client tests pass with Firestore emulator v1.19.8**, including
  ownership, registration, restricted editing, device authorization expiry and
  single use, account sync, DND, removal/revocation, Busy/Missed, push token
  recovery, HTTP authentication, and no-TV presentation.
- Media tests cover accepted-state/ownership checks, exact TV identity, removed
  devices, either-side End and duplicate End, rejected later joins, both-peer
  heartbeat expiry, persistence across backend restarts, room-token signature,
  60-second lifetime, camera/microphone-only grants, no moderation/PII, missing
  settings, invalid URLs, video server failure and End racing room creation.
- Firestore rules test passes: verified owners read their own devices, another
  account cannot, TV principals cannot read the owner's device list, and direct
  writes are denied.
- Browser smoke test passes for verified sign-in, TV list, call/cancel, and
  390-pixel responsive layout using mocked Firebase/API transport.
- **Real LiveKit integration passes** using the configured project and two
  headless Chrome clients with synthetic camera/microphone inputs. Both clients
  receive decoded remote video frames and advancing audio, mute/unmute and
  camera off/on controls work, and End propagates to the peer. This uses the
  actual backend/token code and web call component. Test rooms and temporary
  files are cleaned. Firebase login, FCM, native Android capture, USB cameras,
  TV firmware, and cross-network hardware calling are not covered by this test.
- Unified Android release APK builds for ARM64/ARMv7 with bundled JavaScript,
  Kotlin TV receiver, shared native LiveKit call screen and React Native caller.
  Eight native device-mode tests pass. Distribution remains a single ignored
  `artifacts/homeping.apk`, package `dev.tvcall.caller`, minimum Android 8.0.
- Actual APK manifest inspected: CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS,
  optional camera/microphone features, phone/Leanback launcher and native call
  activity. Runtime permissions are requested on the native call screen.
- Expo prebuild preserves launcher routing, optional TV/touchscreen features,
  native package/runtime registration and overlay permission.
- Configured LiveKit API secret is absent from tracked files. Server settings
  are in ignored local `.env`; `.env.example` contains blanks. APKs remain
  ignored and must not be committed.

## Reproduce

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:web
npm run test:media
bash scripts/build-apks.sh
```

`test:media` is opt-in and needs local LiveKit settings and Chrome. It uses a real
LiveKit project briefly. Normal `npm test` skips two Firestore tests unless the
emulator is running. The successful full emulator run used JDK 17:

```sh
source scripts/android-env.sh
npx --yes firebase-tools@13.35.1 emulators:exec \
  --only firestore --project demo-homeping "npm test"
```

## Deployment requirements

The API remains `https://tv-call.onrender.com`; the web origin is
`https://home-ping-7f1ef.web.app`. The updated Firebase Hosting web assets were published successfully during this
change. Installing a locally rebuilt APK or publishing Firebase Hosting does not
update Render's backend. Sync the new source commit
to the connected GitHub branch and deploy it, adding the three LiveKit server
variables described in [LIVEKIT.md](LIVEKIT.md). `/api/config` must report
`mediaEnabled: true` after deployment. The Render credential file must still
be `/etc/secrets/homeping-service-account.json` and contain the private Admin
service-account JSON, not Android's google-services.json.

Firebase Android registration must match `dev.tvcall.caller`: application ID
`1:582530719860:android:09f48fe47dd5276c3c3121`. Confirm this in deployed public
configuration; the old `dev.tvcall.tv` ID belongs to the standalone prototype.
Render Free cold starts still prevent any guarantee of ten-second invitations
following backend idle. LiveKit media transport is separate from Render.

## Real-device checks still required

- Actual Firebase sign-in and OAuth setup on Android, verification/reset emails,
  TV QR approval, Keystore/Firebase session persistence and reauthorization.
- Automatic mode detection across Android/Google TV brands, D-pad focus and
  hidden overrides; actual metadata and USB camera/API exposure.
- FCM, notification/full-screen/overlay over Home, remote Accept/Reject, DND,
  Reliable mode, idle/process-death/reboot and force-stop recovery.
- Camera/mic permission grant/denial, actual capture on phone and TV, USB input
  routing, both media directions, playback/echo, controls, Home/Back cleanup,
  long-call token refresh, network interruption, remote End/removal and calls
  between different networks.
- Ten invitations per caller with latency/failure log and model/firmware record.

No physical TV was attached. Neither successful builds nor the real browser
media test establish TV/webcam support. Complete [HARDWARE_TEST.md](HARDWARE_TEST.md)
before declaring the incoming-call and USB-media gates passed.

## Native audio follow-up — 2026-10-31

The connected Android 11 TV had microphone permission, but playback was routed to
Bluetooth A2DP `pop-os` and capture used the built-in-mic path. Its USB camera
advertised no audio-class interface. Both room participants had unmuted published
audio tracks during the observed test. These observations do not verify audible
sound, a functioning physical TV mic, or webcam microphone compatibility.

TV media/MIC compatibility mode, stream-volume handling, an audio info dialog,
explicit remote-track playback enablement and in-memory PCM meters were added.
The single APK rebuild passes and all 12 native tests pass. Four new tests cover
PCM meter behavior without recording audio. The phone routing profile is kept.
The physical audio gate still needs the retest described in HARDWARE_TEST.md.

The rebuilt APK was then installed successfully on the connected TV with
`adb install -r`; its saved account registration remained valid. In a subsequent
call the new UI reported a nonzero microphone PCM peak (65%), Android reported
MIC rather than VOICE_COMMUNICATION capture, and the app logged a remote audio
subscription. These are signal/routing checks, not a listening test. The system
output was later reported as wired headphones rather than TV speakers. Actual
speaker audibility and phone receipt of the TV signal still require confirmation
from the person at the devices. No microphone audio was recorded for diagnostics.

## Incoming prompt follow-up — 2026-10-31

The connected TV received invitations and posted a high-importance notification,
but overlay permission was not granted despite the local overlay switch being ON.
One-time authorized ADB setup granted SYSTEM_ALERT_WINDOW. A later live invitation
logged the overlay being added about two seconds after FCM receipt. This confirms
the overlay code path ran; remote interaction and the full background gate still
need visual/user verification.

Added explicit permission readiness/settings UI, automatic validated incoming
presentation for a resumed TV setup screen, and recovery of already ringing calls
on resume. Background paths retain their actual overlay permission requirement.
Duplicate foreground launches are suppressed; expired/nonringing calls cannot
select a prompt. The new policy tests bring the native total to 17. No Node API,
web deployment or phone-only update is required for this TV presentation fix.

## Ringtone follow-up — 2026-10-31

The user confirmed that the popup now appears over Home after granting overlay
permission, and reported that it was silent. Added a bundled original PCM ringtone
(no network download/system ringtone dependency), media-volume playback with
transient focus, lifecycle cleanup, ON/OFF setting and a eight-second preview.
Accept/Reject/cancellation/expiry/service teardown release the player. Audio
preparation callbacks check that their player is still current before starting.

The rebuilt single APK and all 22 native tests pass. Five new tests cover
validated ringing only, duplicate suppression, terminal-state stopping, expiry,
disablement and late callbacks after closure. The raw resource maps to the
bundled WAV in the optimized APK; its contents match the generated source file.
No microphone/storage permission or backend/web change is needed for ringtone
playback. Audible sound and the full lifecycle matrix still need hardware checks.

The final melodic eight-second marimba/chime asset replaced the initial two-tone
prototype at the user's request. Its source WAV matches the optimized APK's raw
resource. The final APK was installed successfully on the connected TV and TV
setup reopened. Existing overlay permission remained granted after the previous
update. Playback start/stop was observed in the preceding ringtone build's device
logs; the new melody's audible quality is for the user to assess using Test
ringtone or an incoming call. No claim that this is an Apple recording is made.
