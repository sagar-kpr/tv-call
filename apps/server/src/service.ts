import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Call } from '../../../packages/client/src/index.js';
import type { Store, Transaction } from './store.js';
export class Fault extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface Push {
  send(token: string, data: Record<string, string>, ttl: number): Promise<void>;
}
type Device = {
  uid: string;
  name: string;
  token: string;
  activeCallId: string | null;
  updatedAt: number;
  hardware: Record<string, string>;
};
type Pairing = { tvId: string; expiresAt: number };
type Grant = { tvId: string; name: string };
type Caller = { devices: Grant[] };
const digest = (code: string) =>
  createHash('sha256').update(code).digest('hex');
const live = (call: Call, now: number): Call =>
  call.status === 'ringing' && call.expiresAt <= now
    ? { ...call, status: 'expired', updatedAt: now }
    : call;
export class Calls {
  constructor(
    private store: Store,
    private push: Push,
    private now = Date.now,
    private code = () => String(randomInt(100000, 1000000)),
  ) {}
  async register(
    uid: string,
    name: string,
    token: string,
    hardware: Record<string, string>,
  ) {
    return this.store.run(async (tx) => {
      const old = await tx.get<Device>(`devices/${uid}`);
      tx.set(`devices/${uid}`, {
        uid,
        name,
        token,
        hardware,
        activeCallId: old?.activeCallId ?? null,
        updatedAt: this.now(),
      });
      return { tvId: uid };
    });
  }
  async pairing(uid: string) {
    // Random collisions are retried instead of overwriting another TV's pairing code.
    for (let i = 0; i < 8; i++) {
      const code = this.code();
      const path = `pairings/${digest(code)}`;
      const result = await this.store.run(async (tx) => {
        if (!(await tx.get<Device>(`devices/${uid}`)))
          throw new Fault(404, 'Register TV first');
        const old = await tx.get<Pairing>(path);
        if (old && old.expiresAt > this.now()) return null;
        const expiresAt = this.now() + 5 * 60_000;
        tx.set(path, { tvId: uid, expiresAt });
        return { code, expiresAt };
      });
      if (result) return result;
    }
    throw new Fault(503, 'Try generating a pairing code again');
  }
  async pair(uid: string, code: string) {
    return this.store.run(async (tx) => {
      const pair = await tx.get<Pairing>(`pairings/${digest(code)}`);
      if (!pair || pair.expiresAt <= this.now())
        throw new Fault(400, 'Invalid or expired pairing code');
      const device = await tx.get<Device>(`devices/${pair.tvId}`);
      const caller = (await tx.get<Caller>(`callers/${uid}`)) ?? {
        devices: [],
      };
      if (!device) throw new Fault(404, 'TV not registered');
      const grant = { tvId: pair.tvId, name: device.name };
      tx.set(`callers/${uid}`, {
        devices: [...caller.devices.filter((d) => d.tvId !== pair.tvId), grant],
      });
      return grant;
    });
  }
  async devices(uid: string) {
    return this.store.run(
      async (tx) => (await tx.get<Caller>(`callers/${uid}`))?.devices ?? [],
    );
  }
  async active(uid: string) {
    return this.store.run(async (tx) => {
      const device = await tx.get<Device>(`devices/${uid}`);
      if (!device?.activeCallId) return null;
      const raw = await tx.get<Call>(`calls/${device.activeCallId}`);
      if (!raw) return null;
      const current = live(raw, this.now());
      if (current.status !== raw.status) tx.set(`calls/${raw.id}`, current);
      return ['ringing', 'accepted'].includes(current.status) ? current : null;
    });
  }
  private async authorized(tx: Transaction, uid: string, tvId: string) {
    const caller = await tx.get<Caller>(`callers/${uid}`);
    if (!caller?.devices.some((d) => d.tvId === tvId))
      throw new Fault(403, 'Pair with this TV first');
  }
  async create(uid: string, tvId: string) {
    const id = randomUUID();
    const { call, token } = await this.store.run(async (tx) => {
      await this.authorized(tx, uid, tvId);
      const device = await tx.get<Device>(`devices/${tvId}`);
      if (!device?.token)
        throw new Fault(409, 'TV push token unavailable; reopen TV setup');
      const old = device.activeCallId
        ? await tx.get<Call>(`calls/${device.activeCallId}`)
        : undefined;
      const current = old && live(old, this.now());
      if (current && ['ringing', 'accepted'].includes(current.status))
        throw new Fault(409, 'TV already has an active invitation or call');
      const now = this.now();
      const call: Call = {
        id,
        tvId,
        callerId: uid,
        status: 'ringing',
        createdAt: now,
        expiresAt: now + 30_000,
        delivery: 'pending',
        updatedAt: now,
      };
      if (old && current && old.status !== current.status)
        tx.set(`calls/${old.id}`, current);
      tx.set(`calls/${id}`, call);
      tx.set(`devices/${tvId}`, { ...device, activeCallId: id });
      return { call, token: device.token };
    });
    try {
      await this.push.send(
        token,
        { type: 'invite', callId: id, expiresAt: String(call.expiresAt) },
        Math.max(0, call.expiresAt - this.now()),
      );
      await this.store.run(async (tx) => {
        const current = await tx.get<Call>(`calls/${id}`);
        if (current)
          tx.set(`calls/${id}`, { ...current, delivery: 'submitted' });
      });
    } catch (error) {
      const code = String(
        (error as { code?: string }).code ?? 'push-send-failed',
      );
      await this.store.run(async (tx) => {
        const current = await tx.get<Call>(`calls/${id}`);
        const device = await tx.get<Device>(`devices/${tvId}`);
        if (current)
          tx.set(`calls/${id}`, {
            ...current,
            delivery: 'failed',
            status: current.status === 'ringing' ? 'failed' : current.status,
            error: code,
            updatedAt: this.now(),
          });
        if (
          device &&
          device.token === token &&
          [
            'messaging/registration-token-not-registered',
            'messaging/invalid-registration-token',
          ].includes(code)
        )
          tx.set(`devices/${tvId}`, { ...device, token: '' });
      });
    }
    return this.get(uid, id);
  }
  async get(uid: string, id: string) {
    return this.store.run(async (tx) => {
      const call = await tx.get<Call>(`calls/${id}`);
      if (!call) throw new Fault(404, 'Call not found');
      if (uid !== call.tvId && uid !== call.callerId)
        throw new Fault(403, 'Not your call');
      const current = live(call, this.now());
      if (current.status !== call.status) tx.set(`calls/${id}`, current);
      return current;
    });
  }
  async action(
    uid: string,
    id: string,
    action: 'receive' | 'accept' | 'reject' | 'cancel' | 'end',
  ) {
    const result = await this.store.run(async (tx) => {
      const raw = await tx.get<Call>(`calls/${id}`);
      if (!raw) throw new Fault(404, 'Call not found');
      const tvAction = ['receive', 'accept', 'reject', 'end'].includes(action);
      if (tvAction ? uid !== raw.tvId : uid !== raw.callerId)
        throw new Fault(403, 'Action forbidden');
      const device = await tx.get<Device>(`devices/${raw.tvId}`);
      let call = live(raw, this.now());
      const target = {
        accept: 'accepted',
        reject: 'rejected',
        cancel: 'cancelled',
        end: 'ended',
      } as const;
      if (action === 'receive') {
        if (call.status === 'ringing' && !call.receivedAt)
          call = { ...call, receivedAt: this.now(), updatedAt: this.now() };
      } else if (call.status === target[action]) {
        /* idempotent retry */
      } else if (
        (call.status === 'ringing' &&
          ['accept', 'reject', 'cancel'].includes(action)) ||
        (call.status === 'accepted' && action === 'end')
      )
        call = { ...call, status: target[action], updatedAt: this.now() };
      else {
        if (call.status !== raw.status) tx.set(`calls/${id}`, call);
        return { call, conflict: true, token: device?.token };
      }
      tx.set(`calls/${id}`, call);
      return { call, conflict: false, token: device?.token };
    });
    if (result.conflict) throw new Fault(409, `Call is ${result.call.status}`);
    if (action === 'cancel' && result.token) {
      try {
        await this.push.send(
          result.token,
          {
            type: 'cancel',
            callId: id,
            expiresAt: String(result.call.expiresAt),
          },
          0,
        );
      } catch {
        /* TV also polls authoritative state */
      }
    }
    return result.call;
  }
}
