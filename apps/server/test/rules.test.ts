import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

test('rules allow only a verified human owner to read devices', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const [host, portText] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-homeping-rules',
    firestore: { host, port: Number(portText), rules: await readFile(new URL('../../../firestore.rules', import.meta.url), 'utf8') },
  });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/owner/devices/tv1').set({ type: 'tv', name: 'TV' });
    });
    const owner = env.authenticatedContext('owner', { email_verified: true }).firestore();
    const other = env.authenticatedContext('other', { email_verified: true }).firestore();
    const tv = env.authenticatedContext('tv:tv1', { role: 'tv', ownerUid: 'owner', deviceId: 'tv1' }).firestore();
    await assertSucceeds(owner.doc('users/owner/devices/tv1').get());
    await assertFails(other.doc('users/owner/devices/tv1').get());
    await assertFails(tv.collection('users/owner/devices').get());
    await assertFails(owner.doc('users/owner/devices/tv1').update({ name: 'Changed' }));
  } finally { await env.cleanup(); }
});
