import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Calls, Fault } from '../src/service.js';
import { MemoryStore } from '../src/store.js';
import { appFor } from '../src/http.js';
const setup = async () => {
  let now = 1_000_000;
  const messages: Array<{
    token: string;
    data: Record<string, string>;
    ttl: number;
  }> = [];
  const store = new MemoryStore();
  const push = {
    send: async (token: string, data: Record<string, string>, ttl: number) => {
      messages.push({ token, data, ttl });
    },
  };
  const service = new Calls(store, push, () => now);
  await service.register('tv', 'Living room', 'valid-token-1234567890', {});
  const pairing = await service.pairing('tv');
  await service.pair('caller', pairing.code);
  return {
    service,
    store,
    push,
    messages,
    advance: (ms: number) => {
      now += ms;
    },
    pairing,
  };
};
test('pairing expires and unauthorized callers cannot call or read', async () => {
  const { service, advance, pairing } = await setup();
  await assert.rejects(service.create('stranger', 'tv'), { status: 403 });
  await assert.rejects(service.pair('other', '000000'), { status: 400 });
  const call = await service.create('caller', 'tv');
  await assert.rejects(service.get('other', call.id), { status: 403 });
  advance(300001);
  await assert.rejects(service.pair('other', pairing.code), { status: 400 });
});
test('receipt is separate from submission; actions are authorized and idempotent', async () => {
  const { service, messages } = await setup();
  const call = await service.create('caller', 'tv');
  assert.equal(call.delivery, 'submitted');
  assert.equal(call.receivedAt, undefined);
  assert.equal(messages[0].ttl, 30000);
  assert.equal(messages[0].data.callId, call.id);
  await assert.rejects(service.action('caller', call.id, 'accept'), {
    status: 403,
  });
  await assert.rejects(service.action('tv', call.id, 'cancel'), {
    status: 403,
  });
  const receipt = await service.action('tv', call.id, 'receive');
  assert.ok(receipt.receivedAt);
  assert.deepEqual(await service.action('tv', call.id, 'receive'), receipt);
  const accepted = await service.action('tv', call.id, 'accept');
  assert.equal(accepted.status, 'accepted');
  assert.deepEqual(await service.action('tv', call.id, 'accept'), accepted);
  await assert.rejects(service.action('caller', call.id, 'cancel'), {
    status: 409,
  });
  assert.equal((await service.action('tv', call.id, 'end')).status, 'ended');
  assert.equal((await service.create('caller', 'tv')).status, 'ringing');
});
test('one active call with concurrent requests, cancellation and reject', async () => {
  const { service, messages } = await setup();
  const results = await Promise.allSettled([
    service.create('caller', 'tv'),
    service.create('caller', 'tv'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const call = (
    results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<Calls['create']>>
    >
  ).value;
  assert.equal(
    (await service.action('caller', call.id, 'cancel')).status,
    'cancelled',
  );
  assert.equal(messages.at(-1)?.data.type, 'cancel');
  await assert.rejects(service.action('tv', call.id, 'accept'), {
    status: 409,
  });
  const next = await service.create('caller', 'tv');
  assert.equal(
    (await service.action('tv', next.id, 'reject')).status,
    'rejected',
  );
});
test('expiry persists and stale acceptance is rejected after restart', async () => {
  const { service, store, push, advance } = await setup();
  const call = await service.create('caller', 'tv');
  advance(30000);
  await assert.rejects(service.action('tv', call.id, 'accept'), {
    status: 409,
  });
  const restarted = new Calls(store, push, () => 2_000_000);
  assert.equal((await restarted.get('caller', call.id)).status, 'expired');
  assert.equal((await restarted.create('caller', 'tv')).status, 'ringing');
});
test('invalid push tokens fail invitation, can be refreshed', async () => {
  const { service, push } = await setup();
  push.send = async () => {
    throw Object.assign(new Error('invalid'), {
      code: 'messaging/registration-token-not-registered',
    });
  };
  const failed = await service.create('caller', 'tv');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.delivery, 'failed');
  await assert.rejects(service.create('caller', 'tv'), { status: 409 });
  await service.register('tv', 'Living room', 'new-token-1234567890123', {});
  push.send = async () => {};
  assert.equal((await service.create('caller', 'tv')).delivery, 'submitted');
});
test('receipt racing with send completion is preserved', async () => {
  const { service, push } = await setup();
  push.send = async (_token, data) => {
    await service.action('tv', data.callId, 'receive');
    await service.action('tv', data.callId, 'accept');
  };
  const call = await service.create('caller', 'tv');
  assert.equal(call.status, 'accepted');
  assert.ok(call.receivedAt);
  assert.equal(call.delivery, 'submitted');
});
test('HTTP authentication, validation and ownership', async () => {
  const { service } = await setup();
  const app = appFor(
    service,
    async (token) => {
      if (token === 'caller') return token;
      throw new Fault(401, 'bad');
    },
    {
      apiKey: 'public',
      projectId: 'test',
      androidAppId: 'test',
      messagingSenderId: '1',
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/devices`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/api/devices`, {
          headers: { Authorization: 'Bearer bad' },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${base}/api/calls`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer caller',
            'Content-Type': 'application/json',
          },
          body: '{"tvId":"../bad"}',
        })
      ).status,
      400,
    );
    const devices = await fetch(`${base}/api/devices`, {
      headers: { Authorization: 'Bearer caller' },
    });
    assert.equal(devices.status, 200);
    assert.equal((await devices.json()).length, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
