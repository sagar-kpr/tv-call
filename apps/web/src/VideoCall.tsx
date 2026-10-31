import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Room, RoomEvent, Track, LocalVideoTrack, type RemoteTrack } from 'livekit-client';
import { videoProfile, type Api, type Call } from '@homeping/client';

export function VideoCall({ api, call, changed }: { api: Api; call: Call; changed: (call: Call) => void }) {
  const roomRef = useRef<Room | null>(null);
  const local = useRef<HTMLDivElement>(null), remote = useRef<HTMLDivElement>(null);
  const [joining, setJoining] = useState(false), [connected, setConnected] = useState(false);
  const [mic, setMic] = useState(false), [camera, setCamera] = useState(false);
  const [message, setMessage] = useState('Joining your call…');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [remoteVideo, setRemoteVideo] = useState(false), [videoBlocked, setVideoBlocked] = useState(false);
  const disposed = useRef(false);
  const quality = useRef(videoProfile(call.acceptedAt));
  const [qualityLabel, setQualityLabel] = useState(quality.current.label);
  const [landscape, setLandscape] = useState(false);
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
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      void roomRef.current?.startVideo();
      remote.current?.querySelectorAll('video').forEach(video => { void video.play().catch(() => setVideoBlocked(true)); });
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    // Deferring lets StrictMode cancel its preliminary mount before opening media.
    const start = setTimeout(() => void join(), 0);
    return () => { document.body.style.overflow = previousOverflow; clearTimeout(start); disposed.current = true; window.removeEventListener('pagehide', leave); document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume); clear(); };
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
  useEffect(() => {
    let updating = false;
    const update = async () => {
      const room = roomRef.current, target = videoProfile(call.acceptedAt);
      if (!connected || !room || updating || target.height === quality.current.height) return;
      updating = true;
      try {
        const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
        if (track instanceof LocalVideoTrack && !track.isMuted) await track.restartTrack({ resolution: target });
        if (!disposed.current) { quality.current = target; setQualityLabel(target.label); }
      } catch { /* Keep the call connected; retry adapting on the next tick. */ }
      finally { updating = false; }
    };
    void update();
    const timer = setInterval(() => void update(), 1000);
    return () => clearInterval(timer);
  }, [connected, call.acceptedAt]);
  async function join() {
    if (roomRef.current || joining) return;
    setJoining(true); setMessage('Connecting…');
    const room = new Room({ adaptiveStream: true, dynacast: true,
      publishDefaults: { simulcast: true, videoEncoding: { maxBitrate: 1_500_000, maxFramerate: 24 } } }); roomRef.current = room;
    const attach = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video) {
        // iOS must see an inline, muted video in the DOM before LiveKit observes
        // visibility or attempts autoplay. Audio uses its separate audio element.
        const video = document.createElement('video');
        video.autoplay = true; video.playsInline = true; video.muted = true;
        video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
        video.setAttribute('aria-label', 'TV video');
        video.onplaying = () => { if (!disposed.current) { setRemoteVideo(true); setVideoBlocked(false); } };
        remote.current?.querySelectorAll('video').forEach(element => element.remove());
        remote.current?.append(video);
        track.attach(video);
        void video.play().catch(() => { if (!disposed.current) setVideoBlocked(true); });
      } else remote.current?.append(track.attach());
    };
    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.TrackUnsubscribed, track => {
      track.detach().forEach(element => element.remove());
      if (track.kind === Track.Kind.Video) setRemoteVideo(false);
    });
    room.on(RoomEvent.VideoPlaybackStatusChanged, playing => setVideoBlocked(!playing));
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
        const publication = await room.localParticipant.setCameraEnabled(true, { resolution: videoProfile(call.acceptedAt) });
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
        const publication = await room.localParticipant.setCameraEnabled(!camera, { resolution: videoProfile(call.acceptedAt) });
        local.current?.replaceChildren();
        if (!camera && publication?.track) {
          const target = videoProfile(call.acceptedAt);
          if (publication.track instanceof LocalVideoTrack && target.height === 480 &&
              (publication.track.mediaStreamTrack.getSettings().height ?? 0) > 480)
            await publication.track.restartTrack({ resolution: target });
          const video = publication.track.attach(); video.muted = true; local.current?.append(video); }
        setCamera(!camera);
      }
    } catch (error) { setMessage((error as Error).message); }
  }
  return createPortal(<div className={`video-call${landscape ? ' landscape-view' : ''}`} role="dialog" aria-modal="true" aria-label="HomePing video call">
    <p className="video-status" role="status">{joining && <span className="spinner" aria-hidden="true" />} {message}<span className="video-quality">{qualityLabel}</span></p>
    <div className="video-stage">{!remoteVideo && <div className="remote-placeholder" role="status">{connected ? 'TV camera is off or not connected' : 'Waiting for TV video…'}</div>}<div ref={remote} className="remote-media" /><div ref={local} className="local-media" /></div>
    <div className="row-actions call-controls">
      {!connected && <button className="primary" disabled={joining} onClick={() => void join()}>{joining ? 'Connecting…' : 'Retry connection'}</button>}
      {connected && <><button className="secondary" onClick={() => void toggle('mic')}>{mic ? 'Mute' : 'Enable microphone'}</button>
        <button className="secondary" onClick={() => void toggle('camera')}>{camera ? 'Camera off' : 'Enable camera'}</button></>}
      <button className="secondary" aria-pressed={landscape} onClick={() => setLandscape(!landscape)}>{landscape ? 'Portrait view' : 'Landscape view'}</button>
      {videoBlocked && <button className="secondary" onClick={() => void roomRef.current?.startVideo()}>Show TV video</button>}
      {audioBlocked && <button className="secondary" onClick={() => void roomRef.current?.startAudio()}>Play TV audio</button>}
      <button className="danger" onClick={async () => { clear(); setConnected(false); try { changed(await api.end(call.id)); } catch (error) { setMessage((error as Error).message); } }}>End call</button>
    </div>
  </div>, document.body);
}
