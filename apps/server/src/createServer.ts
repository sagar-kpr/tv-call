import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { readFileSync } from 'node:fs';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { Calls } from './service.js';
import { FirestoreStore } from './store.js';
import { appFor } from './http.js';
import { Media, mediaConfig } from './media.js';
import { principalFromToken } from './auth.js';

export function createServer(webDirectory?: string) {
  const setting = (name: string) => process.env[name];
  const required = (name: string) => {
    const value = setting(name);
    if (!value) throw new Error(`Missing ${name}; configure HomePing server settings`);
    return value;
  };
  const config = {
    ringSeconds: 60, autoAcceptSupported: true,
    projectId: required('FIREBASE_PROJECT_ID'),
    apiKey: required('FIREBASE_API_KEY'),
    androidAppId: required('FIREBASE_ANDROID_APP_ID'),
    messagingSenderId: required('FIREBASE_MESSAGING_SENDER_ID'),
    authDomain: setting('FIREBASE_AUTH_DOMAIN') ?? `${required('FIREBASE_PROJECT_ID')}.firebaseapp.com`,
    googleWebClientId: setting('GOOGLE_WEB_CLIENT_ID'),
    googleAndroidClientId: setting('GOOGLE_ANDROID_CLIENT_ID'),
    webUrl: setting('WEB_URL'),
  };
  if (getApps().length === 0) {
    const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (process.env.RENDER === 'true' && !file)
      throw new Error('Render requires GOOGLE_APPLICATION_CREDENTIALS pointing to the Firebase Admin secret file.');
    let credential;
    if (file) {
      let key;
      try { key = JSON.parse(readFileSync(file, 'utf8')); }
      catch { throw new Error('Cannot read Firebase Admin secret file. Check GOOGLE_APPLICATION_CREDENTIALS and Render Secret Files.'); }
      if (key.type !== 'service_account' || typeof key.private_key !== 'string' || typeof key.client_email !== 'string')
        throw new Error('Firebase Admin requires a service-account JSON, not google-services.json or a web config.');
      if (key.project_id !== config.projectId)
        throw new Error('The Firebase Admin secret file belongs to a different FIREBASE_PROJECT_ID.');
      credential = cert(key);
    } else credential = applicationDefault();
    initializeApp({ credential, projectId: config.projectId });
  }
  const auth = getAuth();
  const media = new Media(mediaConfig());
  Object.assign(config, { mediaEnabled: media.enabled });
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
    Date.now, undefined, id => media.close(id),
  );
  return appFor(calls, async (token) => {
    return principalFromToken(await auth.verifyIdToken(token, true));
  }, config, webDirectory, media);
}
