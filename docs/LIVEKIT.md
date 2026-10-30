# Live audio/video with LiveKit

HomePing keeps Firebase login, account-owned TVs, FCM invitations, Accept/Reject,
and the 30-second ringing deadline. After acceptance it uses LiveKit for WebRTC
signaling, media forwarding, and the ICE configuration supplied by your LiveKit
server. The Node API issues participant tokens; it does not relay audio/video.
No conference code or additional app is needed. Calling remains phone/web → TV.

## Configure Render

In LiveKit Cloud, open your project, find the project WebSocket URL and create
an API key/secret pair under Settings / API keys. In **Render → HomePing service
→ Environment → Environment Variables**, add all three:

```text
LIVEKIT_URL=wss://YOUR_PROJECT.livekit.cloud
LIVEKIT_API_KEY=YOUR_FULL_API_KEY
LIVEKIT_API_SECRET=YOUR_MATCHING_API_SECRET
```

`wss` alone is not a URL. These values are environment variables, not Firebase
Secret Files. Keep the existing Firebase Admin JSON Secret File and
`GOOGLE_APPLICATION_CREDENTIALS` setting too. Save and redeploy after the new
source reaches the connected GitHub branch. Existing services need these
settings entered manually; changing `render.yaml` alone does not edit their
Render dashboard configuration.

For development put the same three settings in the ignored root `.env`.
`.env.example` intentionally has blank values. Never commit credentials, paste
them into chat, or put the secret under a `VITE_` or `EXPO_PUBLIC_` variable.
The APK only embeds the HomePing API URL, never LiveKit Admin credentials.
All three values may be absent for invitation-only tests. A partially configured
set fails server startup; an unconfigured media endpoint gives a clear 503.
`GET /api/config` reports `mediaEnabled` without returning the API key or secret.

A LiveKit Cloud project is a separate service from Firebase and Render. Its
allowance/usage limits apply separately. You can use an appropriately configured
self-hosted LiveKit deployment instead; hosting the Node API on Render does not
also host a LiveKit media server. See the official
[deployment documentation](https://docs.livekit.io/transport/self-hosting/deployment/).

## Deploy and install

1. Sync these source changes to the GitHub branch connected to Render. Save the
   three LiveKit variables and deploy that commit. Check `/health` and that
   `/api/config` includes `"mediaEnabled": true`.
2. Build/publish the website using `npm run deploy:firebase -- --project YOUR_PROJECT_ID`.
   Static files on Firebase Hosting need their own deployment; deploying Render
   does not update them.
3. Run `npm run build:apks` and install `artifacts/homeping.apk` on both phone
   and TV, replacing the previous version. It is still one APK/package.
4. Authorize the TV to your account if needed and press Home. Call it from the
   signed-in phone or website. Accept with the TV remote.
5. On the phone/web select **Join video call**. On Android, the shared native
   call screen opens. Allow camera and microphone permissions on both devices.
   The TV starts joining immediately after acceptance/permission response.
6. Verify both directions of audio and video. Mute/enable mic, turn camera
   off/on, switch Android cameras when available, and End from either side.
   TV End returns to Home; phone End returns to the phone caller. On Android,
   leaving the call screen ends capture and the call.

The browser needs HTTPS (localhost is allowed for development). If autoplay is
blocked, use **Play TV audio**. A denied permission or missing input is displayed;
the client can still receive media and use whichever input is available.

## Security and lifecycle

`POST /api/calls/:id/media` requires a verified owner or the exact active TV
principal and an Accepted call. The server chooses the room and participant
identity; the client cannot choose either. Tokens live for 60 seconds, allow only
camera/microphone publication and subscription in that one room, and grant no
administration, screen sharing, or data publication. Rooms allow two participants;
the two identities are derived from the call ID and role and contain no email.
This two-person limit belongs to the LiveKit room, while ownership remains in
HomePing's API.

Both clients send `POST /api/calls/:id/heartbeat` every ten seconds while joined.
The media lease is 90 seconds from the older peer's last heartbeat. The first
lease starts at acceptance, so accepting without joining does not occupy a TV
indefinitely. Status reads/operations reconcile expired leases to Ended.
Firestore retains this state across backend restarts. LiveKit also expires empty
rooms; it is not dependent on a Render process staying awake for media transport.
Normal status polling still requires the HomePing API.

End/removal records terminal state and asks LiveKit to delete the room, which
disconnects participants. Room cleanup failure is logged without secrets and is
retried by later terminal status reads. Clients also disconnect locally on End
and stop capture immediately when leaving the screen. Previously issued JWTs
are bearer credentials until expiry; backend refusal of a new token is not
instant revocation of a JWT already issued. Never expose or persist join tokens.
TLS/LiveKit's normal media encryption is used; additional end-to-end encryption
has not been implemented.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:web
npm run test:media
npm run build:apks
```

`test:media` is deliberately opt-in: it reads local `.env`, creates a short-lived
room in that real LiveKit project, and uses two headless Chrome sessions with
synthetic camera/mic inputs. It exercises the actual backend/token code and web
call component. It verifies decoded remote video frames and advancing audio on
both sides, toggles mic/camera, and verifies remote End propagation. Temporary
files and the test room are removed. It does not log keys or tokens. It does not
exercise Android hardware, FCM, or production Firebase login.

## Hardware limitations still to test

A USB video device appearing in `usbCameraAttached` does not prove Android exposes
it to the camera APIs. This implementation uses LiveKit's Android camera capture,
with an external Camera2 device preferred on TV when available. It does not add a
separate UVC driver. A webcam not exposed through Android's camera APIs cannot
publish video through this path. USB microphone routing is also firmware-dependent.
Do not buy a webcam on the assumption that every Android TV supports it.

Complete [HARDWARE_TEST.md](HARDWARE_TEST.md) for the specific model/firmware,
including remote focus, home-screen prompts, permissions, both media directions,
idle/reboot behavior and calls across different networks. Successful software
builds/browser tests do not establish that hardware gate.

### Native audio troubleshooting

TV settings include **TV audio compatibility** (default ON). It selects the TV's
normal media-output stream and MIC capture source; phones retain the SDK's
communication/headset profile. Turn it OFF before a new call to compare the
communication path on other firmware. System sound-output selection still
applies: if the TV is connected to a Bluetooth speaker/PC, choose TV speakers in
TV Sound settings when that is where you expect audio.

During a call, **Audio info** reports available microphone types, the Android
recording route when reported, permission status and USB microphone detection.
**Mic** and **Incoming audio** indicators show in-memory PCM peaks. They distinguish
missing callbacks from digital silence and nonzero samples; they do not establish
speaker audibility or physical USB microphone compatibility. No diagnostic audio
is stored. A working USB camera can still expose no usable microphone.
