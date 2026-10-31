import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Calls, Fault, type HumanPrincipal, type TvPrincipal, type TvRegistration } from '../src/service.js';
import { MemoryStore } from '../src/store.js';
import { appFor } from '../src/http.js';

const deviceId = '11111111-1111-4111-8111-111111111111';
const registration: TvRegistration = {
  deviceId, manufacturer: 'Hisense', model: 'Test TV', androidVersion: '12',
  apiLevel: 31, screenWidthPx: 1920, screenHeightPx: 1080,
  firmwareFingerprint: 'test/fingerprint', builtInCameraAvailable: false,
  usbHostSupported: true, usbCameraAttached: false, cameraApiCount: 0,
  fcmToken: 'valid-token-1234567890',
};
const human = (uid = 'owner'): HumanPrincipal => ({ kind: 'human', uid, email: `${uid}@example.test` });
const tv: TvPrincipal = { kind: 'tv', uid: `tv:${deviceId}`, ownerUid: 'owner', deviceId };

async function setup() {
  let now = 1_000_000;
  const messages: Array<{ token: string; data: Record<string, string>; ttl: number }> = [];
  const deleted: string[] = [], revoked: string[] = [];
  const store = new MemoryStore();
  const auth = {
    customToken: async (uid: string) => `custom:${uid}`,
    revoke: async (uid: string) => { revoked.push(uid); },
    deleteUser: async (uid: string) => { deleted.push(uid); },
  };
  const push = { send: async (token: string, data: Record<string, string>, ttl: number) => { messages.push({ token, data, ttl }); } };
  const codes = ['ABCDEFGH', 'QWERTY23', 'ZXCVBNM2'];
  const service = new Calls(store, push, auth, () => now, () => codes.shift() ?? 'ASDFGHJ2');
  const started = await service.beginAuthorization(registration, 'x'.repeat(48));
  await service.approveAuthorization('owner', started.code);
  const polled = await service.pollAuthorization(started.authorizationId, 'x'.repeat(48));
  assert.equal(polled.status, 'approved');
  await service.registerTv(tv, registration);
  return { service, store, push, auth, messages, deleted, revoked, advance: (ms: number) => { now += ms; } };
}

test('device authorization expires and is single-use', async () => {
  let now = 1_000;
  let nextCode = 'ZXCVBNM2';
  const service = new Calls(new MemoryStore(), { send: async () => {} }, {
    customToken: async () => 'token', revoke: async () => {}, deleteUser: async () => {},
  }, () => now, () => nextCode);
  const first = await service.beginAuthorization(registration, 's'.repeat(48));
  await service.approveAuthorization('owner', first.code);
  assert.equal((await service.pollAuthorization(first.authorizationId, 's'.repeat(48))).status, 'approved');
  await assert.rejects(service.pollAuthorization(first.authorizationId, 's'.repeat(48)), { status: 409 });
  await assert.rejects(service.approveAuthorization('owner', first.code), { status: 409 });
  nextCode = 'QWERTY23';
  const second = await service.beginAuthorization({ ...registration, deviceId: '22222222-2222-4222-8222-222222222222' }, 't'.repeat(48));
  now += 600_001;
  await assert.rejects(service.approveAuthorization('owner', second.code), { status: 400 });
  await assert.rejects(service.pollAuthorization(second.authorizationId, 't'.repeat(48)), { status: 410 });
});

test('registration preserves editable fields and detected fields cannot be edited', async () => {
  const { service } = await setup();
  const edited = await service.updateDevice('owner', deviceId, { name: 'Living Room TV', room: 'Living room' });
  assert.equal(edited.name, 'Living Room TV');
  const refreshed = await service.registerTv(tv, { ...registration, model: 'Detected Model', cameraApiCount: 2 });
  assert.equal(refreshed.name, 'Living Room TV');
  assert.equal(refreshed.model, 'Detected Model');
  assert.equal(refreshed.cameraApiCount, 2);
  await assert.rejects(service.updateDevice('stranger', deviceId, { name: 'Stolen' }), { status: 403 });
});

test('ownership is enforced and another user receives 403', async () => {
  const { service } = await setup();
  await assert.rejects(service.create('stranger', deviceId), { status: 403 });
  const call = await service.create('owner', deviceId);
  await assert.rejects(service.get(human('stranger'), call.id), { status: 403 });
});

test('verified account sync creates a Firestore profile once and preserves creation time', async () => {
  const { service, store, advance } = await setup();
  const first = await service.account(human());
  const stored = await store.run(tx => tx.get('users/owner'));
  assert.deepEqual(stored, first);
  advance(10_000);
  assert.deepEqual(await service.account(human()), first);
  const changed = await service.account({ ...human(), email: 'updated@example.test' });
  assert.equal(changed.createdAt, first.createdAt);
  assert.equal(changed.updatedAt, first.updatedAt + 10_000);
});

test('a TV cannot be authorized under two accounts', async () => {
  const { service } = await setup();
  const second = await service.beginAuthorization(registration, 'y'.repeat(48));
  await assert.rejects(service.approveAuthorization('stranger', second.code), { status: 409 });
});

test('call lifecycle is authorized, idempotent, busy and missed', async () => {
  const { service, messages, advance } = await setup();
  const call = await service.create('owner', deviceId);
  assert.equal(call.delivery, 'submitted');
  assert.equal(messages[0].ttl, 60_000);
  await assert.rejects(service.action(human(), call.id, 'accept'), { status: 403 });
  const receipt = await service.action(tv, call.id, 'receive');
  assert.ok(receipt.receivedAt);
  assert.deepEqual(await service.action(tv, call.id, 'receive'), receipt);
  const busy = await service.create('owner', deviceId);
  assert.equal(busy.status, 'busy');
  assert.equal((await service.action(tv, call.id, 'decline')).status, 'declined');
  const missed = await service.create('owner', deviceId);
  advance(60_000);
  await assert.rejects(service.action(tv, missed.id, 'accept'), { status: 409 });
  assert.equal((await service.get(human(), missed.id)).status, 'missed');
});

test('DND declines without push and removal revokes and deletes the TV identity', async () => {
  const { service, messages, deleted, revoked } = await setup();
  await service.updateTvSettings(tv, { doNotDisturb: true });
  assert.equal((await service.create('owner', deviceId)).status, 'declined');
  assert.equal(messages.length, 0);
  await service.removeDevice('owner', deviceId);
  assert.deepEqual(revoked, [tv.uid]);
  assert.deepEqual(deleted, [tv.uid]);
  await assert.rejects(service.registerTv(tv, registration), { status: 403 });
});

test('invalid push token is cleared and can be refreshed', async () => {
  const { service, push } = await setup();
  push.send = async () => { throw Object.assign(new Error('invalid'), { code: 'messaging/registration-token-not-registered' }); };
  const failed = await service.create('owner', deviceId);
  assert.equal(failed.status, 'failed');
  await assert.rejects(service.create('owner', deviceId), { status: 409 });
  await service.registerTv(tv, { ...registration, fcmToken: 'new-token-1234567890123' });
  push.send = async () => {};
  assert.equal((await service.create('owner', deviceId)).delivery, 'submitted');
});

test('HTTP requires verified principals and rejects forbidden fields', async () => {
  const { service } = await setup();
  const app = appFor(service, async (token) => {
    if (token === 'owner') return human();
    if (token === 'tv') return tv;
    if (token === 'stranger') return human('stranger');
    throw new Fault(401, 'bad');
  }, { apiKey: 'public', projectId: 'test', androidAppId: 'test', messagingSenderId: '1' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/devices`)).status, 401);
    const headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${base}/api/devices`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/devices/${deviceId}`, {
      method: 'PATCH', headers, body: JSON.stringify({ model: 'Fake' }),
    })).status, 400);
    assert.equal((await fetch(`${base}/api/devices`, { headers: { Authorization: 'Bearer tv' } })).status, 403);
    const call = await service.create('owner', deviceId);
    const media = `${base}/api/calls/${call.id}/media`;
    assert.equal((await fetch(media, { method: 'POST' })).status, 401);
    assert.equal((await fetch(media, { method: 'POST', headers })).status, 409);
    await service.action(tv, call.id, 'accept');
    assert.equal((await fetch(media, { method: 'POST', headers: { Authorization: 'Bearer stranger' } })).status, 403);
    assert.equal((await fetch(media, { method: 'POST', headers })).status, 503);
    assert.equal((await fetch(`${base}/api/calls/${call.id}/heartbeat`, { method: 'POST', headers })).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  }
});

test('media credentials require acceptance, ownership and an existing TV', async () => {
  const { service } = await setup();
  const call = await service.create('owner', deviceId);
  await assert.rejects(service.mediaSession(human(), call.id), { status: 409 });
  await service.action(tv, call.id, 'accept');
  await assert.rejects(service.mediaSession(human('stranger'), call.id), { status: 403 });
  await assert.rejects(service.mediaSession({ ...tv, deviceId: 'another-tv' }, call.id), { status: 403 });
  assert.equal((await service.mediaSession(tv, call.id)).status, 'accepted');
  await service.removeDevice('owner', deviceId);
  await assert.rejects(service.mediaSession(tv, call.id), { status: 403 });
  await assert.rejects(service.mediaSession(human(), call.id), { status: 409 });
});

test('either side can end media, repeats are idempotent and new joins fail', async () => {
  const { service } = await setup();
  for (const ender of [human(), tv]) {
    const call = await service.create('owner', deviceId);
    await service.action(tv, call.id, 'accept');
    const ended = await service.action(ender, call.id, 'end');
    assert.equal(ended.status, 'ended');
    assert.deepEqual(await service.action(ender, call.id, 'end'), ended);
    await assert.rejects(service.mediaSession(ender, call.id), { status: 409 });
  }
});

test('media lease needs heartbeats from both sides; one crashed peer expires', async () => {
  const { service, advance } = await setup();
  const call = await service.create('owner', deviceId);
  await service.action(tv, call.id, 'accept');
  for (let index = 0; index < 5; index++) {
    advance(20_000);
    if (index < 4) {
      await service.mediaSession(human(), call.id, true);
      await service.mediaSession(tv, call.id, true);
    }
  }
  assert.equal((await service.get(human(), call.id)).status, 'accepted');
  for (let index = 0; index < 3; index++) { advance(20_000); await service.mediaSession(human(), call.id, true); }
  advance(10_000);
  assert.equal((await service.get(human(), call.id)).status, 'ended');
  await assert.rejects(service.mediaSession(tv, call.id), { status: 409 });
  assert.equal((await service.create('owner', deviceId)).status, 'ringing');
});

test('new TVs default to Bedroom and auto-accept off', async () => {
  const { service } = await setup();
  const [device] = await service.devices('owner');
  assert.equal(device.room, 'Bedroom');
  assert.equal(device.autoAccept, false);
  const call = await service.create('owner', deviceId);
  assert.equal(call.expiresAt - call.createdAt, 60_000);
  assert.equal(call.autoAcceptUntil, undefined);
});

test('auto-accept is TV-only, due at 60 seconds, and idempotent', async () => {
  const { service, advance, messages } = await setup();
  await service.updateTvSettings(tv, { autoAccept: true });
  const call = await service.create('owner', deviceId);
  assert.equal(messages[0].ttl, 60_000);
  await service.action(tv, call.id, 'receive');
  await assert.rejects(service.action(human(), call.id, 'auto-accept'), { status: 403 });
  advance(59_999);
  await assert.rejects(service.action(tv, call.id, 'auto-accept'), { status: 409 });
  advance(1);
  assert.equal((await service.get(human(), call.id)).status, 'ringing');
  await assert.rejects(service.action(tv, call.id, 'accept'), { status: 409 });
  assert.equal((await service.action(tv, call.id, 'auto-accept')).status, 'accepted');
  assert.equal((await service.action(tv, call.id, 'auto-accept')).status, 'accepted');
});

test('auto-accept cannot revive cancelled, declined, unreceived or expired invitations', async () => {
  for (const state of ['cancelled', 'declined', 'unreceived', 'expired', 'disabled', 'dnd'] as const) {
    const { service, advance } = await setup();
    await service.updateTvSettings(tv, { autoAccept: true });
    const call = await service.create('owner', deviceId);
    if (state !== 'unreceived') await service.action(tv, call.id, 'receive');
    if (state === 'cancelled') await service.action(human(), call.id, 'cancel');
    if (state === 'declined') await service.action(tv, call.id, 'decline');
    if (state === 'disabled') await service.updateTvSettings(tv, { autoAccept: false });
    if (state === 'dnd') await service.updateTvSettings(tv, { doNotDisturb: true });
    advance(state === 'expired' ? 70_000 : 60_000);
    await assert.rejects(service.action(tv, call.id, 'auto-accept'), { status: 409 });
  }
});
