import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenVerifier } from 'livekit-server-sdk';
import { Media, mediaConfig, roomName } from '../src/media.js';
import { Calls, Fault, type Principal } from '../src/service.js';

const config = { url: 'wss://media.example.test', apiKey: 'APItest', apiSecret: 'a'.repeat(40) };
const principal: Principal = { kind: 'human', uid: 'owner', email: 'private@example.test' };
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('media env is optional, complete and never permits insecure or credential-bearing URLs', () => {
  assert.equal(mediaConfig({}), undefined);
  assert.throws(() => mediaConfig({ LIVEKIT_URL: config.url }));
  for (const url of ['wss', 'https://media.test', 'ws://media.test', 'wss://user:secret@media.test', 'wss://media.test?key=secret'])
    assert.throws(() => mediaConfig({ LIVEKIT_URL: url, LIVEKIT_API_KEY: config.apiKey, LIVEKIT_API_SECRET: config.apiSecret }));
  assert.deepEqual(mediaConfig({ LIVEKIT_URL: config.url, LIVEKIT_API_KEY: config.apiKey, LIVEKIT_API_SECRET: config.apiSecret }), config);
});

test('join tokens are signed, short lived, scoped to one room and role; no PII or moderation grant', async () => {
  const created: unknown[] = [], deleted: string[] = [];
  const media = new Media(config, {
    createRoom: async options => { created.push(options); },
    deleteRoom: async name => { deleted.push(name); },
  });
  let checks = 0;
  const calls = { mediaSession: async () => { checks++; } } as unknown as Calls;
  for (const who of [principal, { kind: 'tv', uid: 'tv:one', ownerUid: 'owner', deviceId: 'one' } as Principal]) {
    const response = await media.join(calls, who, id);
    assert.equal(response.url, config.url);
    const claims = await new TokenVerifier(config.apiKey, config.apiSecret).verify(response.token);
    assert.equal(claims.sub, `${who.kind}-${id}`);
    assert.equal(claims.video?.room, roomName(id));
    assert.equal(claims.video?.roomJoin, true);
    assert.equal(claims.video?.canPublishData, false);
    assert.deepEqual(claims.video?.canPublishSources, ['camera', 'microphone']);
    assert.equal(claims.video?.roomAdmin, undefined);
    assert.ok(claims.exp! - claims.nbf! <= 60);
    assert.ok(!JSON.stringify(claims).includes('private@example.test'));
    assert.ok(!JSON.stringify(response).includes(config.apiSecret));
  }
  assert.equal(checks, 4);
  assert.deepEqual(created[0], { name: roomName(id), maxParticipants: 2, emptyTimeout: 60, departureTimeout: 15 });
  await media.close(id); assert.deepEqual(deleted, [roomName(id)]);
});

test('unauthorized/nonaccepted calls never reach LiveKit or receive tokens; unavailable backend is explicit', async () => {
  let created = 0;
  const rooms = { createRoom: async () => { created++; }, deleteRoom: async () => {} };
  const media = new Media(config, rooms);
  const denied = { mediaSession: async () => { throw new Fault(403, 'Not your call'); } } as unknown as Calls;
  await assert.rejects(media.join(denied, principal, id), { status: 403 });
  assert.equal(created, 0);
  const accepted = { mediaSession: async () => {} } as unknown as Calls;
  await assert.rejects(new Media().join(accepted, principal, id), { status: 503 });
  await assert.rejects(new Media(config, { ...rooms, createRoom: async () => { throw new Error('bad credentials'); } }).join(accepted, principal, id), { status: 503 });
});


test('ending a call during room creation cleans the room and never returns a token', async () => {
  let checks = 0, deleted = 0;
  const media = new Media(config, { createRoom: async () => {}, deleteRoom: async () => { deleted++; } });
  const calls = { mediaSession: async () => { if (++checks === 2) throw new Fault(409, 'Call ended'); } } as unknown as Calls;
  await assert.rejects(media.join(calls, principal, id), { status: 409 });
  assert.equal(deleted, 1);
});
