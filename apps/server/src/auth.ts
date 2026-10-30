import type { DecodedIdToken } from 'firebase-admin/auth';
import { Fault, type Principal } from './service.js';

export function principalFromToken(decoded: DecodedIdToken): Principal {
  if (decoded.role === 'tv') {
    if (typeof decoded.ownerUid !== 'string' || typeof decoded.deviceId !== 'string')
      throw new Fault(401, 'Invalid TV authentication', 'INVALID_AUTH_TOKEN');
    return { kind: 'tv', uid: decoded.uid, ownerUid: decoded.ownerUid, deviceId: decoded.deviceId };
  }
  if (decoded.email_verified !== true || typeof decoded.email !== 'string')
    throw new Fault(403, 'Verify your email before using HomePing.', 'EMAIL_NOT_VERIFIED');
  return { kind: 'human', uid: decoded.uid, email: decoded.email };
}

export function authenticationFault(error: unknown): Fault {
  if (error instanceof Fault) return error;
  const code = (error as { code?: string })?.code;
  if ([
    'auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token',
    'auth/argument-error', 'auth/user-disabled', 'auth/user-not-found',
  ].includes(code ?? '')) {
    return new Fault(401, 'Your session has expired. Please sign in again.', 'INVALID_AUTH_TOKEN');
  }
  // Never turn missing credentials, IAM failures, or network errors into a
  // claim that a valid user's token is wrong. Log only the code, never the token.
  console.error('Firebase Admin authentication unavailable', code ?? 'unknown-error');
  return new Fault(503, 'HomePing cannot verify sign-in right now. Please try again.', 'AUTH_SERVICE_UNAVAILABLE');
}
