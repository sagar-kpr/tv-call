import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Api, isTerminal, type Call } from '@homeping/client';
export default function App() {
  const api = useRef<Api | null>(null);
  const [url, setUrl] = useState(''),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [code, setCode] = useState(''),
    [devices, setDevices] = useState<Array<{ tvId: string; name: string }>>([]),
    [tv, setTv] = useState(''),
    [call, setCall] = useState<Call | null>(null),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    AsyncStorage.getItem('backend')
      .then(async (v) => {
        if (v) {
          setUrl(v);
          setBusy(true);
          try {
            await connect(v);
          } finally {
            setBusy(false);
          }
        }
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!call || isTerminal(call.status)) return;
    let active = true,
      running = false;
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
  async function connect(base: string) {
    const client = new Api(base, AsyncStorage);
    await client.init();
    const ds = await client.devices();
    api.current = client;
    setDevices(ds);
    setTv(ds[0]?.tvId ?? '');
    setReady(true);
    await AsyncStorage.setItem('backend', base.trim());
  }
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
  function button(title: string, fn: () => Promise<void>, disabled = false) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={busy || disabled}
        onPress={() => run(fn)}
        style={[s.button, (busy || disabled) && { opacity: 0.4 }]}
      >
        <Text style={s.buttonText}>{title}</Text>
      </Pressable>
    );
  }
  const live = !!call && !isTerminal(call.status);
  return (
    <SafeAreaView style={s.root}>
      <ScrollView
        contentContainerStyle={s.page}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.brand}>▣ HomePing</Text>
        <Text style={s.eyebrow}>A LITTLE CLOSER TO HOME</Text>
        <Text style={s.title}>Your living room.{'\n'}One call away.</Text>
        <Text style={s.muted}>
          Send an invitation. Accept it with the TV remote.
        </Text>
        <View style={s.card}>
          {!ready ? (
            <>
              <Text style={s.heading}>Connect to your backend</Text>
              <TextInput
                accessibilityLabel="Backend HTTPS URL"
                style={s.input}
                placeholder="https://your-tunnel.example"
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              {button('Connect', async () => {
                await connect(url);
              })}
            </>
          ) : (
            <>
              <Text style={s.heading}>Your televisions</Text>
              {devices.map((d) => (
                <Pressable
                  key={d.tvId}
                  disabled={live}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: tv === d.tvId }}
                  onPress={() => setTv(d.tvId)}
                  style={[s.device, tv === d.tvId && s.selected]}
                >
                  <Text>
                    {tv === d.tvId ? '●' : '○'} {d.name}
                  </Text>
                </Pressable>
              ))}
              {devices.length > 0 &&
                button(
                  'Call TV ↗',
                  async () => {
                    setCall(await api.current!.call(tv));
                    setClock(Date.now());
                  },
                  live,
                )}
              {call && (
                <View style={s.status} accessibilityLiveRegion="polite">
                  <Text style={s.heading}>{call.status.toUpperCase()}</Text>
                  {call.status === 'ringing' && (
                    <Text style={s.muted}>
                      {call.receivedAt
                        ? 'TV acknowledged'
                        : call.delivery === 'submitted'
                          ? 'FCM submitted · waiting for TV'
                          : 'Sending'}{' '}
                      ·{' '}
                      {Math.max(0, Math.ceil((call.expiresAt - clock) / 1000))}s
                    </Text>
                  )}
                  {call.status === 'accepted' && (
                    <Text style={s.muted}>
                      Placeholder opened on TV. End using the remote. Video and
                      audio are deferred.
                    </Text>
                  )}
                  {call.error && <Text style={s.error}>{call.error}</Text>}
                  {call.status === 'ringing' &&
                    button('Cancel invitation', async () =>
                      setCall(await api.current!.cancel(call.id)),
                    )}
                </View>
              )}
              <Text style={s.label}>Pair a TV with its 6-digit code</Text>
              <TextInput
                accessibilityLabel="TV pairing code"
                style={s.input}
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="000000"
              />
              {button(
                'Pair TV',
                async () => {
                  const paired = await api.current!.pair(code);
                  setDevices(await api.current!.devices());
                  setTv(paired.tvId);
                  setCode('');
                },
                code.length !== 6,
              )}
              {button(
                'Change backend',
                async () => {
                  setReady(false);
                  setDevices([]);
                  setCall(null);
                },
                live,
              )}
            </>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          )}
        </View>
        <Text style={s.note}>
          INVITATION PROTOTYPE · No camera or microphone is used.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f5ef' },
  page: { padding: 24, paddingTop: 42 },
  brand: { fontSize: 23, fontWeight: '800', color: '#244e3a' },
  eyebrow: { fontSize: 10, letterSpacing: 2, color: '#6b805e', marginTop: 40 },
  title: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '700',
    color: '#18352d',
    marginVertical: 16,
  },
  muted: { fontSize: 14, color: '#68796b', lineHeight: 22 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 22,
    marginVertical: 28,
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    color: '#18352d',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#dce3d7',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginVertical: 12,
    color: '#18352d',
  },
  button: {
    backgroundColor: '#244e3a',
    padding: 16,
    borderRadius: 10,
    marginVertical: 7,
  },
  buttonText: { color: 'white', textAlign: 'center', fontWeight: '600' },
  label: { marginTop: 24, fontSize: 13, color: '#68796b' },
  device: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e7dc',
    borderRadius: 10,
    marginVertical: 5,
  },
  selected: { backgroundColor: '#ecf3e5', borderColor: '#769465' },
  status: {
    padding: 16,
    backgroundColor: '#f0f5eb',
    borderRadius: 12,
    marginTop: 16,
  },
  error: { color: '#9a3429', marginTop: 16, lineHeight: 22 },
  note: { fontSize: 10, color: '#73816c', textAlign: 'center', lineHeight: 18 },
});
