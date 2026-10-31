# HomePing — Android TV video calling

HomePing links an Android TV / Google TV from any brand to a verified Firebase account and lets that
account send an incoming-call invitation from the web or Android caller. The TV
can show Accept/Reject while it is on the launcher. After acceptance, LiveKit connects two-way audio/video between the TV and the
phone/web caller. Runtime camera/microphone permissions are requested when
joining a call. Hardware features remain optional; external storage permissions
remain blocked. TV-to-phone calling is not included. Hardware compatibility is
still unverified.

One Android APK contains a Kotlin TV receiver and a React Native/Expo phone
caller. It detects the device on launch: television UI mode OR Leanback opens
the TV receiver; other devices open the phone caller. The browser is React/Vite,
and the Node.js/TypeScript server uses Firebase Auth,
Firestore, and high-priority data-only FCM. LiveKit supplies media transport;
see [LiveKit setup and testing](docs/LIVEKIT.md) for the three server-only
environment settings and deployment steps.

## Account and TV authorization flow

1. Install the same `artifacts/homeping.apk` on both the TV and Android phone.
   Sign in on the browser or phone using Google or email/password.
   Email/password accounts must follow the verification link before any API
   operation is allowed.
2. Open HomePing on the TV once and select Sign in to HomePing. It connects to
   the server address built into the APK. The TV creates
   a random UUID and a 256-bit secret stored with Android Keystore-backed
   encrypted storage.
3. The TV displays an eight-character code, QR code, URL, and ten-minute
   deadline. Scan the QR or open the URL on a phone/computer.
4. Sign in, confirm the displayed brand/model, and approve only when the same
   code is visible on your own TV.
5. The TV receives a one-time Firebase custom token for a unique identity
   `tv:{deviceId}`. It then registers under
   `users/{accountUid}/devices/{deviceId}`.

The approval code is single-use and rate-limited. The TV start and poll routes
are the only unauthenticated API bootstrap routes. Every operational route
requires a verified Firebase ID token. Removing a TV deletes its Firestore
device document, revokes its refresh tokens, and deletes only that TV's Firebase
user. The TV must then be authorized again.

Legacy `devices`, `pairings`, and `callers` documents are left untouched
but are no longer read. There is no safe automatic mapping from anonymous
identities to account owners.

Firebase Authentication stores the login account. On verified caller login,
the backend separately creates the Firestore profile at `users/{uid}`.
TV records are created under that account only after TV authorization.

## Firebase setup

1. Create a Firebase project and a Firestore database.
2. In **Authentication → Sign-in method**, enable **Email/Password** and
   **Google**. Disable **Anonymous** sign-in; HomePing no longer uses it.
3. Add your local/tunnel web host to Authentication's authorized domains.
4. Register the unified Android app `dev.tvcall.caller` for FCM/runtime
   configuration. Set `FIREBASE_ANDROID_APP_ID` to this app's Firebase
   application ID. The old `dev.tvcall.tv` registration belongs to the
   previous standalone prototype.
5. Configure Google sign-in for `dev.tvcall.caller`. Add the SHA-1
   and SHA-256 fingerprints for the debug/development signing key, then create
   Android and Web OAuth clients. Put their IDs in `.env`.
6. Deploy [firestore.rules](firestore.rules):

   ```sh
   firebase deploy --only firestore:rules --project YOUR_PROJECT_ID
   ```

   Verified human users can read only their own device documents. Direct
   writes are denied. A TV principal cannot read the owner's device list.
7. Keep a Firebase Admin service-account JSON outside this repository and set
   `GOOGLE_APPLICATION_CREDENTIALS` to its absolute path.

Copy `.env.example` to `.env` and configure the Firebase public values,
OAuth client IDs, and Admin credential path. Restart the server after changes.

## Run locally

Requires Node.js 22.13+ and JDK 17/Android SDK for APK builds.

```sh
npm ci
npm run build
npm run dev
```

The server binds to `127.0.0.1:3000`. Expose it through HTTPS for the TV and
phone, for example:

```sh
cloudflared tunnel --url http://127.0.0.1:3000
```

For local development only, set `HOMEPING_BACKEND_URL` in the developer's
`.env` before building an APK. The phone and TV connect automatically; no URL
entry exists in either app. The backend serves the web app from the same
origin. Temporary tunnel URLs change when restarted and require a new build;
use the permanent deployment below for distribution.

For web development, run `npm run dev:web` alongside the backend. Configure
`WEB_ORIGIN` for any separate Vite origin.

## Build and install

```sh
npm run typecheck
npm test
npm run build
./scripts/build-apks.sh
```

Android build outputs are created locally under ignored `artifacts/`. APKs and
checksums must not be committed. The build produces one installable file:
`artifacts/homeping.apk` (ARM64 and ARMv7, Android 8.0+). Its Android package
ID is `dev.tvcall.caller`, so it upgrades the existing phone installation.
The existing Kotlin source in `apps/tv` is compiled into that APK by a local
Expo config plugin; it is not a second app users must install. The old TV test
host remains available for native development, but is not built by the
distribution script.

```sh
adb install -r artifacts/homeping.apk
adb shell am start -n dev.tvcall.caller/.HomePingLauncherActivity
```

The TV is detected when either `UI_MODE_TYPE_TELEVISION` or
`FEATURE_LEANBACK` is present. For unusual firmware, long-press the HomePing
heading to open the hidden device-mode screen: **Auto detect**, **Run as TV**,
or **Run as phone**. On the TV remote, focus HomePing and hold OK.
On a phone, long-press the HomePing heading. The choice persists between launches.

If the old `dev.tvcall.tv` prototype is installed, remove that old app and
authorize the TV once in the unified app. It has a different Android package
and cannot inherit the old app's Keystore, Firebase session, or local UUID.
Remove its old TV entry from account settings to avoid a duplicate listing.
This is a development-signed build for personal tests.

## Permanent hosting: Render + Firebase

Render runs the existing Node.js API. Firebase Hosting serves the React website;
Firestore stores TVs and calls, Firebase Auth manages accounts, and FCM delivers
invitations. This deployment does not use Firebase Functions or require upgrading
Firebase for backend compute.

1. Create a Render Blueprint from this repository using `render.yaml`. It
   selects one free Node web service, binds to `0.0.0.0` on Render's supplied
   port, and checks `/health`.
2. Set the prompted public Firebase settings. Set `WEB_URL` and
   `WEB_ORIGIN` to `https://YOUR_PROJECT_ID.web.app`. Add Google OAuth client
   IDs as Render environment variables if configured.
3. Add a Render secret file named `homeping-service-account.json` with your
   Firebase Admin credentials. The backend reads
   `/etc/secrets/homeping-service-account.json`; never commit it or put it
   into the website/APK. The identity needs Auth, Firestore, and FCM access.
   A path under `/home/...` or Downloads on your PC cannot be read by Render.
4. After Render gives you its actual HTTPS URL, set
   `HOMEPING_BACKEND_URL=https://YOUR_ACTUAL_SERVICE.onrender.com` in your
   local `.env`. Both the web build and single phone/TV APK use this address.
   Do not invent a Render URL from a proposed service name.
5. Run `npm run deploy:firebase -- --project YOUR_PROJECT_ID` to build/deploy
   the website and Firestore rules. Firebase Hosting does not proxy API calls:
   the website calls Render directly with Firebase ID tokens and allowed CORS.
6. Verify Render's `/health` and `/api/config`, verified sign-in, QR approval
   opening the Firebase website, device registration, and a real invitation.
7. Run `npm run build:apks`. Distribute only `artifacts/homeping.apk` after
   the live checks pass. End users never enter a server address.

Render's free service sleeps after 15 minutes without inbound traffic and can
take about a minute to start again. It is suitable for this prototype but
cannot guarantee the ten-second invitation target after server idle.
See [Render's free-service limits](https://render.com/docs/free).
Firebase services remain subject to their own no-cost quotas.
The phone/web and TV startup configuration requests allow 90 seconds for a
cold start. Ordinary call requests retain their shorter deadline and are not
automatically retried after a network timeout.

## TV settings and call behavior

The TV automatically records manufacturer, model, Android/API version,
resolution, firmware fingerprint, built-in camera availability, USB host
support, whether a USB camera is attached, Camera2 API count, FCM token, and
last-seen time. It never records serial number, IMEI, MAC address, or Wi-Fi
name. Only name, room, and Do Not Disturb are editable.

The caller lists all TVs under the signed-in account with brand/model and
last-seen time. It does not claim a TV is online. Calls can become Ringing,
Accepted, Declined, Missed, Busy, Cancelled, Ended, or Failed. DND immediately
returns Declined without sending FCM. One ringing/accepted call is allowed per
TV and ringing expires after 30 seconds. After acceptance the caller joins automatically. Allow camera/mic permissions
when requested. The TV joins directly after
acceptance. Both sides have mute/camera/End controls, and Android also has camera
switching. Missing or denied inputs are displayed. End on TV returns Home; End
on the phone returns to its caller screen. Leaving the native call screen ends
capture. A 90-second peer-heartbeat lease releases abandoned accepted calls.

Start with the experimental overlay off. Android first receives a high-priority
FCM message and posts a high-importance call notification with Accept/Reject
actions and a full-screen intent. If the firmware does not present it, enable
the overlay and grant its one-time permission. The overlay switch being ON is
not sufficient: grant the permission in system settings. The home screen
shows **Enable call pop-ups** until permission is granted. If this TV
has no overlay permission settings screen, one-time authorized ADB setup is:

```sh
adb shell appops set dev.tvcall.caller SYSTEM_ALERT_WINDOW allow
```

Disconnect ADB after setup and test a call over Home. With HomePing's TV setup
screen already in front, a validated ringing call opens Accept/Reject directly;
There is no manual recovery step in normal use. Incoming ringtone is ON by default:
a bundled melodic marimba/chime ringtone repeats through the TV's media-volume output while the validated
invitation rings, then stops on acceptance/rejection/cancellation/expiry. TV
settings include an ON/OFF switch and a eight-second Test ringtone button. **Reliable mode is off by
default**; when enabled it schedules a periodic token/registration refresh. It
does not bypass Android force-stop or manufacturer background restrictions.

The TV home screen contains its name, room, and TV settings. Only name and room
are editable; About this TV displays detected details. Incoming calls use a centered
HomePing card with remote focus. Technical controls are hidden: long-press HomePing,
then choose Advanced TV preferences for Reliable mode and audio compatibility.
The last 20 diagnostic events remain stored internally without a visible log panel.
Use filtered ADB logs during diagnostic runs; a logged notification is not proof
of a visible, remote-operable prompt.

Small loading cards indicate sign-in, TV authorization, saving, and caller actions.
TV-list loading and media connection use inline spinners. Loading ends on completion
or failure; routine status polling does not show a blocking popup. The phone opens
each accepted call once while foregrounded; Retry connection appears after a launch
failure. Browser calls also connect automatically after acceptance.

See [API documentation](docs/API.md) and the
[hardware verification procedure](docs/HARDWARE_TEST.md).

HomePing uses the same house icon for the TV/phone launcher, caller headers, and
website favicon. Source SVG artwork is in `apps/tv/artwork`; regenerate shared
PNG/SVG assets with `node scripts/generate-tv-branding.mjs` (requires Chrome).

After acceptance, web calls fill the browser window rather than the TV-list card.
The Android caller retains its previous call layout with a small self-preview
and a separate controls row. Video preserves its aspect ratio, so
black bars can appear when camera and display proportions differ.

A TV with no camera can remain in the call and receive the caller's picture and
sound. Its built-in microphone can send audio if Android exposes it to apps and
microphone access is allowed. Missing/unsupported cameras are skipped; enabling
a camera later is safe to retry. The caller displays a camera-unavailable message
when no TV video track arrives. Firmware may still restrict a TV's built-in mic,
so actual two-way audio requires a hardware call test.
