# Implementation verification

Date: 2026-10-30. Physical Android TV / Google TV verification is still pending.

## Completed software checks

- Root TypeScript typecheck for the backend, web caller, Expo caller, and shared
  client.
- Backend production compilation and Vite production build.
- Thirteen backend/client tests passed with Firestore emulator v1.19.8,
  including ownership 403, registration, restricted editing, device-code
  expiry and single use, one-account ownership, DND, removal/revocation,
  Busy/Missed transitions, invalid FCM token recovery, no-TV presentation, and
  persisted Firestore call state.
- Firestore rules test passed: a verified human can read their own device, a
  different user cannot, a TV principal cannot read the owner's device list,
  and direct owner writes are denied.
- Browser smoke test passed for verified email sign-in, owned-TV listing,
  calling, cancellation, and a 390-pixel layout using mocked Firebase/API
  transport.
- Unified HomePing release APK compiled successfully for ARM64 and ARMv7.
  `artifacts/homeping.apk` contains the Kotlin TV receiver and React Native
  phone caller, with bundled JavaScript.
- Eight native device-mode tests passed: ordinary phone, either TV detection
  signal, both signals, manual TV/phone overrides, legacy override, and reset
  to automatic detection.
- Repeated Expo prebuild runs preserve exactly one phone/Leanback launcher,
  optional touchscreen/TV features, native package registration, and TV runtime
  initialization. The overlay permission survives regeneration.
- Inspected the built APK with Android SDK apkanalyzer: package
  `dev.tvcall.caller`, Android 8.0 minimum, both launch categories, both UIs
  and TV services in DEX, ARM64/ARMv7 libraries, bundled JS, and no requested
  camera or microphone permissions.
- No APK is tracked by Git. Native build directories and `artifacts/` outputs
  remain ignored.

## Reproduce

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:web
bash scripts/build-apks.sh
```

Normal `npm test` skips the Firestore adapter and rules tests unless
`FIRESTORE_EMULATOR_HOST` is set. The currently installed Firebase CLI 15
requires Java 21, so the successful emulator run used the Java-17-compatible
CLI explicitly:

```sh
source scripts/android-env.sh
npx --yes firebase-tools@13.35.1 emulators:exec \
  --only firestore --project demo-homeping "npm test"
```

## Real-device checks still required

- Live Google and email authentication using the configured Firebase project,
  including verification email, forgot-password, OAuth redirect, and Android
  SHA fingerprints.
- QR readability, ten-minute approval, custom-token persistence across reboot,
  and reauthorization after removing a TV.
- Actual model/firmware values across TV brands, automatic TV-versus-phone
  routing from one APK, D-pad focus, hidden device-mode overrides, USB camera
  detection, and Camera2 count.
- Live FCM, notification/full-screen/overlay presentation over the Google TV
  launcher, remote Accept/Reject, DND, Reliable mode, idle/process-death/reboot
  behavior, and return to Home.
- Ten invitations per caller with the required latency and failure log.

No physical TV was attached during this implementation. The incoming-call
milestone remains **UNVERIFIED ON HARDWARE** until
[HARDWARE_TEST.md](HARDWARE_TEST.md) is completed.

## Render and Firebase deployment — 2026-10-30

- Render API: `https://tv-call.onrender.com`. Public `/health` and
  `/api/config` return 200; configuration reports project
  `home-ping-7f1ef`. CORS allows the Firebase web origin.
- Firebase website and Firestore rules deployed successfully to
  `https://home-ping-7f1ef.web.app`. A real headless browser loads the sign-in
  screen without page errors and uses the Render API.
- Rebuilt `artifacts/homeping.apk` with the verified Render address in native
  metadata, read by both the TV receiver and phone caller. Neither app asks the
  user to enter a server URL. Inspected the actual APK manifest to verify this.
- Typecheck, backend/web builds, browser smoke test, and eight native mode tests
  pass. Normal Node tests now have 13 passes and two emulator-only skips; the
  additional tests cover public endpoint embedding and URL validation.
- Registered unified Firebase Android app `dev.tvcall.caller`, Firebase app ID
  `1:582530719860:android:09f48fe47dd5276c3c3121`. Render still reports the old
  TV-only Firebase app ID; its environment setting must be changed and redeployed.
- Login completion, authenticated Firestore operations, TV approval, and live
  FCM delivery have not been verified by these public endpoint/browser checks.
