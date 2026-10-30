import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { Calls } from './service.js';
import { FirestoreStore } from './store.js';
import { appFor } from './http.js';

export function createServer(webDirectory?: string) {
  const setting = (name: string) => process.env[name];
  const required = (name: string) => {
    const value = setting(name);
    if (!value) throw new Error(`Missing ${name}; configure HomePing server settings`);
    return value;
  };
  const config = {
    projectId: required('FIREBASE_PROJECT_ID'),
    apiKey: required('FIREBASE_API_KEY'),
    androidAppId: required('FIREBASE_ANDROID_APP_ID'),
    messagingSenderId: required('FIREBASE_MESSAGING_SENDER_ID'),
    authDomain: setting('FIREBASE_AUTH_DOMAIN') ?? `${required('FIREBASE_PROJECT_ID')}.firebaseapp.com`,
    googleWebClientId: setting('GOOGLE_WEB_CLIENT_ID'),
    googleAndroidClientId: setting('GOOGLE_ANDROID_CLIENT_ID'),
    webUrl: setting('WEB_URL'),
  };
  if (getApps().length === 0)
    initializeApp({ credential: applicationDefault(), projectId: config.projectId });
  const auth = getAuth();
  const calls = new Calls(
    new FirestoreStore(getFirestore()),
    { send: async (token, data, ttl) => {
      await getMessaging().send({ token, data, android: { priority: 'high', ttl } });
    } },
    {
      customToken: (uid, claims) => auth.createCustomToken(uid, claims),
      revoke: (uid) => auth.revokeRefreshTokens(uid),
      deleteUser: (uid) => auth.deleteUser(uid),
    },
  );
  return appFor(calls, async (token) => {
    const decoded = await auth.verifyIdToken(token, true);
    if (decoded.role === 'tv') {
      if (typeof decoded.ownerUid !== 'string' || typeof decoded.deviceId !== 'string')
        throw new Error('Invalid TV claims');
      return { kind: 'tv' as const, uid: decoded.uid, ownerUid: decoded.ownerUid, deviceId: decoded.deviceId };
    }
    if (decoded.email_verified !== true || typeof decoded.email !== 'string')
      throw new Error('Verified email required');
    return { kind: 'human' as const, uid: decoded.uid, email: decoded.email };
  }, config, webDirectory);
}
