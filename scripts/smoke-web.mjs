import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const preview = spawn(
  process.execPath,
  [
    resolve('node_modules/vite/bin/vite.js'),
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort',
  ],
  { cwd: resolve('apps/web'), stdio: 'pipe' },
);
let browser;
try {
  let available = false;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4173')).ok) {
        available = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(available, 'Vite preview did not start');
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1050 },
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let paired = false,
    call = null;
  await page.route('https://identitytoolkit.googleapis.com/**', (route) =>
    route.fulfill({
      json: {
        idToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresIn: '3600',
      },
    }),
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/config')
      return route.fulfill({ json: { apiKey: 'test', projectId: 'test' } });
    if (path === '/api/devices')
      return route.fulfill({
        json: paired ? [{ tvId: 'tv', name: 'Living room' }] : [],
      });
    if (path === '/api/pair') {
      paired = true;
      return route.fulfill({ json: { tvId: 'tv', name: 'Living room' } });
    }
    if (path === '/api/calls') {
      call = {
        id: 'call-1',
        tvId: 'tv',
        callerId: 'caller',
        status: 'ringing',
        createdAt: Date.now(),
        expiresAt: Date.now() + 30000,
        updatedAt: Date.now(),
        delivery: 'submitted',
      };
      return route.fulfill({ json: call });
    }
    if (path.endsWith('/action')) {
      call = { ...call, status: 'cancelled' };
      return route.fulfill({ json: call });
    }
    if (path === '/api/calls/call-1') return route.fulfill({ json: call });
    return route.fulfill({ status: 404, json: { error: 'Unknown mock path' } });
  });
  await page.goto('http://127.0.0.1:4173');
  await page.getByText('Caller connected', { exact: true }).waitFor();
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Pair TV', exact: true }).click();
  await page.getByRole('heading', { name: 'Living room' }).waitFor();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/web-caller.png', fullPage: true });
  await page.getByRole('button', { name: 'Call TV' }).click();
  await page.getByText('Calling your TV…', { exact: true }).waitFor();
  await page.getByText(/FCM submitted · waiting for TV/).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Call TV' }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: 'Cancel invitation' }).click();
  await page.getByText('Invitation cancelled', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'artifacts/web-caller-mobile.png',
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    'Mobile layout overflow',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: browser pairing, calling, delivery status, cancel, responsive layout (mock API; no live FCM).',
  );
} finally {
  await browser?.close();
  preview.kill();
}
