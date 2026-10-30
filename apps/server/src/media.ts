import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { Calls, Fault, type Principal } from './service.js';

export type MediaConfig = { url: string; apiKey: string; apiSecret: string };
export function mediaConfig(env = process.env): MediaConfig | undefined {
  const values = [env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET];
  if (values.every(value => !value?.trim())) return undefined;
  if (values.some(value => !value?.trim())) throw new Error('Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET together.');
  const url = new URL(env.LIVEKIT_URL!);
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash)
    throw new Error('LIVEKIT_URL must be a secure wss:// server URL without credentials or query parameters.');
  return { url: url.toString().replace(/\/$/, ''), apiKey: env.LIVEKIT_API_KEY!, apiSecret: env.LIVEKIT_API_SECRET! };
}
export const roomName = (callId: string) => `homeping-${callId}`;
export interface MediaRooms {
  createRoom(options: { name: string; maxParticipants: number; emptyTimeout: number; departureTimeout: number }): Promise<unknown>;
  deleteRoom(room: string): Promise<unknown>;
}
export class Media {
  private rooms?: MediaRooms;
  constructor(private config?: MediaConfig, rooms?: MediaRooms) {
    this.rooms = rooms ?? (config ? new RoomServiceClient(config.url.replace(/^wss:/, 'https:'), config.apiKey, config.apiSecret, { requestTimeout: 8 }) : undefined);
  }
  get enabled() { return !!this.config; }
  async close(id: string) {
    if (!this.rooms) return;
    try { await this.rooms.deleteRoom(roomName(id)); }
    catch (error) {
      if ((error as { code?: string }).code !== 'not_found') throw error;
    }
  }
  async join(calls: Calls, principal: Principal, id: string) {
    // Authorization and current call state are checked before any credentials are issued.
    await calls.mediaSession(principal, id);
    if (!this.config || !this.rooms) throw new Fault(503, 'Video calling is not configured. Add LiveKit settings to the server.');
    const room = roomName(id);
    try { await this.rooms.createRoom({ name: room, maxParticipants: 2, emptyTimeout: 60, departureTimeout: 15 }); }
    catch { throw new Fault(503, 'The video server is unavailable. Check LiveKit settings and try again.'); }
    // An End/removal while createRoom was in flight must not yield a usable join response.
    try { await calls.mediaSession(principal, id); }
    catch (error) { await this.close(id).catch(() => {}); throw error; }
    const token = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      identity: `${principal.kind}-${id}`, ttl: '60s',
    });
    token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true,
      canPublishData: false, canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
      canUpdateOwnMetadata: false });
    return { url: this.config.url, token: await token.toJwt() };
  }
}
