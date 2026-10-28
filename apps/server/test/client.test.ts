import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../../../packages/client/src/index.js';
test('caller authenticates, preserves identity, refreshes tokens and surfaces API errors', async () => {
  const original = globalThis.fetch;
  const values = new Map<string, string>();
  const requests: Array<{ url: string; auth: string | null }> = [];
  const storage = {
    getItem: async (k: string) => values.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      values.set(k, v);
    },
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      auth: new Headers(init?.headers).get('Authorization'),
    });
    if (url.endsWith('/api/config'))
      return Response.json({ apiKey: 'key', projectId: 'test' });
    if (url.includes('accounts:signUp'))
      return Response.json({
        idToken: 'first',
        refreshToken: 'refresh',
        expiresIn: '3600',
      });
    if (url.includes('securetoken'))
      return Response.json({
        id_token: 'renewed',
        refresh_token: 'refresh',
        expires_in: '3600',
      });
    if (url.endsWith('/api/devices'))
      return Response.json([{ tvId: 'tv', name: 'Test' }]);
    return Response.json(
      { error: 'TV already has an active invitation or call' },
      { status: 409 },
    );
  };
  try {
    assert.throws(() => new Api('http://public.example', storage), /HTTPS/);
    const api = new Api('https://example.test', storage);
    await api.init();
    assert.equal((await api.devices())[0].tvId, 'tv');
    assert.equal(requests.at(-1)?.auth, 'Bearer first');
    const session = JSON.parse(values.get('session:https://example.test')!);
    session.expiresAt = 0;
    values.set('session:https://example.test', JSON.stringify(session));
    const reconnect = new Api('https://example.test', storage);
    await reconnect.init();
    await reconnect.devices();
    assert.equal(requests.at(-1)?.auth, 'Bearer renewed');
    assert.equal(
      requests.filter((r) => r.url.includes('accounts:signUp')).length,
      1,
    );
    await assert.rejects(reconnect.call('tv'), /active invitation/);
  } finally {
    globalThis.fetch = original;
  }
});
