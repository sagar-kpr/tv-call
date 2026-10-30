import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api, emptyDeviceMessage, lastSeenLabel } from '../../../packages/client/src/index.js';

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
