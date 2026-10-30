# HomePing backend API

Base path: `/api`. JSON request and response bodies. Human endpoints require
a Firebase ID token with `email_verified: true`. TV endpoints require the
custom claims `role: "tv"`, `ownerUid`, and `deviceId`, plus a matching
active device document.

The public `GET /config` and the device-authorization start/poll routes are
bootstrap exceptions because an unapproved TV does not yet have a Firebase
identity.

## Authentication and devices

| Method and path | Authentication | Body / result |
| --- | --- | --- |
| GET `/config` | Public | Firebase public configuration, optional Google OAuth client IDs, and `mediaEnabled`; no LiveKit credentials |
| POST `/account` | Verified human | Idempotent profile sync at `users/{uid}`; returns uid, email, and timestamps |
| POST `/device-authorizations` | Bootstrap secret | `{registration, deviceSecret}` → code, authorization ID, ten-minute expiry, poll interval |
| POST `/device-authorizations/poll` | Authorization ID + secret | Pending status or a one-time Firebase custom token |
| POST `/device-authorizations/inspect` | Verified human | `{code}` → brand, model, expiry before approval |
| POST `/device-authorizations/approve` | Verified human | `{code}` → newly owned TV |
| POST `/tv/register` | Matching TV | Refresh detected fields, FCM token, and last-seen |
| PATCH `/tv/settings` | Matching TV | Strict body containing only `name`, `room`, and/or `doNotDisturb` |
| GET `/tv/active-call` | Matching TV | Ringing/accepted call used for recovery |
| GET `/devices` | Verified human | Account's TVs |
| PATCH `/devices/:deviceId` | Owner | Strict body containing only `name` and/or `room` |
| DELETE `/devices/:deviceId` | Owner | Delete document, revoke tokens, and delete the unique TV Firebase user |

Registration fields are `deviceId`, `manufacturer`, `model`,
`androidVersion`, `apiLevel`, `screenWidthPx`, `screenHeightPx`,
`firmwareFingerprint`, `builtInCameraAvailable`, `usbHostSupported`,
`usbCameraAttached`, `cameraApiCount`, and optional `fcmToken`.

## Calls

| Method and path | Authentication | Body / result |
| --- | --- | --- |
| POST `/devices/:deviceId/calls` | Owner | Create invitation; terminal Declined for DND or Busy for an occupied TV |
| GET `/calls/:callId` | Owner or target TV | Current authoritative state |
| POST `/calls/:callId/action` | Role-dependent | `{action}` where action is `receive`, `accept`, `decline`, `cancel`, or `end`; either participant may end |
| POST `/calls/:callId/media` | Owner or exact active TV | Accepted calls only; `{url, token}` for one private LiveKit room; `Cache-Control: no-store` |
| POST `/calls/:callId/heartbeat` | Owner or exact active TV | Accepted calls only; updates that role's media lease and returns call |

Call fields:

```ts
{
  id: string
  deviceId: string
  ownerUid: string
  callerUid: string
  status: "ringing" | "accepted" | "declined" | "missed" |
          "busy" | "cancelled" | "ended" | "failed"
  createdAt: number
  expiresAt: number
  updatedAt: number
  delivery: "pending" | "submitted" | "failed" | "not-sent"
  acceptedAt?: number
  callerSeenAt?: number
  tvSeenAt?: number
  mediaDeadline?: number
  receivedAt?: number
  error?: string
}
```

Times are Unix milliseconds. `receive` records FCM receipt separately from
FCM submission and visual presentation. Calls expire to Missed at 30 seconds.
Repeated completed actions are idempotent; conflicting transitions return 409.
Expired or cancelled invitations cannot be accepted.

Calls are limited to five per user per minute and thirty per hour.
Device-authorization starts are limited to five per IP/device per ten minutes,
approvals to ten per user per ten minutes, and polls to one per authorization
every five seconds.

## Firestore

`users/{uid}/devices/{deviceId}` stores account-owned TVs. Operational fields
include the detected registration fields, `authUid`, `fcmToken`,
`activeCallId`, `doNotDisturb`, `lastSeen`, timestamps, and schema version.

`deviceAuthorizations/{authorizationId}` contains only hashed codes/secrets,
state, expiry, registration preview, and approval/consumption timestamps.
`deviceAuthorizationCodes/{codeHash}` is the short-code lookup.
`deviceOwners/{deviceId}` prevents one TV UUID from belonging to two accounts.
`calls/{callId}` stores call state.

Admin SDK operations enforce writes. Firestore rules allow a verified human to
read only their own user/device paths. TV principals and all clients are denied
direct writes.

An unverified email returns 403 with `code: EMAIL_NOT_VERIFIED`; the caller
refreshes its ID token once after verification. Expired/revoked tokens return
401. Firebase Admin credential, IAM, or verification-service failures return
503 with `code: AUTH_SERVICE_UNAVAILABLE`, rather than blaming the user's
token. Server logs include only the Firebase error code, never the ID token.

Errors use `{error: string}`, with validation details where applicable:
400 invalid input/code, 401 invalid or unverified authentication, 403 ownership
or role failure, 404 missing resource, 409 state conflict, 410 expired device
authorization, and 429 rate limit.


## Media

The backend reads `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`.
These settings never appear in public configuration; the media endpoint returns
only the server URL and a 60-second participant JWT. The server assigns
`homeping-{callId}` and `{human|tv}-{callId}` identities, creates a two-participant
room, and grants camera/microphone publication and subscription only. No client
selects a room, moderation grants or another participant's identity.

Media token requests are limited to twelve per principal per minute. Ringing,
missed, cancelled, declined, ended, or failed calls return 409; missing LiveKit
configuration/service returns 503. Ownership/TV authorization is checked again
inside the media transaction. Caller and TV heartbeat every ten seconds. The
older peer's heartbeat plus 90 seconds is the accepted-call deadline; status
reads reconcile expired sessions to Ended. End and device removal request room
deletion; clients also disconnect and stop their own capture. Previously issued
bearer tokens remain valid until expiry, so new-token refusal is not instant
JWT revocation. See [LIVEKIT.md](LIVEKIT.md) for deployment and lifecycle details.
