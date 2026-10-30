import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import type { Api, Call } from '@homeping/client';

export function VideoCall({ api, call, changed }: { api: Api; call: Call; changed: (call: Call) => void }) {
  const roomRef = useRef<Room | null>(null);
  const local = useRef<HTMLDivElement>(null), remote = useRef<HTMLDivElement>(null);
  const [joining, setJoining] = useState(false), [connected, setConnected] = useState(false);
  const [mic, setMic] = useState(false), [camera, setCamera] = useState(false);
  const [message, setMessage] = useState('Joining your call…');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const disposed = useRef(false);
  function clear() {
    const room = roomRef.current; roomRef.current = null;
    if (room) { room.removeAllListeners(); void room.disconnect(); }
    local.current?.replaceChildren(); remote.current?.replaceChildren();
  }
  useEffect(() => {
    disposed.current = false;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const leave = () => { clear(); };
    window.addEventListener('pagehide', leave);
    // Deferring lets StrictMode cancel its preliminary mount before opening media.
    const start = setTimeout(() => void join(), 0);
    return () => { document.body.style.overflow = previousOverflow; clearTimeout(start); disposed.current = true; window.removeEventListener('pagehide', leave); clear(); };
  }, []);
  useEffect(() => {
    let pending = false;
    const timer = setInterval(async () => {
      if (pending || !roomRef.current) return;
      pending = true;
      try { await api.heartbeat(call.id); }
      catch (error) { if (!disposed.current) setMessage((error as Error).message); }
      finally { pending = false; }
    }, 10_000);
    return () => clearInterval(timer);
  }, [api, call.id]);
  async function join() {
    if (roomRef.current || joining) return;
    setJoining(true); setMessage('Connecting…');
    const room = new Room({ adaptiveStream: true, dynacast: true }); roomRef.current = room;
    const attach = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video) {
        remote.current?.querySelectorAll('video').forEach(element => element.remove());
      }
      const element = track.attach();
      if (element instanceof HTMLVideoElement) { element.playsInline = true; element.setAttribute('aria-label', 'TV video'); }
      remote.current?.append(element);
    };
    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(element => element.remove()));
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio));
    room.on(RoomEvent.Reconnecting, () => setMessage('Connection lost. Reconnecting…'));
    room.on(RoomEvent.Reconnected, () => setMessage('Connected'));
    room.on(RoomEvent.Disconnected, () => {
      if (disposed.current) return;
      clear(); setConnected(false); setMessage('Video connection ended.');
      void api.end(call.id).then(changed).catch(() => {});
    });
    try {
      const session = await api.media(call.id);
      if (disposed.current || roomRef.current !== room) return;
      await room.connect(session.url, session.token);
      if (disposed.current || roomRef.current !== room) { await room.disconnect(); return; }
      await api.heartbeat(call.id);
      setConnected(true); setMessage('Connected. Waiting for TV video…');
      // A denied/missing device still allows receiving media and publishing the
      // other available input. Failures are visible, never reported as success.
      const notices: string[] = [];
      try { await room.localParticipant.setMicrophoneEnabled(true); setMic(true); }
      catch { notices.push('Microphone unavailable or permission denied.'); }
      if (disposed.current || roomRef.current !== room) return;
      try {
        const publication = await room.localParticipant.setCameraEnabled(true, { resolution: { width: 640, height: 360, frameRate: 24 } });
        if (publication?.track) {
          const element = publication.track.attach(); element.muted = true;
          if (element instanceof HTMLVideoElement) element.playsInline = true;
          local.current?.replaceChildren(element); setCamera(true);
        }
      } catch { notices.push('Camera unavailable or permission denied.'); }
      if (!disposed.current) setMessage(notices.length ? notices.join(' ') : 'Connected');
    } catch (error) {
      clear(); if (!disposed.current) { setConnected(false); setMessage((error as Error).message); }
    } finally { if (!disposed.current) setJoining(false); }
  }
  async function toggle(kind: 'mic' | 'camera') {
    const room = roomRef.current; if (!room) return;
    try {
      if (kind === 'mic') { await room.localParticipant.setMicrophoneEnabled(!mic); setMic(!mic); }
      else {
        const publication = await room.localParticipant.setCameraEnabled(!camera);
        local.current?.replaceChildren();
        if (!camera && publication?.track) { const video = publication.track.attach(); video.muted = true; local.current?.append(video); }
        setCamera(!camera);
      }
    } catch (error) { setMessage((error as Error).message); }
  }
  return createPortal(<div className="video-call" role="dialog" aria-modal="true" aria-label="HomePing video call">
    <p className="video-status" role="status">{joining && <span className="spinner" aria-hidden="true" />} {message}</p>
    <div className="video-stage"><div ref={remote} className="remote-media" /><div ref={local} className="local-media" /></div>
    <div className="row-actions call-controls">
      {!connected && <button className="primary" disabled={joining} onClick={() => void join()}>{joining ? 'Connecting…' : 'Retry connection'}</button>}
      {connected && <><button className="secondary" onClick={() => void toggle('mic')}>{mic ? 'Mute' : 'Enable microphone'}</button>
        <button className="secondary" onClick={() => void toggle('camera')}>{camera ? 'Camera off' : 'Enable camera'}</button></>}
      {audioBlocked && <button className="secondary" onClick={() => void roomRef.current?.startAudio()}>Play TV audio</button>}
      <button className="danger" onClick={async () => { clear(); setConnected(false); try { changed(await api.end(call.id)); } catch (error) { setMessage((error as Error).message); } }}>End call</button>
    </div>
  </div>, document.body);
}
