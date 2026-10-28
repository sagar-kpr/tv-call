# Backend API

Base: `/api`. JSON bodies. All endpoints except `GET /config` require a Firebase Authentication ID token. TV ownership is its Firebase user UID. Caller access is granted only by a pairing code. IDs must contain ASCII letters, digits, `_`, or `-` (128 characters maximum).

| Method / path | Body | Result / authorization |
| --- | --- | --- |
| GET `/config` | — | Public `apiKey`, `projectId`, `androidAppId`, `messagingSenderId` |
| POST `/devices/register` | `{name, token, hardware?}` | `{tvId}`; register/update the authenticated TV identity |
| POST `/devices/pairing-code` | `{}` | `{code, expiresAt}`; registered TV only; expires after 5 minutes |
| POST `/pair` | `{code}` | `{tvId, name}`; grants this caller access; reusable within expiry for both callers |
| GET `/devices` | — | Array of paired `{tvId, name}` records for this caller |
| GET `/devices/active-call` | — | `{call: Call | null}` for the authenticated TV; recovery after activity/process loss |
| POST `/calls` | `{tvId}` | New call; caller must be paired; 409 if TV busy/token unavailable |
| GET `/calls/:id` | — | Call; originating caller or owning TV only |
| POST `/calls/:id/action` | `{action}` | Updated call; see transitions below |

Call JSON: `id`, `tvId`, `callerId`, `status`, `createdAt`, `expiresAt`, `updatedAt`, `delivery`, optional `receivedAt`, optional `error`. Times are Unix milliseconds. `delivery` is `pending | submitted | failed`.

Transitions:

- `ringing → accepted / rejected`: TV actions `accept` / `reject`.
- `ringing → cancelled`: originating caller action `cancel`.
- `ringing → expired`: server deadline check on read/action or the next invitation.
- `ringing → failed`: FCM submission failure; `error` contains a machine-readable failure code.
- `accepted → ended`: TV action `end`.
- `receive`: TV acknowledgment while ringing, recorded once; does not accept a call.

Retries of the same completed action return its current state. Conflicting transitions return 409; a cancelled/expired call never becomes accepted. The create operation itself is not idempotent: do not automatically retry a timed-out POST. Firestore serializes competing creations; only one can succeed. Push submission may complete after the TV acknowledgment without overwriting that acknowledgment/state.

Errors: `{error: string}`; invalid input may also include `details`. 400 malformed input/pairing code; 401 authentication; 403 ownership; 404 missing resource; 409 state conflict; 429 rate limit; 500 backend error. Pairing is limited to ten attempts per UID per five minutes and all authenticated API traffic to 300 requests/IP/minute. Restarting the single backend resets these limits. No proxy headers are trusted by default.

Firestore collections: `devices`, `pairings` (SHA-256 code keys), `callers`, `calls`. Client Firestore access is denied by rules. Pairing/call expiry is enforced by the application, not Firestore TTL. Historical documents remain until manually cleaned up; the prototype has no automatic retention policy.
