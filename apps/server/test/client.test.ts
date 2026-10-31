import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api, AutoJoinGate, videoProfile, emptyDeviceMessage, lastSeenLabel } from '../../../packages/client/src/index.js';

test('client uses supplied Firebase tokens and retries once after 401', async () => {
  const original = globalThis.fetch;
  const tokens: boolean[] = [];
  let attempts = 0;
  globalThis.fetch = async (_input, init) => {
    attempts++;
    const auth = new Headers(init?.headers).get('Authorization');
    if (attempts === 1) return Response.json({ error: 'expired' }, { status: 401 });
    assert.equal(auth, 'Bearer refreshed');
    return Response.json([]);
  };
  try {
    const api = new Api('https://example.test', async (force) => {
      tokens.push(!!force); return force ? 'refreshed' : 'old';
    });
    assert.deepEqual(await api.devices(), []);
    assert.deepEqual(tokens, [false, true]);
  } finally { globalThis.fetch = original; }
});

test('No TV detected and last-seen presentation are stable', () => {
  assert.equal(emptyDeviceMessage([]), 'No TV detected');
  assert.equal(lastSeenLabel(1_000_000, 1_030_000), 'last seen less than a minute ago');
  assert.equal(lastSeenLabel(1_000_000, 1_060_000), 'last seen 1 minute ago');
  assert.equal(lastSeenLabel(1_000_000, 1_180_000), 'last seen 3 minutes ago');
});

test('last seen uses hours, days, months and years at their boundaries', () => {
  for (const [minutes, expected] of [
    [59, '59 minutes'], [60, '1 hour'], [450, '7 hours'], [24 * 60 - 1, '23 hours'],
    [24 * 60, '1 day'], [2 * 24 * 60, '2 days'], [30 * 24 * 60, '1 month'],
    [60 * 24 * 60, '2 months'], [365 * 24 * 60, '1 year'], [730 * 24 * 60, '2 years'],
  ] as const) assert.equal(lastSeenLabel(0, minutes * 60_000), `last seen ${expected} ago`);
  assert.equal(lastSeenLabel(1000, 0), 'last seen less than a minute ago');
});

test('public HTTP URLs are rejected except localhost', () => {
  assert.throws(() => new Api('http://public.example', async () => 'x'), /HTTPS/);
  assert.doesNotThrow(() => new Api('http://localhost:3000', async () => 'x'));
});

test('aborted startup reports a readable retry message', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
  try { await assert.rejects(Api.config('https://example.test'), /HomePing took too long to respond/); }
  finally { globalThis.fetch = original; }
});

test('startup handles a sleeping-server HTML response without a JSON parsing error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>Starting service</html>', { status: 503 });
  try { await assert.rejects(Api.config('https://example.test'), /HomePing is starting or temporarily unavailable/); }
  finally { globalThis.fetch = original; }
});


test('automatic joining waits for acceptance and foreground, and launches each call once', () => {
  const gate = new AutoJoinGate();
  assert.equal(gate.claim('one', 'ringing', true), false);
  assert.equal(gate.claim('one', 'accepted', false), false);
  assert.equal(gate.claim('one', 'accepted', true), true);
  assert.equal(gate.claim('one', 'accepted', true), false);
  assert.equal(gate.claim('one', 'cancelled', true), false);
  assert.equal(gate.claim('two', 'accepted', true), true);
  gate.retry('one');
  assert.equal(gate.claim('one', 'accepted', true), true);
});


test('video data saver switches at 15 minutes of accepted call time', () => {
  assert.equal(videoProfile(1000, 900999).height, 720);
  assert.equal(videoProfile(1000, 901000).height, 480);
  assert.equal(videoProfile(1000, 1800000).height, 480);
  assert.equal(videoProfile(undefined, 1800000).height, 720);
  assert.equal(videoProfile(2000, 1000).height, 720);
});
