import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Api, isTerminal, type Call } from '@homeping/client';
import './style.css';
function App() {
  const api = useRef<Api | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState(''),
    [devices, setDevices] = useState<Array<{ tvId: string; name: string }>>([]),
    [tv, setTv] = useState(''),
    [call, setCall] = useState<Call | null>(null);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    let active = true;
    const client =
      api.current ??
      new Api(location.origin, {
        getItem: async (k) => localStorage.getItem(k),
        setItem: async (k, v) => {
          localStorage.setItem(k, v);
        },
      });
    api.current = client;
    client
      .init()
      .then(() => client.devices())
      .then((d) => {
        if (active) {
          setDevices(d);
          setTv(d[0]?.tvId ?? '');
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!call || isTerminal(call.status)) return;
    let active = true;
    let running = false;
    const timer = setInterval(async () => {
      setClock(Date.now());
      if (running) return;
      running = true;
      try {
        const next = await api.current!.getCall(call.id);
        if (active) {
          setCall(next);
          setError('');
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        running = false;
      }
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [call?.id, call?.status]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const live = call && !isTerminal(call.status);
  return (
    <main>
      <header>
        <a className="brand" href="/" aria-label="HomePing home">
          <span className="brand-icon">▣</span> HomePing
        </a>
        <span className="badge">INVITATION PROTOTYPE</span>
      </header>
      <section className="intro">
        <p className="eyebrow">A LITTLE CLOSER TO HOME</p>
        <h1>
          Your living room.
          <br />
          <em>One call away.</em>
        </h1>
        <p>
          Send an invitation to your TV. Someone at home can accept with the
          remote.
        </p>
      </section>
      <section className="card" aria-label="Call your TV">
        <div className="card-top">
          <span className="tv-icon">▣</span>
          <span className={`connection ${ready ? 'online' : ''}`}>
            {ready ? 'Caller connected' : 'Connecting…'}
          </span>
        </div>
        <h2>{devices.find((d) => d.tvId === tv)?.name ?? 'Connect your TV'}</h2>
        <p className="muted">
          {devices.length
            ? 'Ready when someone is home.'
            : 'Open HomePing on your television once to get a pairing code.'}
        </p>
        {devices.length > 0 && (
          <label className="field">
            Television
            <select
              disabled={!!live || busy}
              value={tv}
              onChange={(e) => setTv(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.tvId} value={d.tvId}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {devices.length > 0 && (
          <button
            className="primary"
            disabled={!ready || busy || !!live}
            onClick={() =>
              run(async () => {
                setCall(await api.current!.call(tv));
                setClock(Date.now());
              })
            }
          >
            Call TV <span>↗</span>
          </button>
        )}
        {call && (
          <div className="call-state" role="status" aria-live="polite">
            <strong>
              {
                {
                  ringing: 'Calling your TV…',
                  accepted: 'Accepted on TV',
                  rejected: 'Invitation rejected',
                  cancelled: 'Invitation cancelled',
                  expired: 'No answer',
                  ended: 'Call ended',
                  failed: 'Delivery failed',
                }[call.status]
              }
            </strong>
            {call.status === 'ringing' && (
              <p>
                {call.receivedAt
                  ? 'TV acknowledged the invitation'
                  : call.delivery === 'submitted'
                    ? 'FCM submitted · waiting for TV acknowledgment'
                    : 'Sending invitation'}{' '}
                · {Math.max(0, Math.ceil((call.expiresAt - clock) / 1000))}s
              </p>
            )}
            {call.status === 'accepted' && (
              <p>
                The TV opened the placeholder call. Video and audio come in a
                later milestone. End using the TV remote.
              </p>
            )}
            {call.status === 'failed' && <p>{call.error}</p>}
            {call.status === 'ringing' && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => setCall(await api.current!.cancel(call.id)))
                }
              >
                Cancel invitation
              </button>
            )}
          </div>
        )}
        <details open={!devices.length}>
          <summary>
            {devices.length ? 'Pair another TV' : 'Enter your pairing code'}
          </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const paired = await api.current!.pair(code);
                setDevices(await api.current!.devices());
                setTv(paired.tvId);
                setCode('');
              });
            }}
          >
            <label className="field">
              6-digit code
              <input
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <button
              className="secondary"
              disabled={!ready || busy || code.length !== 6}
            >
              Pair TV
            </button>
          </form>
        </details>
        {error && (
          <div className="error" role="alert">
            {error}
            {!ready && (
              <button className="secondary" onClick={() => location.reload()}>
                Reconnect
              </button>
            )}
          </div>
        )}
      </section>
      <footer>
        <span>01 — Pair once</span>
        <span>02 — Send an invitation</span>
        <span>03 — Accept on TV</span>
      </footer>
      <p className="footnote">
        This prototype tests incoming invitations. No camera or microphone is
        used.
      </p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
