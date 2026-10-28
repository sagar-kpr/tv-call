import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Calls } from '../src/service.js';
import { FirestoreStore } from '../src/store.js';
import { randomUUID } from 'node:crypto';
test(
  'Firestore adapter: concurrent calls, restart persistence, receipt and expiry',
  { skip: !process.env.FIRESTORE_EMULATOR_HOST },
  async () => {
    const app = initializeApp(
      { projectId: 'demo-homeping' },
      `test-${randomUUID()}`,
    );
    const db = getFirestore(app);
    const suffix = randomUUID();
    const tv = `tv-${suffix}`,
      caller = `caller-${suffix}`;
    let now = Date.now();
    const push = { send: async () => {} };
    const store = new FirestoreStore(db);
    const service = new Calls(store, push, () => now);
    try {
      await service.register(tv, 'Emulator TV', 'test-token-1234567890', {});
      const code = await service.pairing(tv);
      await service.pair(caller, code.code);
      const results = await Promise.allSettled([
        service.create(caller, tv),
        service.create(caller, tv),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const call = (
        results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
          Awaited<ReturnType<Calls['create']>>
        >
      ).value;
      await service.action(tv, call.id, 'receive');
      const restarted = new Calls(new FirestoreStore(db), push, () => now);
      assert.ok((await restarted.get(caller, call.id)).receivedAt);
      now += 30001;
      await assert.rejects(restarted.action(tv, call.id, 'accept'), {
        status: 409,
      });
      assert.equal((await restarted.get(caller, call.id)).status, 'expired');
      assert.equal(await restarted.active(tv), null);
      const next = await restarted.create(caller, tv);
      await restarted.action(tv, next.id, 'accept');
      assert.equal((await restarted.active(tv))?.id, next.id);
      await restarted.action(tv, next.id, 'end');
      assert.equal(await restarted.active(tv), null);
    } finally {
      await db.terminate();
      await deleteApp(app);
    }
  },
);
