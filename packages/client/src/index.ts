export type CallStatus =
  | 'ringing'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'ended'
  | 'failed';
export type Call = {
  id: string;
  tvId: string;
  callerId: string;
  status: CallStatus;
  createdAt: number;
  expiresAt: number;
  delivery: 'pending' | 'submitted' | 'failed';
  receivedAt?: number;
  updatedAt: number;
  error?: string;
};
export type PublicConfig = {
  apiKey: string;
  projectId: string;
  androidAppId: string;
  messagingSenderId: string;
};
export type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};
type Session = { idToken: string; refreshToken: string; expiresAt: number };
async function jsonFetch(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const data = await response.json();
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}
export class Api {
  private session?: Session;
  private config?: PublicConfig;
  private authPending?: Promise<string>;
  readonly base: string;
  constructor(
    base: string,
    private storage: Storage,
  ) {
    this.base = base.trim().replace(/\/$/, '');
    if (
      !/^https:\/\//.test(this.base) &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(this.base)
    )
      throw new Error(
        'Use an HTTPS backend URL (or localhost for development).',
      );
  }
  async init() {
    const { response, data } = await jsonFetch(`${this.base}/api/config`);
    if (!response.ok) throw new Error('Backend configuration unavailable');
    this.config = data;
    const saved = await this.storage.getItem(`session:${this.base}`);
    if (saved) {
      try {
        this.session = JSON.parse(saved);
      } catch {
        /* replace invalid local session */
      }
    }
    await this.token();
  }
  private async token(): Promise<string> {
    if (this.session && this.session.expiresAt > Date.now() + 60_000)
      return this.session.idToken;
    if (this.authPending) return this.authPending;
    this.authPending = this.authenticate().finally(() => {
      this.authPending = undefined;
    });
    return this.authPending;
  }
  private async authenticate() {
    if (!this.config) throw new Error('Connect to the backend first');
    const refresh = this.session?.refreshToken;
    const url = refresh
      ? `https://securetoken.googleapis.com/v1/token?key=${this.config.apiKey}`
      : `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${this.config.apiKey}`;
    const { response, data } = await jsonFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': refresh
          ? 'application/x-www-form-urlencoded'
          : 'application/json',
      },
      body: refresh
        ? new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refresh,
          }).toString()
        : JSON.stringify({ returnSecureToken: true }),
    });
    if (!response.ok)
      throw new Error(
        data.error?.message ??
          'Firebase authentication failed; enable Anonymous sign-in.',
      );
    this.session = {
      idToken: data.idToken ?? data.id_token,
      refreshToken: data.refreshToken ?? data.refresh_token,
      expiresAt: Date.now() + Number(data.expiresIn ?? data.expires_in) * 1000,
    };
    await this.storage.setItem(
      `session:${this.base}`,
      JSON.stringify(this.session),
    );
    return this.session.idToken;
  }
  async request<T>(
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    const token = await this.token();
    const { response, data } = await jsonFetch(`${this.base}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(data.error ?? `Request failed (${response.status})`);
    return data as T;
  }
  pair(code: string) {
    return this.request<{ tvId: string; name: string }>('/pair', { code });
  }
  devices() {
    return this.request<Array<{ tvId: string; name: string }>>('/devices');
  }
  call(tvId: string) {
    return this.request<Call>('/calls', { tvId });
  }
  getCall(id: string) {
    return this.request<Call>(`/calls/${id}`);
  }
  cancel(id: string) {
    return this.request<Call>(`/calls/${id}/action`, { action: 'cancel' });
  }
}
export const isTerminal = (status: CallStatus) =>
  !['ringing', 'accepted'].includes(status);
