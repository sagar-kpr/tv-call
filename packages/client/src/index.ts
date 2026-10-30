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
  receivedAt?: number; updatedAt: number; error?: string;
};
export type TvDevice = {
  deviceId: string; type: 'tv'; name: string; room: string | null;
  manufacturer: string; model: string; androidVersion: string; apiLevel: number;
  screenWidthPx: number; screenHeightPx: number; firmwareFingerprint: string;
  builtInCameraAvailable: boolean; usbHostSupported: boolean;
  usbCameraAttached: boolean; cameraApiCount: number; doNotDisturb: boolean;
  lastSeen: number; createdAt: number; updatedAt: number;
};
export type PublicConfig = {
  apiKey: string; projectId: string; androidAppId: string; messagingSenderId: string;
  authDomain?: string; googleWebClientId?: string; googleAndroidClientId?: string;
  webUrl?: string;
};
async function jsonFetch(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { response, data: text ? JSON.parse(text) : {} };
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
    const { response, data } = await jsonFetch(`${normalized}/api/config`);
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
    if (result.response.status === 401) result = await send(true);
    if (!result.response.ok) throw new Error(result.data.error ?? `Request failed (${result.response.status})`);
    return result.data as T;
  }
  devices() { return this.request<TvDevice[]>('/devices'); }
  updateDevice(deviceId: string, changes: { name?: string; room?: string | null }) {
    return this.request<TvDevice>(`/devices/${deviceId}`, changes, 'PATCH');
  }
  removeDevice(deviceId: string) { return this.request<void>(`/devices/${deviceId}`, undefined, 'DELETE'); }
  call(deviceId: string) { return this.request<Call>(`/devices/${deviceId}/calls`, {}); }
  getCall(id: string) { return this.request<Call>(`/calls/${id}`); }
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
  if (minutes === 1) return 'last seen 1 minute ago';
  return `last seen ${minutes} minutes ago`;
}
