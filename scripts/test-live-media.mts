// Opt-in integration: uses the configured LiveKit project for two brief test
// participants, fake browser capture, and the real backend/token/UI code.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { Media, mediaConfig } from '../apps/server/src/media.js';
import { Calls, type HumanPrincipal, type TvPrincipal } from '../apps/server/src/service.js';
import { MemoryStore } from '../apps/server/src/store.js';
import { appFor } from '../apps/server/src/http.js';

if (process.env.HOMEPING_LIVE_MEDIA_TEST !== '1') throw new Error('Set HOMEPING_LIVE_MEDIA_TEST=1 to run against your LiveKit project.');
const config = mediaConfig();
assert.ok(config, 'Configure LiveKit in local .env');
const directory = await mkdtemp(join(tmpdir(), 'homeping-media-'));
const media = new Media(config);
const service = new Calls(new MemoryStore(), { send: async () => {} }, {
  customToken: async () => 'test', revoke: async () => {}, deleteUser: async () => {},
}, Date.now, undefined, id => media.close(id));
const owner: HumanPrincipal = { kind: 'human', uid: 'integration-test', email: 'integration@example.test' };
const deviceId = '33333333-3333-4333-8333-333333333333';
const tv: TvPrincipal = { kind: 'tv', uid: `tv:${deviceId}`, ownerUid: owner.uid, deviceId };
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<ReturnType<typeof appFor>['listen']> | undefined;
let callId: string | undefined;
try {
  const auth = await service.beginAuthorization({
    deviceId, manufacturer: 'Test', model: 'Browser surrogate', androidVersion: '12', apiLevel: 31,
    screenWidthPx: 640, screenHeightPx: 360, firmwareFingerprint: 'test', builtInCameraAvailable: true,
    usbHostSupported: true, usbCameraAttached: false, cameraApiCount: 1, fcmToken: 'test-token-1234567890',
  }, 'test-secret'.repeat(8));
  await service.approveAuthorization(owner.uid, auth.code);
  const call = await service.create(owner.uid, deviceId); callId = call.id;
  await service.action(tv, call.id, 'accept');
  await build({ entryPoints: [resolve('scripts/fixtures/media-web.tsx')], bundle: true,
    outfile: join(directory, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  await writeFile(join(directory, 'index.html'), '<!doctype html><div id="root"></div><script src="/app.js"></script>');
  const app = appFor(service, async token => {
    if (token === 'caller') return owner;
    if (token === 'tv') return tv;
    throw new Error('invalid test token');
  }, { apiKey: 'test', projectId: 'test', androidAppId: 'test', messagingSenderId: '1' }, directory, media);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const callerPage = await browser.newPage(), tvPage = await browser.newPage();
  for (const [page, role] of [[callerPage, 'caller'], [tvPage, 'tv']] as const) {
    await page.goto(`${origin}/?id=${call.id}&role=${role}`);
    await page.getByRole('button', { name: 'Join video call', exact: true }).click();
  }
  const frames = async (page: Page) => {
    await page.waitForFunction(() => {
      const video = document.querySelector('.remote-media video') as HTMLVideoElement | null;
      return video && video.videoWidth > 0 && video.getVideoPlaybackQuality().totalVideoFrames > 10;
    }, undefined, { timeout: 45_000 });
    await page.waitForFunction(() => {
      const audio = document.querySelector('.remote-media audio') as HTMLAudioElement | null;
      return audio && audio.currentTime > 0.5 && !audio.paused;
    }, undefined, { timeout: 15_000 });
  };
  await Promise.all([frames(callerPage), frames(tvPage)]);
  await callerPage.getByRole('button', { name: 'Mute', exact: true }).click();
  await callerPage.getByRole('button', { name: 'Enable microphone', exact: true }).waitFor();
  await callerPage.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await callerPage.getByRole('button', { name: 'Camera off', exact: true }).click();
  await callerPage.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await frames(tvPage);
  await callerPage.getByRole('button', { name: 'End call', exact: true }).click();
  await tvPage.getByText('Call ended', { exact: true }).waitFor({ timeout: 15_000 });
  assert.equal((await service.get(owner, call.id)).status, 'ended');
  console.log('PASS: real LiveKit room; both browsers receive video frames and audio; mute/camera toggles; End propagates. TV hardware is not tested.');
} finally {
  await browser?.close();
  if (callId) await media.close(callId).catch(() => {});
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
