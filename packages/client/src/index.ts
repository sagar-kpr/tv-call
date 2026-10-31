export type CallStatus =
  | 'ringing'
  | 'accepted'
  | 'declined'
  | 'missed'
  | 'busy'
  | 'cancelled'
  | 'ended'
  | 'failed';
export type Call = {
  id: string; deviceId: string; ownerUid: string; callerUid: string;
  status: CallStatus; createdAt: number; expiresAt: number;
  delivery: 'pending' | 'submitted' | 'failed' | 'not-sent';
  acceptedAt?: number; callerSeenAt?: number; tvSeenAt?: number; mediaDeadline?: number;
  autoAcceptUntil?: number; receivedAt?: number; updatedAt: number; error?: string;
};
export type TvDevice = {
  deviceId: string; type: 'tv'; name: string; room: string | null;
  manufacturer: string; model: string; androidVersion: string; apiLevel: number;
  screenWidthPx: number; screenHeightPx: number; firmwareFingerprint: string;
  builtInCameraAvailable: boolean; usbHostSupported: boolean;
  usbCameraAttached: boolean; cameraApiCount: number; doNotDisturb: boolean; autoAccept?: boolean;
  lastSeen: number; createdAt: number; updatedAt: number;
};
export type PublicConfig = {
  apiKey: string; projectId: string; androidAppId: string; messagingSenderId: string;
  authDomain?: string; googleWebClientId?: string; googleAndroidClientId?: string;
  webUrl?: string; mediaEnabled?: boolean; ringSeconds?: number; autoAcceptSupported?: boolean;
};
async function jsonFetch(url: string, options: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { throw new Error('HomePing is starting or temporarily unavailable. Please try again.'); }
    return { response, data };
  } catch (error) {
    if (controller.signal.aborted || (error as { name?: string }).name === 'AbortError')
      throw new Error('HomePing took too long to respond. Please try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export class Api {
  readonly base: string;
  constructor(base: string, private getIdToken: (forceRefresh?: boolean) => Promise<string>) {
    this.base = base.trim().replace(/\/$/, '');
    if (!/^https:\/\//.test(this.base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(this.base))
      throw new Error('Use an HTTPS backend URL (or localhost for development).');
  }
  static async config(base: string): Promise<PublicConfig> {
    const normalized = base.trim().replace(/\/$/, '');
    // Render Free may need more than 50 seconds to start. Only startup gets
    // this longer deadline; call mutations retain their short timeout.
    const { response, data } = await jsonFetch(`${normalized}/api/config`, {}, 90_000);
    if (!response.ok) throw new Error('Backend configuration unavailable');
    return data as PublicConfig;
  }
  async request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
    const send = async (force = false) => jsonFetch(`${this.base}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.getIdToken(force)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let result = await send();
    if (result.response.status === 401 || result.data.code === 'EMAIL_NOT_VERIFIED') result = await send(true);
    if (!result.response.ok) throw new Error(result.data.error ?? `Request failed (${result.response.status})`);
    return result.data as T;
  }
  devices() { return this.request<TvDevice[]>('/devices'); }
  account() { return this.request<{ uid: string; email: string }>('/account', {}); }
  updateDevice(deviceId: string, changes: { name?: string; room?: string | null }) {
    return this.request<TvDevice>(`/devices/${deviceId}`, changes, 'PATCH');
  }
  removeDevice(deviceId: string) { return this.request<void>(`/devices/${deviceId}`, undefined, 'DELETE'); }
  call(deviceId: string) { return this.request<Call>(`/devices/${deviceId}/calls`, {}); }
  getCall(id: string) { return this.request<Call>(`/calls/${id}`); }
  media(id: string) { return this.request<{ url: string; token: string }>(`/calls/${id}/media`, {}); }
  heartbeat(id: string) { return this.request<Call>(`/calls/${id}/heartbeat`, {}); }
  end(id: string) { return this.request<Call>(`/calls/${id}/action`, { action: 'end' }); }
  cancel(id: string) { return this.request<Call>(`/calls/${id}/action`, { action: 'cancel' }); }
  approveDevice(code: string) {
    return this.request<{ deviceId: string; name: string }>('/device-authorizations/approve', { code });
  }
  inspectDevice(code: string) {
    return this.request<{ manufacturer: string; model: string; expiresAt: number }>(
      '/device-authorizations/inspect',
      { code },
    );
  }
}
export const isTerminal = (status: CallStatus) => !['ringing', 'accepted'].includes(status);
export const emptyDeviceMessage = (devices: TvDevice[]) => devices.length === 0 ? 'No TV detected' : null;
export function lastSeenLabel(lastSeen: number, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - lastSeen) / 60_000));
  if (minutes < 1) return 'last seen less than a minute ago';
  const [value, unit] = minutes < 60 ? [minutes, 'minute']
    : minutes < 24 * 60 ? [Math.floor(minutes / 60), 'hour']
    : minutes < 30 * 24 * 60 ? [Math.floor(minutes / (24 * 60)), 'day']
    : minutes < 365 * 24 * 60 ? [Math.floor(minutes / (30 * 24 * 60)), 'month']
    : [Math.floor(minutes / (365 * 24 * 60)), 'year'];
  return `last seen ${value} ${unit}${value === 1 ? '' : 's'} ago`;
}

/** One automatic launch per accepted call, deferred while the caller is backgrounded. */
export class AutoJoinGate {
  private launched = new Set<string>();
  claim(id: string, status: string, foreground: boolean): boolean {
    if (!foreground || status !== 'accepted' || this.launched.has(id)) return false;
    this.launched.add(id); return true;
  }
  retry(id: string): void { this.launched.delete(id); }
}

/** Upper capture bound; LiveKit may adapt below this when bandwidth is limited. */
export function videoProfile(acceptedAt: number | undefined, now = Date.now()) {
  return acceptedAt !== undefined && now - acceptedAt >= 15 * 60_000
    ? { width: 854, height: 480, frameRate: 20, label: 'Auto · up to 480p' }
    : { width: 1280, height: 720, frameRate: 24, label: 'Auto · up to 720p' };
}
