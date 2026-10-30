import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence, createUserWithEmailAndPassword, getAuth,
  GoogleAuthProvider, onAuthStateChanged, reload, sendEmailVerification,
  sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword,
  signInWithPopup, signOut, type User,
} from 'firebase/auth';
import {
  Api, emptyDeviceMessage, isTerminal, lastSeenLabel,
  type Call, type PublicConfig, type TvDevice,
} from '@homeping/client';
import './style.css';
const VideoCall = lazy(() => import('./VideoCall').then(module => ({ default: module.VideoCall })));

const backendUrl = (import.meta.env.VITE_HOMEPING_API_URL || location.origin).replace(/\/+$/, '');

function BusyOverlay({ visible, label = 'Please wait…' }: { visible: boolean; label?: string }) {
  if (!visible) return null;
  return <div className="busy-backdrop"><div className="busy-card" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />{label}</div></div>;
}

function AuthScreen({ config, onError }: { config: PublicConfig; onError: (value: string) => void }) {
  const auth = getAuth();
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); onError('');
    try { await action(); } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="card">
    <BusyOverlay visible={busy} label={mode === 'forgot' ? 'Sending reset email…' : mode === 'signup' ? 'Creating your account…' : 'Signing in…'} /><h2>{mode === 'signup' ? 'Create your HomePing account' : mode === 'forgot' ? 'Reset your password' : 'Sign in to HomePing'}</h2>
    <p className="muted">Use the same verified account on your phone, browser, and TV.</p>
    <label className="field">Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
    {mode !== 'forgot' && <label className="field">Password<input className="normal-input" type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>}
    <button className="primary" disabled={busy || !email || (mode !== 'forgot' && password.length < 6)} onClick={() => run(async () => {
      if (mode === 'signup') {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(result.user);
      } else if (mode === 'forgot') {
        await sendPasswordResetEmail(auth, email); onError('Password reset email sent.');
      } else await signInWithEmailAndPassword(auth, email, password);
    })}>{mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset email' : 'Sign in'}</button>
    {mode !== 'forgot' && <button className="secondary" disabled={busy} onClick={() => run(() => signInWithPopup(auth, new GoogleAuthProvider()))}>Continue with Google</button>}
    <div className="auth-links">
      <button className="link" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>{mode === 'signup' ? 'Already have an account?' : 'Create account'}</button>
      <button className="link" onClick={() => setMode(mode === 'forgot' ? 'signin' : 'forgot')}>{mode === 'forgot' ? 'Back to sign in' : 'Forgot password?'}</button>
    </div>
    {!config.googleWebClientId && <p className="muted">Google sign-in also requires the authorized domain and OAuth configuration described in the README.</p>}
  </section>;
}

function Verification({ user, onError }: { user: User; onError: (value: string) => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); onError('');
    try { await fn(); } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="card"><BusyOverlay visible={busy} label="Checking your account…" /><h2>Verify your email</h2>
    <p className="muted">We sent a verification link to <strong>{user.email}</strong>. Verify it before using HomePing.</p>
    <button className="primary" disabled={busy} onClick={() => run(async () => { await reload(user); if (!user.emailVerified) throw new Error('Email is not verified yet.'); await user.getIdToken(true); location.reload(); })}>I verified my email</button>
    <button className="secondary" disabled={busy} onClick={() => run(() => sendEmailVerification(user))}>Resend verification email</button>
    <button className="link" onClick={() => signOut(getAuth())}>Use another account</button>
  </section>;
}

function Activation({ api, initialCode, done }: { api: Api; initialCode: string; done: () => void }) {
  const [code, setCode] = useState(initialCode), [preview, setPreview] = useState<{ manufacturer: string; model: string } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const inspect = async () => {
    setBusy(true); setError('');
    try { setPreview(await api.inspectDevice(code.replace(/[\s-]/g, '').toUpperCase())); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { if (initialCode) void inspect(); }, []);
  return <section className="card">
    <BusyOverlay visible={busy} label="Connecting your TV…" /><h2>Authorize your TV</h2>
    <div className="warning">Approve only if this code is on your own TV.</div>
    <label className="field">TV code<input value={code} maxLength={9} onChange={e => { setCode(e.target.value.toUpperCase()); setPreview(null); }} /></label>
    {!preview ? <button className="primary" disabled={busy || code.replace(/\W/g, '').length !== 8} onClick={inspect}>Check TV</button> :
      <><div className="device-preview"><strong>{preview.manufacturer} {preview.model}</strong><p>Confirm that this matches the TV showing the code.</p></div>
        <button className="primary" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try { await api.approveDevice(code.replace(/[\s-]/g, '').toUpperCase()); done(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>Approve this TV</button></>}
    {error && <div className="error">{error}</div>}
    <button className="link" onClick={done}>Back to my TVs</button>
  </section>;
}

function DeviceEditor({ device, api, changed }: { device: TvDevice; api: Api; changed: () => Promise<void> }) {
  const [name, setName] = useState(device.name), [room, setRoom] = useState(device.room ?? ''), [busy, setBusy] = useState(false);
  return <div className="device-row"><BusyOverlay visible={busy} label="Updating your TV…" />
    <label className="field">Name<input className="normal-input" value={name} onChange={e => setName(e.target.value)} /></label>
    <label className="field">Room<input className="normal-input" value={room} onChange={e => setRoom(e.target.value)} /></label>
    <p className="muted">{device.manufacturer} {device.model} · {lastSeenLabel(device.lastSeen)}</p>
    <div className="row-actions">
      <button className="secondary" disabled={busy || !name.trim()} onClick={async () => { setBusy(true); try { await api.updateDevice(device.deviceId, { name, room: room || null }); await changed(); } finally { setBusy(false); } }}>Save</button>
      <button className="danger" disabled={busy} onClick={async () => {
        if (!confirm(`Remove ${device.name}? The TV must be authorized again.`)) return;
        setBusy(true); try { await api.removeDevice(device.deviceId); await changed(); } finally { setBusy(false); }
      }}>Remove</button>
    </div>
  </div>;
}

function Caller({ api, activationCode }: { api: Api; activationCode: string }) {
  const [devices, setDevices] = useState<TvDevice[]>([]), [call, setCall] = useState<Call | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [clock, setClock] = useState(Date.now());
  const [activate, setActivate] = useState(!!activationCode), [settings, setSettings] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const load = async () => setDevices(await api.devices());
  useEffect(() => { void api.account().then(load).catch(e => setError(e.message)).finally(() => setLoadingDevices(false)); }, []);
  useEffect(() => {
    if (!call || isTerminal(call.status)) return;
    const timer = setInterval(async () => {
      setClock(Date.now());
      try { setCall(await api.getCall(call.id)); } catch (e) { setError((e as Error).message); }
    }, 1000);
    return () => clearInterval(timer);
  }, [call?.id, call?.status]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (activate) return <Activation api={api} initialCode={activationCode} done={() => { history.replaceState({}, '', '/'); setActivate(false); void load(); }} />;
  return <section className="card wide"><BusyOverlay visible={busy} />
    {loadingDevices && <p role="status"><span className="spinner" aria-hidden="true" /> Finding your TVs…</p>}
    <div className="card-top"><h2>{settings ? 'Paired TVs' : 'Your TVs'}</h2>
      <button className="link inline" onClick={() => setSettings(!settings)}>{settings ? 'Done' : 'Settings'}</button></div>
    {settings ? devices.map(device => <DeviceEditor key={device.deviceId} device={device} api={api} changed={load} />) :
      <>{!loadingDevices && emptyDeviceMessage(devices) && <div className="empty"><strong>No TV detected</strong><p>Open HomePing on your TV and authorize it with this account.</p><button className="secondary" onClick={() => setActivate(true)}>Enter TV code</button></div>}
      {devices.map(device => <div className="device-row" key={device.deviceId}>
        <h3>{device.name}</h3><p className="muted">{device.manufacturer} {device.model}{device.room ? ` · ${device.room}` : ''}<br />{lastSeenLabel(device.lastSeen, clock)}</p>
        <button className="primary" disabled={busy || (!!call && !isTerminal(call.status))} onClick={() => run(async () => setCall(await api.call(device.deviceId)))}>Call</button>
      </div>)}</>}
    {call && <div className="call-state" role="status"><strong>{({
      ringing: 'Ringing', accepted: 'Accepted', declined: 'Declined', missed: 'Missed',
      busy: 'Busy', cancelled: 'Cancelled', ended: 'Call ended', failed: 'Delivery failed',
    } as Record<string,string>)[call.status]}</strong>
      {call.status === 'ringing' && <><p>{call.receivedAt ? 'TV received the invitation' : call.delivery === 'submitted' ? 'Invitation sent' : 'Sending'} · {Math.max(0, Math.ceil((call.expiresAt - clock) / 1000))}s</p>
      <button className="secondary" disabled={busy} onClick={() => run(async () => setCall(await api.cancel(call.id)))}>Cancel</button></>}
    </div>}
    {call?.status === 'accepted' && <Suspense fallback={<p>Opening call controls…</p>}><VideoCall key={call.id} api={api} call={call} changed={setCall} /></Suspense>}
    {!settings && devices.length > 0 && <button className="link" onClick={() => setActivate(true)}>Authorize another TV</button>}
    {error && <div className="error">{error}</div>}
  </section>;
}

function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null), [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    Api.config(backendUrl).then(async cfg => {
      setConfig(cfg);
      const firebase = getApps()[0] ?? initializeApp({ apiKey: cfg.apiKey, projectId: cfg.projectId, appId: cfg.androidAppId, messagingSenderId: cfg.messagingSenderId, authDomain: cfg.authDomain });
      const auth = getAuth(firebase); await setPersistence(auth, browserLocalPersistence);
      return onAuthStateChanged(auth, value => { setUser(value); setLoaded(true); });
    }).catch(e => setError(e.message));
  }, []);
  const api = useMemo(() => user ? new Api(backendUrl, force => user.getIdToken(!!force)) : null, [user]);
  const activationCode = new URLSearchParams(location.search).get('activate') ?? '';
  return <main><header><a className="brand" href="/"><img className="brand-mark" src="/homeping-icon.svg" alt="" width="36" height="36" /> HomePing</a>
    {user && <button className="link inline" onClick={() => signOut(getAuth())}>Sign out</button>}</header>
    <section className="intro"><p className="eyebrow">A LITTLE CLOSER TO HOME</p><h1>Your living room.<br/><em>One call away.</em></h1></section>
    {!loaded || !config ? <section className="card"><span className="spinner" aria-hidden="true" /> Opening HomePing… The server may take a minute to wake up.</section> :
      !user ? <AuthScreen config={config} onError={setError} /> :
      !user.emailVerified ? <Verification user={user} onError={setError} /> :
      <Caller api={api!} activationCode={activationCode} />}
    {error && <div className="error global" role="alert">{error}</div>}
    <p className="footnote">Call your TV with HomePing. Camera and microphone access are requested when you join.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
