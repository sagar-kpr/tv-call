import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView, ScrollView, Text, TextInput, Pressable, StyleSheet, View, Alert, NativeModules, ActivityIndicator, Modal, AppState, Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApps } from 'firebase/app';
import {
  createUserWithEmailAndPassword, getAuth, initializeAuth, GoogleAuthProvider,
  onAuthStateChanged, reload, sendEmailVerification, sendPasswordResetEmail,
  signInWithCredential, signInWithEmailAndPassword, signOut, type Auth, type User, type Persistence,
} from 'firebase/auth';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import {
  Api, AutoJoinGate, emptyDeviceMessage, isTerminal, lastSeenLabel,
  type Call, type PublicConfig, type TvDevice,
} from '@homeping/client';
WebBrowser.maybeCompleteAuthSession();
// Metro selects Firebase Auth's React Native entry point at runtime. Its
// conditional export includes this helper even though the generic TS entry does not.
const getReactNativePersistence = (require('firebase/auth') as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
}).getReactNativePersistence;
const homepingServer = String(NativeModules.HomePingMode?.backendUrl ?? '');

function Button({ title, onPress, disabled = false, danger = false }: {
  title: string; onPress: () => void; disabled?: boolean; danger?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.button, danger && styles.danger, disabled && { opacity: .4 }]}>
    <Text style={[styles.buttonText, danger && { color: '#8c332d' }]}>{title}</Text>
  </Pressable>;
}

function BusyOverlay({ visible, label }: { visible: boolean; label: string }) {
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
    <View style={styles.busyBackdrop}><View accessibilityRole="progressbar" accessibilityLabel={label} style={styles.busyCard}>
      <ActivityIndicator color="#244e3a" size="small" /><Text style={styles.busyLabel}>{label}</Text>
    </View></View>
  </Modal>;
}

function Login({ auth, config, setError }: { auth: Auth; config: PublicConfig; setError: (v: string) => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin'|'signup'|'forgot'>('signin'), [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <View style={styles.card}>
    <BusyOverlay visible={busy} label={mode === 'forgot' ? 'Sending reset email…' : mode === 'signup' ? 'Creating your account…' : 'Signing in…'} />
    <Text style={styles.heading}>{mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Reset password' : 'Sign in'}</Text>
    <Text style={styles.muted}>Use the same verified HomePing account as your TV.</Text>
    <TextInput accessibilityLabel="Email" style={styles.input} placeholder="Email" value={email} onChangeText={setEmail}
      autoCapitalize="none" keyboardType="email-address" />
    {mode !== 'forgot' && <TextInput accessibilityLabel="Password" style={styles.input} placeholder="Password" value={password}
      onChangeText={setPassword} secureTextEntry />}
    <Button disabled={busy || !email || (mode !== 'forgot' && password.length < 6)}
      title={mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset email' : 'Sign in'}
      onPress={() => void run(async () => {
        if (mode === 'signup') {
          const result = await createUserWithEmailAndPassword(auth, email, password);
          await sendEmailVerification(result.user);
        } else if (mode === 'forgot') {
          await sendPasswordResetEmail(auth, email); setError('Password reset email sent.');
        } else await signInWithEmailAndPassword(auth, email, password);
      })} />
    {mode !== 'forgot' && !!config.googleAndroidClientId && <GoogleLogin auth={auth} config={config} busy={busy} run={run} />}
    <Pressable onPress={() => setMode(mode === 'signup' ? 'signin' : 'signup')}><Text style={styles.link}>{mode === 'signup' ? 'Already have an account?' : 'Create account'}</Text></Pressable>
    <Pressable onPress={() => setMode(mode === 'forgot' ? 'signin' : 'forgot')}><Text style={styles.link}>{mode === 'forgot' ? 'Back to sign in' : 'Forgot password?'}</Text></Pressable>
  </View>;
}

// Mount Google's request hook only when OAuth is configured, so email login
// remains usable on a new installation without Google client IDs.
function GoogleLogin({ auth, config, busy, run }: {
  auth: Auth; config: PublicConfig; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: config.googleAndroidClientId,
    webClientId: config.googleWebClientId,
  });
  useEffect(() => {
    if (response?.type === 'success' && response.params.id_token)
      void run(() => signInWithCredential(auth, GoogleAuthProvider.credential(response.params.id_token)));
  }, [response]);
  return <Button disabled={busy || !request} title="Continue with Google"
    onPress={() => void run(() => promptAsync())} />;
}

function Verification({ user, setError, onVerified }: { user: User; setError: (v: string) => void; onVerified: () => void }) {
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <View style={styles.card}><BusyOverlay visible={busy} label="Checking your account…" /><Text style={styles.heading}>Verify your email</Text>
    <Text style={styles.muted}>Open the verification link sent to {user.email}, then continue.</Text>
    <Button disabled={busy} title="I verified my email" onPress={() => void run(async () => {
      await reload(user);
      if (!user.emailVerified) throw new Error('Email is not verified yet.');
      await user.getIdToken(true); onVerified();
    })} />
    <Button disabled={busy} title="Resend verification email" onPress={() => void run(() => sendEmailVerification(user))} />
    <Pressable onPress={() => void signOut(getAuth())}><Text style={styles.link}>Use another account</Text></Pressable>
  </View>;
}

function Caller({ api, backend, user, setError }: { api: Api; backend: string; user: User; setError: (v: string) => void }) {
  const [devices, setDevices] = useState<TvDevice[]>([]), [call, setCall] = useState<Call | null>(null);
  const [busy, setBusy] = useState(false), [settings, setSettings] = useState(false), [clock, setClock] = useState(Date.now());
  const [loadingDevices, setLoadingDevices] = useState(true), [joinError, setJoinError] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const gate = useRef(new AutoJoinGate());
  const load = async () => setDevices(await api.devices());
  useEffect(() => { void api.account().then(load).catch(e => setError(e.message)).finally(() => setLoadingDevices(false)); }, []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!call || !gate.current.claim(call.id, call.status, foreground)) return;
    let disposed = false;
    setJoinError(false);
    void (async () => {
      try {
        if (!NativeModules.HomePingMode?.startCall) throw new Error('Install the updated HomePing APK to use video calls.');
        const token = await user.getIdToken();
        if (disposed || AppState.currentState !== 'active') { gate.current.retry(call.id); return; }
        await NativeModules.HomePingMode.startCall(call.id, token, user.refreshToken, getAuth().app.options.apiKey);
      } catch (error) {
        if (!disposed) { setJoinError(true); setError((error as Error).message); }
      }
    })();
    return () => { disposed = true; };
  }, [call?.id, call?.status, foreground, user]);
  useEffect(() => {
    if (!call || isTerminal(call.status)) return;
    const timer = setInterval(() => {
      setClock(Date.now());
      void api.getCall(call.id).then(setCall).catch(e => setError(e.message));
    }, 1000);
    return () => clearInterval(timer);
  }, [call?.id, call?.status]);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <View style={styles.card}>
    <BusyOverlay visible={busy} label="Please wait…" />
    {loadingDevices && <View style={styles.loadingRow}><ActivityIndicator color="#244e3a" /><Text style={styles.muted}>Finding your TVs…</Text></View>}
    <View style={styles.row}><Text style={styles.heading}>{settings ? 'Paired TVs' : 'Your TVs'}</Text>
      <Pressable onPress={() => setSettings(!settings)}><Text style={styles.link}>{settings ? 'Done' : 'Settings'}</Text></Pressable></View>
    <Pressable disabled={busy} onPress={() => void run(load)}>
      <Text style={styles.link}>Refresh TVs</Text>
    </Pressable>
    {!loadingDevices && emptyDeviceMessage(devices) && <View style={styles.device}><Text style={styles.deviceTitle}>No TV detected</Text>
      <Text style={styles.muted}>Open HomePing on your TV. Scan its QR code or open the backend URL in a browser to approve it.</Text>
      <Button title="Open TV approval website" onPress={() => void WebBrowser.openBrowserAsync(backend)} /></View>}
    {devices.map(device => <View style={styles.device} key={device.deviceId}>
      <Text style={styles.deviceTitle}>{device.name}</Text>
      <Text style={styles.muted}>{device.manufacturer} {device.model}{device.room ? ` · ${device.room}` : ''}{'\n'}{lastSeenLabel(device.lastSeen, clock)}</Text>
      {settings ? <Button danger title="Remove TV" disabled={busy} onPress={() => Alert.alert('Remove TV?', 'The TV must be authorized again.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void run(async () => { await api.removeDevice(device.deviceId); await load(); }) },
      ])} /> : <Button title="Call" disabled={busy || (!!call && !isTerminal(call.status))}
        onPress={() => void run(async () => setCall(await api.call(device.deviceId)))} />}
    </View>)}
    {call && <View style={styles.state}><Text style={styles.deviceTitle}>{({
      ringing: 'Ringing', accepted: 'Accepted', declined: 'Declined', missed: 'Missed',
      busy: 'Busy', cancelled: 'Cancelled', ended: 'Call ended', failed: 'Delivery failed',
    } as Record<string,string>)[call.status]}</Text>
      {call.status === 'ringing' && <><Text style={styles.muted}>{call.receivedAt ? 'TV received the invitation' : 'Waiting for TV'} · {Math.max(0, Math.ceil((call.expiresAt - clock) / 1000))}s</Text>
        <Button title="Cancel" disabled={busy} onPress={() => void run(async () => setCall(await api.cancel(call.id)))} /></>}
      {call.status === 'accepted' && <>
      {!joinError ? <View style={styles.loadingRow}><ActivityIndicator color="#244e3a" /><Text style={styles.muted}>Opening your call…</Text></View> :
        <Button title="Retry connection" onPress={() => { gate.current.retry(call.id); setForeground(false); setTimeout(() => setForeground(AppState.currentState === 'active'), 0); }} />}
      <Button danger title="End call" disabled={busy} onPress={() => void run(async () => setCall(await api.end(call.id)))} /></>}
    </View>}
    <Pressable onPress={() => void signOut(getAuth())}><Text style={styles.link}>Sign out {user.email}</Text></Pressable>
  </View>;
}

export default function App() {
  const backend = homepingServer;
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null), [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [, setAuthRevision] = useState(0);
  useEffect(() => { void connect(); }, []);
  async function connect() {
    setBusy(true); setError('');
    try {
      if (!backend) throw new Error('HomePing is not available in this build yet.');
      const cfg = await Api.config(backend);
      const app = getApps()[0] ?? initializeApp({ apiKey: cfg.apiKey, projectId: cfg.projectId, appId: cfg.androidAppId, messagingSenderId: cfg.messagingSenderId, authDomain: cfg.authDomain });
      let firebaseAuth: Auth;
      try { firebaseAuth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) }); }
      catch { firebaseAuth = getAuth(app); }
      setConfig(cfg); setAuth(firebaseAuth);
      onAuthStateChanged(firebaseAuth, value => { setUser(value); setLoaded(true); });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const api = useMemo(() => user ? new Api(backend, force => user.getIdToken(!!force)) : null, [backend, user]);
  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Pressable accessibilityLabel="HomePing. Long press for device mode settings."
      style={styles.brandRow} onLongPress={() => NativeModules.HomePingMode?.openSettings()}>
      <Image source={require('./assets/homeping-icon.png')} style={{ width: 36, height: 36, borderRadius: 10 }} />
      <Text style={styles.brand}>HomePing</Text>
    </Pressable><Text style={styles.eyebrow}>A LITTLE CLOSER TO HOME</Text>
    <Text style={styles.title}>Your living room.{ '\n' }One call away.</Text>
    {!config || !auth ? <View style={styles.card}>{busy && <ActivityIndicator color="#244e3a" style={{ marginBottom: 14 }} />}<Text style={styles.heading}>{busy ? 'Opening HomePing…' : 'HomePing unavailable'}</Text>
      <Text style={styles.muted}>{busy ? 'The server may take a minute to wake up.' : 'Please check your connection and try again.'}</Text>
      {!busy && <Button title="Try again" onPress={() => void connect()} />}</View> :
      !loaded ? <Text>Loading…</Text> : !user ? <Login auth={auth} config={config} setError={setError} /> :
      !user.emailVerified ? <Verification user={user} setError={setError} onVerified={() => setAuthRevision(value => value + 1)} /> :
      <Caller api={api!} backend={config.webUrl ?? backend} user={user} setError={setError} />}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  busyBackdrop: { flex: 1, backgroundColor: 'rgba(12,30,22,.28)', alignItems: 'center', justifyContent: 'center' },
  busyCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 24, maxWidth: '85%', elevation: 12 },
  busyLabel: { color: '#18352d', fontSize: 16, marginLeft: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  root: { flex: 1, backgroundColor: '#f6f5ef' }, page: { padding: 24, paddingBottom: 60 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 48 },
  brand: { color: '#18352d', fontSize: 24, fontWeight: '800' },
  eyebrow: { color: '#5b7563', letterSpacing: 2, fontSize: 11, textAlign: 'center' },
  title: { color: '#18352d', fontSize: 39, lineHeight: 46, fontWeight: '700', textAlign: 'center', marginVertical: 18 },
  card: { backgroundColor: 'white', borderColor: '#e1e6db', borderWidth: 1, borderRadius: 22, padding: 22, marginTop: 26 },
  heading: { color: '#18352d', fontSize: 23, fontWeight: '700' }, muted: { color: '#69776c', lineHeight: 21, marginVertical: 8 },
  input: { borderColor: '#dce3d7', borderWidth: 1, borderRadius: 10, padding: 13, marginTop: 12, color: '#18352d' },
  button: { backgroundColor: '#244e3a', borderRadius: 11, padding: 15, marginTop: 12 },
  buttonText: { color: 'white', textAlign: 'center', fontWeight: '700' }, danger: { backgroundColor: '#fff0ec', borderColor: '#e7b9b4', borderWidth: 1 },
  link: { color: '#31523e', textDecorationLine: 'underline', marginTop: 16 }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  device: { borderTopColor: '#edf0e9', borderTopWidth: 1, marginTop: 18, paddingTop: 18 }, deviceTitle: { color: '#18352d', fontSize: 18, fontWeight: '700' },
  state: { backgroundColor: '#f0f5eb', borderRadius: 12, padding: 16, marginTop: 18 }, error: { color: '#8c332d', backgroundColor: '#fff0ec', padding: 14, borderRadius: 10, marginTop: 16 },
});
