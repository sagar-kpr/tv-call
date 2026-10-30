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
3. Accept, verify the placeholder opens only after acceptance, then End and verify Home returns. Repeat with Reject, Cancel, and no answer. Check the caller state each time. Acknowledgment alone is not a visual pass.
4. If standard notifications fail, document the exact failure. Enable overlay permission once (settings or documented ADB appops), then disconnect ADB and repeat. Record input focus, underlying launcher interaction, and activity launch. If this also fails, stop before WebRTC and assess another Android TV device; do not label this milestone passed.
5. Run ten invitations **per caller**, including after **30 minutes idle**. Keep backend/tunnel running. Each prompt must appear within **10 seconds** under healthy connectivity. Record all attempts rather than discarding failures.
6. Repeat background tests after OS process termination (`adb shell am kill dev.tvcall.caller` while backgrounded), disconnect ADB, and call again. Repeat after a full TV reboot/network restoration without opening HomePing. Record timing separately from ordinary idle tests.
7. Test explicit force-stop (`adb shell am force-stop dev.tvcall.caller`) separately. Android normally leaves a force-stopped package unable to receive pushes until the user launches it again. Record that limitation and verify recovery by opening the app once; do not treat force-stop as ordinary process death.
8. Test TV Wi-Fi loss/restoration, phone network loss, and backend/tunnel interruption. Invite while TV offline, wait beyond 30 seconds, reconnect, and verify no accepted placeholder appears. Cancel while TV temporarily offline; verify stale actions fail after reconnection. Turn network off during acceptance: the TV must show an error rather than claim acceptance.
9. Trigger simultaneous calls from web/Android: exactly one rings; the other reports Busy. Enable Do Not Disturb and confirm the caller immediately reports Declined with no TV prompt. Duplicate a push in a controlled test: one invitation, one expiry, no duplicate acceptance. Refresh the FCM token and confirm registration retries and new invitations.
10. Restart the backend while ringing. Reconnect before expiry to verify the persisted call; after expiry, verify acceptance fails. Test dropped cancellation push with server polling still available.

Collect logs in a **separate diagnostic run** with `adb logcat -s HomePing` and copy the TV's last-20-events debug screen; routine latency/reliability runs must also work disconnected from ADB. Logs include shortened call IDs, FCM receipt, notification posting, overlay display, registration, and call actions without FCM tokens. Record visual appearance time by observation/video; notification posting is not proof of screen visibility.

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

Pending. Pass requires both callers, visible and remote-operable Accept/Reject on the real home screen, accepted placeholder launch, return Home, required repetition/latency tests, and documented lifecycle results. If boot delivery needs reopening the app, the requested unattended workflow has failed that condition. Sleep/wake from powered-off or standby is outside this first milestone; TV is assumed on at its home screen.
