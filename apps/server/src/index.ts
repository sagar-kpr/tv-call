import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { resolve } from 'node:path';
import { Calls } from './service.js';
import { FirestoreStore } from './store.js';
import { appFor } from './http.js';
const required = (name: string) => {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Missing ${name}; copy .env.example to .env and configure Firebase`,
    );
  return value;
};
const config = {
  projectId: required('FIREBASE_PROJECT_ID'),
  apiKey: required('FIREBASE_API_KEY'),
  androidAppId: required('FIREBASE_ANDROID_APP_ID'),
  messagingSenderId: required('FIREBASE_MESSAGING_SENDER_ID'),
};
initializeApp({
  credential: applicationDefault(),
  projectId: config.projectId,
});
const calls = new Calls(new FirestoreStore(getFirestore()), {
  send: async (token, data, ttl) => {
    await getMessaging().send({
      token,
      data,
      android: { priority: 'high', ttl },
    });
  },
});
const app = appFor(
  calls,
  async (token) => (await getAuth().verifyIdToken(token, true)).uid,
  config,
  resolve('../web/dist'),
);
const port = Number(process.env.PORT ?? 3000);
app.listen(port, '127.0.0.1', () =>
  console.log(`HomePing backend and web caller: http://localhost:${port}`),
);
