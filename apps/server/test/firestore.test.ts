import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Calls, type TvRegistration } from '../src/service.js';
import { FirestoreStore } from '../src/store.js';
import { randomUUID } from 'node:crypto';

test('Firestore adapter persists account devices and call expiry', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const app = initializeApp({ projectId: 'demo-homeping' }, `test-${randomUUID()}`);
  const db = getFirestore(app), id = randomUUID();
  let now = Date.now();
  const auth = { customToken: async () => 'token', revoke: async () => {}, deleteUser: async () => {} };
  const registration: TvRegistration = {
    deviceId: id, manufacturer: 'Hisense', model: 'Emulator', androidVersion: '12',
    apiLevel: 31, screenWidthPx: 1920, screenHeightPx: 1080, firmwareFingerprint: 'test',
    builtInCameraAvailable: false, usbHostSupported: true, usbCameraAttached: false,
    cameraApiCount: 0, fcmToken: 'valid-token-1234567890',
  };
  const service = new Calls(new FirestoreStore(db), { send: async () => {} }, auth, () => now, () => 'ABCDEFGH');
  const tv = { kind: 'tv' as const, uid: `tv:${id}`, ownerUid: 'owner', deviceId: id };
  try {
    const started = await service.beginAuthorization(registration, 'x'.repeat(48));
    await service.approveAuthorization('owner', started.code);
    await service.pollAuthorization(started.authorizationId, 'x'.repeat(48));
    await service.registerTv(tv, registration);
    const call = await service.create('owner', id);
    await service.action(tv, call.id, 'receive');
    const restarted = new Calls(new FirestoreStore(db), { send: async () => {} }, auth, () => now);
    assert.ok((await restarted.get({ kind: 'human', uid: 'owner', email: 'x@test' }, call.id)).receivedAt);
    now += 30_001;
    assert.equal((await restarted.get({ kind: 'human', uid: 'owner', email: 'x@test' }, call.id)).status, 'missed');
  } finally { await db.terminate(); await deleteApp(app); }
});
