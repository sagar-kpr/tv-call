import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Call, TvDevice } from '../../../packages/client/src/index.js';
import type { Store, Transaction } from './store.js';

export class Fault extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export type HumanPrincipal = { kind: 'human'; uid: string; email: string };
export type TvPrincipal = { kind: 'tv'; uid: string; ownerUid: string; deviceId: string };
export type Principal = HumanPrincipal | TvPrincipal;
export interface Push { send(token: string, data: Record<string, string>, ttl: number): Promise<void>; }
export interface DeviceAuthAdmin {
  customToken(uid: string, claims: Record<string, unknown>): Promise<string>;
  revoke(uid: string): Promise<void>;
  deleteUser(uid: string): Promise<void>;
}
export type TvRegistration = Omit<TvDevice, 'type' | 'name' | 'room' | 'doNotDisturb' | 'autoAccept' | 'lastSeen' | 'createdAt' | 'updatedAt'> & {
  fcmToken?: string | null;
};
type StoredDevice = TvDevice & { authUid: string; fcmToken: string | null; activeCallId: string | null; schemaVersion: 1 };
type Authorization = {
  authorizationId: string; deviceId: string; deviceSecretHash: string; userCodeHash: string;
  status: 'pending' | 'approved' | 'consumed' | 'expired'; registration: TvRegistration;
  approvedBy: string | null; createdAt: number; expiresAt: number; approvedAt: number | null; consumedAt: number | null;
};
type CodeLookup = { authorizationId: string; expiresAt: number };
type DeviceOwner = { ownerUid: string; authUid: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const live = (call: Call, now: number): Call =>
  call.status === 'ringing' && (call.receivedAt ? call.autoAcceptUntil ?? call.expiresAt : call.expiresAt) <= now ? { ...call, status: 'missed', updatedAt: now } :
  call.status === 'accepted' && (call.mediaDeadline ?? call.updatedAt + 90_000) <= now
    ? { ...call, status: 'ended', error: 'media-session-expired', updatedAt: now } : call;
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const generateCode = () => Array.from(randomBytes(8), (b) => codeAlphabet[b % codeAlphabet.length]).join('');
const publicDevice = (device: StoredDevice): TvDevice => {
  const { authUid: _a, fcmToken: _f, activeCallId: _c, schemaVersion: _s, ...result } = device;
  return result;
};

export class Calls {
  constructor(
    private store: Store,
    private push: Push,
    private auth: DeviceAuthAdmin,
    private now = Date.now,
    private userCode = generateCode,
    private closeMedia: (id: string) => Promise<void> = async () => {},
  ) {}

  async account(principal: HumanPrincipal) {
    return this.store.run(async (tx) => {
      const path = `users/${principal.uid}`;
      const old = await tx.get<{ uid: string; email: string; createdAt: number; updatedAt: number }>(path);
      if (old?.email === principal.email) return old;
      const now = this.now();
      const profile = { uid: principal.uid, email: principal.email, createdAt: old?.createdAt ?? now, updatedAt: now };
      tx.set(path, profile);
      return profile;
    });
  }

  async beginAuthorization(registration: TvRegistration, secret: string) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = this.userCode();
      const authorizationId = randomUUID();
      const result = await this.store.run(async (tx) => {
        const codePath = `deviceAuthorizationCodes/${digest(code)}`;
        const existing = await tx.get<CodeLookup>(codePath);
        if (existing && existing.expiresAt > this.now()) return null;
        const createdAt = this.now(), expiresAt = createdAt + 10 * 60_000;
        const authorization: Authorization = {
          authorizationId, deviceId: registration.deviceId, deviceSecretHash: digest(secret),
          userCodeHash: digest(code), status: 'pending', registration,
          approvedBy: null, createdAt, expiresAt, approvedAt: null, consumedAt: null,
        };
        tx.set(`deviceAuthorizations/${authorizationId}`, authorization);
        tx.set(codePath, { authorizationId, expiresAt });
        return { authorizationId, code, expiresAt, pollInterval: 5 };
      });
      if (result) return result;
    }
    throw new Fault(503, 'Could not allocate a device code; try again');
  }

  async approveAuthorization(ownerUid: string, rawCode: string) {
    const code = rawCode.replace(/[\s-]/g, '').toUpperCase();
    return this.store.run(async (tx) => {
      const lookup = await tx.get<CodeLookup>(`deviceAuthorizationCodes/${digest(code)}`);
      if (!lookup) throw new Fault(400, 'Invalid or expired device code');
      const path = `deviceAuthorizations/${lookup.authorizationId}`;
      const authorization = await tx.get<Authorization>(path);
      if (!authorization || authorization.expiresAt <= this.now()) {
        if (authorization) tx.set(path, { ...authorization, status: 'expired' });
        throw new Fault(400, 'Invalid or expired device code');
      }
      if (authorization.status !== 'pending') throw new Fault(409, 'Device code has already been used');
      const authUid = `tv:${authorization.deviceId}`;
      const ownerPath = `deviceOwners/${authorization.deviceId}`;
      const existingOwner = await tx.get<DeviceOwner>(ownerPath);
      if (existingOwner && existingOwner.ownerUid !== ownerUid)
        throw new Fault(409, 'This TV belongs to another account; remove it there first');
      const old = await tx.get<StoredDevice>(`users/${ownerUid}/devices/${authorization.deviceId}`);
      if (old && old.authUid !== authUid) throw new Fault(409, 'Device ID is already registered');
      const now = this.now();
      const device: StoredDevice = {
        ...authorization.registration, authUid, type: 'tv',
        name: old?.name ?? 'Living Room TV',
        room: old?.room ?? 'Bedroom', doNotDisturb: old?.doNotDisturb ?? false, autoAccept: old?.autoAccept ?? false,
        fcmToken: authorization.registration.fcmToken ?? old?.fcmToken ?? null,
        activeCallId: old?.activeCallId ?? null, lastSeen: now, createdAt: old?.createdAt ?? now, updatedAt: now, schemaVersion: 1,
      };
      tx.set(`users/${ownerUid}/devices/${authorization.deviceId}`, device);
      tx.set(ownerPath, { ownerUid, authUid });
      tx.set(path, { ...authorization, status: 'approved', approvedBy: ownerUid, approvedAt: now });
      return { deviceId: device.deviceId, name: device.name, manufacturer: device.manufacturer, model: device.model };
    });
  }

  async authorizationPreview(rawCode: string) {
    const code = rawCode.replace(/[\s-]/g, '').toUpperCase();
    return this.store.run(async (tx) => {
      const lookup = await tx.get<CodeLookup>(`deviceAuthorizationCodes/${digest(code)}`);
      if (!lookup) throw new Fault(400, 'Invalid or expired device code');
      const authorization = await tx.get<Authorization>(`deviceAuthorizations/${lookup.authorizationId}`);
      if (!authorization || authorization.expiresAt <= this.now() || authorization.status !== 'pending')
        throw new Fault(400, 'Invalid, expired, or already used device code');
      return {
        manufacturer: authorization.registration.manufacturer,
        model: authorization.registration.model,
        expiresAt: authorization.expiresAt,
      };
    });
  }

  async pollAuthorization(authorizationId: string, secret: string) {
    const consumed = await this.store.run(async (tx) => {
      const path = `deviceAuthorizations/${authorizationId}`;
      const auth = await tx.get<Authorization>(path);
      if (!auth || auth.deviceSecretHash !== digest(secret)) throw new Fault(404, 'Authorization not found');
      if (auth.expiresAt <= this.now()) {
        if (auth.status === 'pending') tx.set(path, { ...auth, status: 'expired' });
        throw new Fault(410, 'Device code expired');
      }
      if (auth.status === 'pending') return null;
      if (auth.status !== 'approved' || !auth.approvedBy) throw new Fault(409, 'Device code has already been used');
      tx.set(path, { ...auth, status: 'consumed', consumedAt: this.now() });
      return { ownerUid: auth.approvedBy, deviceId: auth.deviceId };
    });
    if (!consumed) return { status: 'pending' as const };
    const uid = `tv:${consumed.deviceId}`;
    const customToken = await this.auth.customToken(uid, { role: 'tv', ownerUid: consumed.ownerUid, deviceId: consumed.deviceId });
    return { status: 'approved' as const, customToken };
  }

  private async ownedDevice(tx: Transaction, ownerUid: string, deviceId: string) {
    const device = await tx.get<StoredDevice>(`users/${ownerUid}/devices/${deviceId}`);
    if (!device) throw new Fault(403, 'You do not own this TV');
    return device;
  }
  private async tvDevice(tx: Transaction, principal: TvPrincipal) {
    const device = await this.ownedDevice(tx, principal.ownerUid, principal.deviceId);
    if (device.authUid !== principal.uid) throw new Fault(403, 'TV authorization was removed');
    return device;
  }
  async registerTv(principal: TvPrincipal, registration: TvRegistration) {
    if (registration.deviceId !== principal.deviceId) throw new Fault(403, 'Device identity mismatch');
    return this.store.run(async (tx) => {
      const old = await this.tvDevice(tx, principal);
      const now = this.now();
      const next: StoredDevice = {
        ...old, ...registration, deviceId: old.deviceId, authUid: old.authUid,
        type: 'tv', name: old.name, room: old.room ?? 'Bedroom', doNotDisturb: old.doNotDisturb, autoAccept: old.autoAccept ?? false,
        activeCallId: old.activeCallId, fcmToken: registration.fcmToken ?? old.fcmToken,
        createdAt: old.createdAt, lastSeen: now, updatedAt: now, schemaVersion: 1,
      };
      tx.set(`users/${principal.ownerUid}/devices/${principal.deviceId}`, next);
      return publicDevice(next);
    });
  }
  async updateTvSettings(principal: TvPrincipal, changes: { name?: string; room?: string | null; doNotDisturb?: boolean; autoAccept?: boolean }) {
    return this.store.run(async (tx) => {
      const device = await this.tvDevice(tx, principal);
      const next = { ...device, ...changes, updatedAt: this.now(), lastSeen: this.now() };
      tx.set(`users/${principal.ownerUid}/devices/${principal.deviceId}`, next);
      return publicDevice(next);
    });
  }
  async devices(ownerUid: string) {
    return this.store.run(async (tx) => (await tx.list<StoredDevice>(`users/${ownerUid}/devices`))
      .filter((d) => d.type === 'tv').map(publicDevice).sort((a, b) => a.name.localeCompare(b.name)));
  }
  async updateDevice(ownerUid: string, deviceId: string, changes: { name?: string; room?: string | null }) {
    return this.store.run(async (tx) => {
      const device = await this.ownedDevice(tx, ownerUid, deviceId);
      const next = { ...device, ...changes, updatedAt: this.now() };
      tx.set(`users/${ownerUid}/devices/${deviceId}`, next);
      return publicDevice(next);
    });
  }
  async removeDevice(ownerUid: string, deviceId: string) {
    const authUid = await this.store.run(async (tx) => {
      const device = await this.ownedDevice(tx, ownerUid, deviceId);
      const call = device.activeCallId ? await tx.get<Call>(`calls/${device.activeCallId}`) : undefined;
      if (call && ['ringing', 'accepted'].includes(call.status))
        tx.set(`calls/${call.id}`, { ...call, status: 'ended', updatedAt: this.now(), error: 'device-removed' });
      tx.delete(`users/${ownerUid}/devices/${deviceId}`);
      tx.delete(`deviceOwners/${deviceId}`);
      return { uid: device.authUid, callId: device.activeCallId };
    });
    if (authUid.callId) await this.cleanupMedia(authUid.callId);
    await this.auth.revoke(authUid.uid);
    try { await this.auth.deleteUser(authUid.uid); } catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    }
  }
  async active(principal: TvPrincipal) {
    return this.store.run(async (tx) => {
      const device = await this.tvDevice(tx, principal);
      if (!device.activeCallId) return null;
      const raw = await tx.get<Call>(`calls/${device.activeCallId}`);
      if (!raw) return null;
      const current = live(raw, this.now());
      if (current.status !== raw.status) tx.set(`calls/${raw.id}`, current);
      return ['ringing', 'accepted'].includes(current.status) ? current : null;
    });
  }
  async create(ownerUid: string, deviceId: string) {
    const id = randomUUID();
    const { call, token } = await this.store.run(async (tx) => {
      const device = await this.ownedDevice(tx, ownerUid, deviceId);
      const now = this.now();
      const terminal = (status: 'declined' | 'busy'): Call => ({
        id, deviceId, ownerUid, callerUid: ownerUid, status, createdAt: now,
        expiresAt: now, delivery: 'not-sent', updatedAt: now,
      });
      if (device.doNotDisturb) {
        const call = terminal('declined'); tx.set(`calls/${id}`, call); return { call, token: null };
      }
      const old = device.activeCallId ? await tx.get<Call>(`calls/${device.activeCallId}`) : undefined;
      const current = old && live(old, now);
      if (current && ['ringing', 'accepted'].includes(current.status)) {
        const call = terminal('busy'); tx.set(`calls/${id}`, call); return { call, token: null };
      }
      if (!device.fcmToken) throw new Fault(409, 'TV push token unavailable; reopen HomePing on the TV');
      const call: Call = {
        id, deviceId, ownerUid, callerUid: ownerUid, status: 'ringing',
        createdAt: now, expiresAt: now + 60_000, ...(device.autoAccept ? { autoAcceptUntil: now + 70_000 } : {}), delivery: 'pending', updatedAt: now,
      };
      if (old && current && old.status !== current.status) tx.set(`calls/${old.id}`, current);
      tx.set(`calls/${id}`, call);
      tx.set(`users/${ownerUid}/devices/${deviceId}`, { ...device, activeCallId: id });
      return { call, token: device.fcmToken };
    });
    if (!token) return call;
    try {
      await this.push.send(token, { type: 'invite', callId: id, expiresAt: String(call.expiresAt) }, Math.max(0, call.expiresAt - this.now()));
      await this.store.run(async (tx) => {
        const current = await tx.get<Call>(`calls/${id}`);
        if (current) tx.set(`calls/${id}`, { ...current, delivery: 'submitted' });
      });
    } catch (error) {
      const code = String((error as { code?: string }).code ?? 'push-send-failed');
      await this.store.run(async (tx) => {
        const current = await tx.get<Call>(`calls/${id}`);
        const device = await tx.get<StoredDevice>(`users/${ownerUid}/devices/${deviceId}`);
        if (current) tx.set(`calls/${id}`, { ...current, delivery: 'failed', status: current.status === 'ringing' ? 'failed' : current.status, error: code, updatedAt: this.now() });
        if (device && device.fcmToken === token && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code))
          tx.set(`users/${ownerUid}/devices/${deviceId}`, { ...device, fcmToken: null });
      });
    }
    return this.get({ kind: 'human', uid: ownerUid, email: '' }, id);
  }
  async get(principal: Principal, id: string) {
    const result = await this.store.run(async (tx) => {
      const call = await tx.get<Call>(`calls/${id}`);
      if (!call) throw new Fault(404, 'Call not found');
      const allowed = principal.kind === 'human' ? principal.uid === call.ownerUid :
        principal.ownerUid === call.ownerUid && principal.deviceId === call.deviceId;
      if (!allowed) throw new Fault(403, 'Not your call');
      if (principal.kind === 'tv') await this.tvDevice(tx, principal);
      const current = live(call, this.now());
      if (current.status !== call.status) tx.set(`calls/${id}`, current);
      return current;
    });
    if (result.status === 'ended') await this.cleanupMedia(id);
    return result;
  }
  private async cleanupMedia(id: string) {
    try { await this.closeMedia(id); }
    catch { console.error('LiveKit room cleanup failed; next status read will retry'); }
  }
  async mediaSession(principal: Principal, id: string, heartbeat = false) {
    const call = await this.get(principal, id);
    if (call.status !== 'accepted') throw new Fault(409, `Call is ${call.status}`);
    return this.store.run(async (tx) => {
      // Recheck ownership and state within the same transaction as the lease.
      const device = await this.ownedDevice(tx, call.ownerUid, call.deviceId);
      if (principal.kind === 'tv' && device.authUid !== principal.uid) throw new Fault(403, 'TV authorization was removed');
      const raw = await tx.get<Call>(`calls/${id}`);
      if (!raw || live(raw, this.now()).status !== 'accepted') throw new Fault(409, 'Call is no longer accepted');
      if (!heartbeat) return raw;
      const next = { ...raw, [principal.kind === 'tv' ? 'tvSeenAt' : 'callerSeenAt']: this.now() };
      next.mediaDeadline = Math.min(next.callerSeenAt ?? 0, next.tvSeenAt ?? 0) + 90_000;
      tx.set(`calls/${id}`, next);
      return next;
    });
  }
  async action(principal: Principal, id: string, action: 'receive' | 'accept' | 'auto-accept' | 'decline' | 'cancel' | 'end') {
    const result = await this.store.run(async (tx) => {
      const raw = await tx.get<Call>(`calls/${id}`);
      if (!raw) throw new Fault(404, 'Call not found');
      const tvAction = ['receive', 'accept', 'auto-accept', 'decline'].includes(action) || (action === 'end' && principal.kind === 'tv');
      if (tvAction) {
        if (principal.kind !== 'tv' || principal.ownerUid !== raw.ownerUid || principal.deviceId !== raw.deviceId)
          throw new Fault(403, 'Action forbidden');
        await this.tvDevice(tx, principal);
      } else if (principal.kind !== 'human' || principal.uid !== raw.ownerUid) throw new Fault(403, 'Action forbidden');
      const path = `users/${raw.ownerUid}/devices/${raw.deviceId}`;
      const device = await tx.get<StoredDevice>(path);
      let call = live(raw, this.now());
      if (action === 'auto-accept' && call.status !== 'accepted') {
        if (!device?.autoAccept || device.doNotDisturb || !call.autoAcceptUntil || !call.receivedAt ||
            this.now() >= call.autoAcceptUntil || call.status !== 'ringing')
          throw new Fault(409, 'Automatic acceptance is unavailable');
        if (this.now() < call.expiresAt) throw new Fault(409, 'Auto-accept is not due yet');
      }
      if (action === 'accept' && call.status === 'ringing' && this.now() >= call.expiresAt)
        throw new Fault(409, 'Manual ringing deadline passed');
      const target = { 'auto-accept': 'accepted', accept: 'accepted', decline: 'declined', cancel: 'cancelled', end: 'ended' } as const;
      if (action === 'receive') {
        if (call.status === 'ringing' && !call.receivedAt) call = { ...call, receivedAt: this.now(), updatedAt: this.now() };
      } else if (call.status === target[action]) {
        // idempotent retry
      } else if ((call.status === 'ringing' && ['accept', 'auto-accept', 'decline', 'cancel'].includes(action)) || (call.status === 'accepted' && action === 'end')) {
        call = { ...call, status: target[action], updatedAt: this.now(),
          ...(['accept', 'auto-accept'].includes(action) ? { acceptedAt: this.now(), callerSeenAt: this.now(), tvSeenAt: this.now(), mediaDeadline: this.now() + 90_000 } : {}),
        };
      } else {
        if (call.status !== raw.status) tx.set(`calls/${id}`, call);
        return { call, conflict: true, token: device?.fcmToken };
      }
      tx.set(`calls/${id}`, call);
      if (device && !['ringing', 'accepted'].includes(call.status) && device.activeCallId === id)
        tx.set(path, { ...device, activeCallId: null });
      return { call, conflict: false, token: device?.fcmToken };
    });
    if (result.call.status === 'ended') await this.cleanupMedia(id);
    if (result.conflict) throw new Fault(409, `Call is ${result.call.status}`);
    if (action === 'cancel' && result.token) {
      try { await this.push.send(result.token, { type: 'cancel', callId: id, expiresAt: String(result.call.expiresAt) }, 0); } catch { /* polling reconciles */ }
    }
    return result.call;
  }
}
