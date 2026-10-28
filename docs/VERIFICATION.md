# Implementation verification

Date: 2026-10-23. The user will perform the Hisense hardware test later.

## Completed software checks

- TypeScript type-checks for backend, browser, Android caller, and shared API client.
- Backend production compilation and Vite browser production build.
- Nine passing automated tests with a real local Firestore emulator (v1.19.8), including authorization/validation, pairing expiry, concurrent invitation exclusion, receipt/submission separation, duplicate actions, cancellation/rejection, stale acceptance, token replacement, and persisted state read through a fresh service instance.
- Browser smoke test in installed headless Chrome: pairing, invitation creation, submission status, cancellation, and a 390-pixel viewport without horizontal overflow. This test deliberately mocks the HTTP/Firebase responses and does **not** verify live FCM or Firebase project configuration. Screenshots are in `artifacts/`.
- Native TV debug build using JDK 17, Gradle 8.11.1, and Android SDK 35.
- Android TV lint: no errors. Remaining warnings concern English-only prototype strings, optional Kotlin extensions, a synchronous preference write on a background thread, selected dependency/target versions, and the TV banner vector size.
- Shell syntax checks for setup/build/inspection scripts.

Artifact signatures, Android caller build results, and checksums are finalized in `artifacts/BUILD_REPORT.txt` after packaging.

## Reproduce

```sh
npm ci
npm run typecheck
npm test
npm run build
CHROME_BIN=/usr/bin/google-chrome npm run test:web
npm run build:apks
```

Without `FIRESTORE_EMULATOR_HOST`, `npm test` runs eight tests and explicitly skips the Firestore integration test. To run all nine, start a Firestore emulator on localhost:8080 (the Firebase CLI is an optional external tool):

```sh
firebase emulators:start --only firestore --project demo-homeping
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm test
```

Use the Java version required by your installed Firebase CLI/emulator. The emulator adapter test uses the isolated `demo-homeping` project; it never targets production Firestore. Firebase Authentication is mocked for server HTTP tests; caller tests mock Firebase REST responses. Live Firebase Authentication, IAM permissions, and FCM still need project configuration.

## Not verified

- TV/phone APK installation or launch on physical devices.
- Actual Hisense model, firmware, Google Play services, notification visibility, overlay permission, D-pad focus, activity launch, idle/process-death/reboot behavior, or ten-second prompt latency.
- Real Firebase project credentials, Authentication, FCM transport, and public HTTPS tunnel operation.
- USB camera/microphone support or WebRTC; these are intentionally deferred.

No ADB devices were attached during implementation. No Firebase project credentials were supplied. The incoming-call milestone remains **UNVERIFIED**, with the test procedure in `HARDWARE_TEST.md` ready for the user's device run.

## HomePing rename — 2026-10-26

Display names, web title, workspace packages/imports, build output filenames, log tags, and documentation now use HomePing. Android application IDs, existing TV preferences, and internal PendingIntent URI schemes retain their compatible identifiers. No APK or web rebuild was requested for this rename; existing artifacts and screenshots retain the previous branding.
