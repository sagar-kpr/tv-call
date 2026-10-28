# HomePing — incoming invitation proof of concept

A personal calling prototype for a Hisense Google TV and **web + Android** callers. It tests whether the TV can receive and present an actionable invitation while sitting on its normal home screen. **It does not stream audio or video. Hardware feasibility is not yet verified.**

The TV uses native Kotlin; the browser uses React/Vite; the Android caller uses React Native/Expo. A Node.js/TypeScript server verifies Firebase Authentication, stores registrations and state in Firestore, and sends high-priority, data-only FCM messages. There is no background WebSocket requirement.

## Quick start

Requires Node.js 22.13+ (Node 24 LTS recommended), a Firebase project, and an Internet-connected TV with Google Play services. Use a single backend instance for this prototype; pairing rate limits are process-local.

```sh
npm ci
cp .env.example .env
# Configure .env as described below.
npm run build
npm run dev
```

Open http://localhost:3000 for the built browser caller. For UI development, `npm run dev:web` runs Vite at http://localhost:5173 with `/api` proxied to the server. Run the backend alongside it.

Expose the backend through an HTTPS tunnel, for example with an installed [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) binary:

```sh
cloudflared tunnel --url http://127.0.0.1:3000
```

Open the returned HTTPS URL in the caller browser. Enter that same URL in the TV and Android app. The backend serves the built web app and API from one origin. Keep the PC awake; a temporary tunnel URL can change on restart, requiring the TV and caller to reconnect. No permanent hosting is configured.

## Firebase setup

1. Create a project in the [Firebase Console](https://console.firebase.google.com/). Enable **Authentication → Sign-in method → Anonymous**.
2. Create a Firestore database. Deploy `firestore.rules` with `firebase deploy --only firestore:rules --project YOUR_PROJECT_ID`, or paste those rules into the console. Clients never access Firestore directly; its rules deny client access. Admin SDK authorization is enforced by the backend.
3. Register an Android app with package **dev.tvcall.tv**. Copy its `mobilesdk_app_id`, API key, project ID, and project number/sender ID into `.env`. You do not need to place `google-services.json` in this repository: the TV initializes Firebase at runtime using `/api/config`.
4. Create/download a service-account JSON with access to Firebase Authentication, Firestore, and FCM. Keep it **outside** the repo. Set `GOOGLE_APPLICATION_CREDENTIALS` to its absolute path. Ensure the Firebase Cloud Messaging API is enabled. Use Application Default Credentials instead if your environment already supplies them.
5. Restart the server after changing `.env`. `/health` checks the process; it does not verify Firebase credentials. A successful TV registration and invitation test verify the Firebase path.

The API key and Android application ID are public Firebase configuration, not Admin credentials. Both caller interfaces use Firebase's anonymous sign-up/refresh REST APIs and persist their session on that device. Clearing app/browser data removes pairing access, requiring pairing again. Changing Firebase projects on the TV requires clearing HomePing app data first.

## Build and install Android apps

HomePing branding has been updated in source. Existing `tv-call-*.apk` files and screenshots in `artifacts/` are from the previous build and still show the old name. The next build creates the `homeping-*.apk` files listed below. Android application IDs (`dev.tvcall.tv` and `dev.tvcall.caller`) stay compatible with existing installations and Firebase registration.

Install JDK 17 and the Android SDK command-line tools. Set `JAVA_HOME` and `ANDROID_HOME`; accept SDK licenses with `sdkmanager --licenses`. Install:

```sh
sdkmanager 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0' 'platforms;android-36' 'build-tools;36.0.0' 'ndk;27.1.12297006' 'cmake;3.22.1'
npm ci
./scripts/build-apks.sh
```

The build script uses the shared SDK and JDK at `$HOME/Android/Sdk` and `$HOME/.jdks/zulu-17` when they are available. It retains project-local `.tools` fallback detection for older setups. The first native build downloads Gradle/Maven dependencies. React Native/Expo generates its Android project from the tracked source and app configuration.

Outputs in `artifacts/`:

- `homeping-tv-debug.apk`: TV prototype, installable without Firebase build-time configuration.
- `homeping-caller-standalone.apk`: standalone Android caller with JS included; release variant signed with the generated **development debug key**, for personal testing. No Metro server required.
- `homeping-caller-debug.apk`: conventional React Native debug build; requires Metro (`npm run start -w @homeping/mobile`). Use the standalone APK for unattended phone tests.
- `SHA256SUMS`: artifact checksums.

Caller builds include ARM64 and ARMv7. To build an emulator APK, add `x86_64` to `reactNativeArchitectures` in the build command. Do not distribute these development-signed packages as production releases.

Enable developer options and USB/network debugging on your TV, then authorize your computer. Install using ADB (select the serial with `ANDROID_SERIAL` if multiple devices are attached):

```sh
adb devices -l
adb install -r artifacts/homeping-tv-debug.apk
adb shell am start -n dev.tvcall.tv/.SetupActivity
./scripts/inspect-tv.sh > artifacts/tv-device.txt
```

For USB installation, copy the TV APK to a USB drive, open it in a TV file manager, and enable installation from that source when prompted. Open HomePing once after installation. Grant notifications if requested, enter the HTTPS tunnel URL, and select **Register TV / get pairing code**. A code lasts five minutes and can pair both callers. Then press **Home**.

Install the standalone caller APK on the Android phone, enter the tunnel URL, connect, and pair with the TV's code. In the browser, open the tunnel URL and enter the same code. Press **Call TV** from either caller.

## TV notification experiment

Start with **Experimental overlay OFF**. The app creates a high-importance call notification with Accept/Reject actions, a TV content intent, and a full-screen intent. The OS chooses presentation; posting a notification does **not** prove it appeared or that the remote can operate it. Check channel settings if you previously disabled its alerts. On Android 14+, the setup screen also links to full-screen-intent permission settings.

Acceptance opens an activity directly through an activity PendingIntent, then validates the invitation against the backend before showing “Call accepted.” It never requests camera or microphone access. Select **End call and return home** to finish.

If the standard path fails, enable **Experimental overlay** in setup and allow display over other apps. If firmware hides that setting, the one-time ADB fallback is:

```sh
adb shell appops set dev.tvcall.tv SYSTEM_ALERT_WINDOW allow
```

The overlay is focusable and highlights the selected button. Test D-pad/OK, cancellation, Home/Back behavior, and launch after acceptance on the real remote. Permission alone does not prove usable focus or successful background activity launch. Revoke with `adb shell appops set dev.tvcall.tv SYSTEM_ALERT_WINDOW default`.

The ringing service exists only during a pending invitation, with a local expiry timer and server polling. It removes the prompt after cancellation, expiry, rejection, or acceptance. FCM cancellation is best effort; polling reconciles dropped messages. The app queues registration retries with WorkManager after token changes or reboot. No persistent foreground service runs at boot. A manufacturer can still restrict background delivery.

## API and state

All `/api` endpoints except `/api/config` require a Firebase ID token in `Authorization: Bearer …`. See [API reference](docs/API.md).

Invitations ring for 30 seconds. A Firestore transaction permits one ringing/accepted call per TV. The server stores `delivery` separately from `receivedAt`: **FCM submitted** means Firebase accepted the push; **TV acknowledged** means the app reached the backend after receiving it. Neither proves visible presentation. Hardware timing evidence comes from logs and observation.

Expired invitations cannot be accepted. Deadline checks are evaluated from persisted state on reads/actions, so backend restarts do not reset the deadline. Duplicate receipt/action requests are idempotent. Invalid FCM tokens fail the invitation and require registration refresh. Delayed cancellation cannot dismiss a different invitation.

For this prototype, an accepted placeholder has no media/disconnection heartbeat. End it on the TV. If the TV process dies after acceptance, use **Recover active call** in setup to reopen/end it. Calling again remains blocked until that accepted call ends.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

Run `npm run test:web` with an installed Chrome/Chromium binary (`CHROME_BIN` can override its path) for the mocked browser smoke test.

Backend tests use an isolated transactional in-memory store. An additional Firestore adapter test runs when `FIRESTORE_EMULATOR_HOST` is set; see the test report. They do not simulate Hisense firmware or FCM transport.

Follow [the hardware test procedure and report](docs/HARDWARE_TEST.md). The milestone remains **unverified** until that report contains actual Hisense results, including remote operation, ten invitations per caller, idle/reboot behavior, and latency. Do not buy a webcam yet; USB media compatibility and WebRTC are subsequent gates.
