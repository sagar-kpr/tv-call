import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { principalFromToken, authenticationFault } from '../src/auth.js';

const token = (claims: object) => claims as DecodedIdToken;

test('verified human tokens become account principals', () => {
  assert.deepEqual(principalFromToken(token({
    uid: 'owner', email: 'owner@example.test', email_verified: true,
  })), { kind: 'human', uid: 'owner', email: 'owner@example.test' });
});

test('unverified email gets an actionable verification error', () => {
  assert.throws(() => principalFromToken(token({
    uid: 'owner', email: 'owner@example.test', email_verified: false,
  })), { status: 403, code: 'EMAIL_NOT_VERIFIED' });
});

test('TV session claims are required and do not need a human email', () => {
  assert.deepEqual(principalFromToken(token({
    uid: 'tv:one', role: 'tv', ownerUid: 'owner', deviceId: 'one',
  })), { kind: 'tv', uid: 'tv:one', ownerUid: 'owner', deviceId: 'one' });
  assert.throws(() => principalFromToken(token({ uid: 'tv:one', role: 'tv' })), { status: 401 });
});

test('credential and IAM errors are not misreported as expired user tokens', () => {
  for (const code of ['app/invalid-credential', 'auth/insufficient-permission']) {
    const result = authenticationFault({ code });
    assert.equal(result.status, 503);
    assert.equal(result.code, 'AUTH_SERVICE_UNAVAILABLE');
  }
  const expired = authenticationFault({ code: 'auth/id-token-expired' });
  assert.equal(expired.status, 401);
  assert.equal(expired.code, 'INVALID_AUTH_TOKEN');
});
