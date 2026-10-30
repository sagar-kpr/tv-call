import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const appConfig = require('../../mobile/app.config.js') as
  (input: { config: Record<string, unknown> }) => { extra: Record<string, unknown> };

test('APK embeds only the public server URL and normalizes its trailing slash', () => {
  const previous = process.env.HOMEPING_BACKEND_URL;
  process.env.HOMEPING_BACKEND_URL = 'https://homeping.example/';
  try {
    assert.deepEqual(appConfig({ config: {} }).extra, {
      homepingBackendUrl: 'https://homeping.example',
    });
  } finally {
    if (previous === undefined) delete process.env.HOMEPING_BACKEND_URL;
    else process.env.HOMEPING_BACKEND_URL = previous;
  }
});

test('APK server configuration rejects insecure URLs and embedded credentials', () => {
  const previous = process.env.HOMEPING_BACKEND_URL;
  try {
    for (const url of ['http://example.test', 'https://user:password@example.test', 'https://example.test?secret=1', 'https://example.test/#fragment']) {
      process.env.HOMEPING_BACKEND_URL = url;
      assert.throws(() => appConfig({ config: {} }), /public HTTPS URL/);
    }
  } finally {
    if (previous === undefined) delete process.env.HOMEPING_BACKEND_URL;
    else process.env.HOMEPING_BACKEND_URL = previous;
  }
});
