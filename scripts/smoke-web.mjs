import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const preview = spawn(process.execPath, [
  resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1',
  '--port', '4173', '--strictPort',
], { cwd: resolve('apps/web'), stdio: 'pipe' });
let browser;
const jwt = [
  Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({
    aud: 'test', iss: 'https://securetoken.google.com/test', sub: 'owner',
    user_id: 'owner', email: 'owner@example.test', email_verified: true,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
    auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' },
  })).toString('base64url'),
  'signature',
].join('.');
try {
  let available = false;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch('http://127.0.0.1:4173')).ok) { available = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(available, 'Vite preview did not start');
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1050 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let call = null;
  let failNextCall = false;
  await page.route('https://identitytoolkit.googleapis.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('signInWithPassword')) return route.fulfill({ json: {
      idToken: jwt, refreshToken: 'refresh', expiresIn: '3600',
      localId: 'owner', email: 'owner@example.test', registered: true,
    }});
    if (path.includes('lookup')) return route.fulfill({ json: { users: [{
      localId: 'owner', email: 'owner@example.test', emailVerified: true,
      providerUserInfo: [], createdAt: '1', lastLoginAt: '1',
    }] }});
    return route.fulfill({ status: 400, json: { error: { message: 'UNEXPECTED_AUTH_REQUEST' } } });
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/config') return route.fulfill({ json: {
      apiKey: 'test', projectId: 'test', androidAppId: 'test-app',
      messagingSenderId: '1', authDomain: 'test.firebaseapp.com',
    }});
    if (path === '/api/account') return route.fulfill({ json: { uid: 'owner', email: 'owner@example.test' } });
    if (path === '/api/devices') return route.fulfill({ json: [{
      deviceId: '11111111-1111-4111-8111-111111111111', type: 'tv',
      name: 'Living room', room: 'Living room', manufacturer: 'Hisense',
      model: 'Test TV', androidVersion: '12', apiLevel: 31,
      screenWidthPx: 1920, screenHeightPx: 1080, firmwareFingerprint: 'test',
      builtInCameraAvailable: false, usbHostSupported: true,
      usbCameraAttached: false, cameraApiCount: 0, doNotDisturb: false,
      lastSeen: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    }] });
    if (path.endsWith('/calls') && route.request().method() === 'POST') {
      await new Promise(resolve => setTimeout(resolve, 350));
      if (failNextCall) return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
      call = {
        id: 'call-1', deviceId: '11111111-1111-4111-8111-111111111111',
        ownerUid: 'owner', callerUid: 'owner', status: 'ringing',
        createdAt: Date.now(), expiresAt: Date.now() + 30_000,
        updatedAt: Date.now(), delivery: 'submitted',
      };
      return route.fulfill({ json: call });
    }
    if (path.endsWith('/action')) {
      call = { ...call, status: 'cancelled' }; return route.fulfill({ json: call });
    }
    if (path === '/api/calls/call-1') return route.fulfill({ json: call });
    return route.fulfill({ status: 404, json: { error: 'Unknown mock path' } });
  });
  await page.goto('http://127.0.0.1:4173');
  await page.getByLabel('Email').fill('owner@example.test');
  await page.getByLabel('Password').fill('password1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText('Living room', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Call', exact: true }).click();
  await page.getByText('Please wait…', { exact: true }).waitFor();
  await page.getByText('Ringing', { exact: true }).waitFor();
  assert.equal(await page.locator('.busy-backdrop').count(), 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Cancelled', { exact: true }).waitFor();
  failNextCall = true;
  await page.getByRole('button', { name: 'Call', exact: true }).click();
  await page.getByText('Please wait…', { exact: true }).waitFor();
  await page.getByText('Temporarily unavailable', { exact: true }).waitFor();
  assert.equal(await page.locator('.busy-backdrop').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS: verified account sign-in, TV list, call, cancel, loading card success/failure, and responsive layout (mock API).');
} finally {
  await browser?.close(); preview.kill();
}
