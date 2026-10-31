import express from 'express';
import cors from 'cors';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { Calls, Fault, type Principal, type TvPrincipal } from './service.js';
import type { PublicConfig } from '../../../packages/client/src/index.js';
import { Media } from './media.js';
import { authenticationFault } from './auth.js';

const identifier = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/);
const deviceId = z.string().uuid();
const registration = z.object({
  deviceId,
  manufacturer: z.string().max(120),
  model: z.string().max(120),
  androidVersion: z.string().max(80),
  apiLevel: z.number().int().min(1).max(1000),
  screenWidthPx: z.number().int().min(1).max(100000),
  screenHeightPx: z.number().int().min(1).max(100000),
  firmwareFingerprint: z.string().max(1000),
  builtInCameraAvailable: z.boolean(),
  usbHostSupported: z.boolean(),
  usbCameraAttached: z.boolean(),
  cameraApiCount: z.number().int().min(0).max(100),
  fcmToken: z.string().min(20).max(4096).nullable().optional(),
}).strict();
const settings = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  room: z.string().trim().max(80).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

export function appFor(
  calls: Calls,
  verify: (token: string) => Promise<Principal>,
  config: PublicConfig,
  webDirectory?: string,
  media = new Media(),
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: process.env.WEB_ORIGIN?.split(',') ?? false }));
  app.use(express.json({ limit: '20kb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json(config));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));

  const authorizationStartLimit = rateLimit({
    windowMs: 10 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? 'unknown')}:${String(req.body?.registration?.deviceId ?? '')}`,
  });
  app.post('/api/device-authorizations', authorizationStartLimit, async (req, res) => {
    const body = z.object({ registration, deviceSecret: z.string().min(32).max(256) }).strict().parse(req.body);
    res.status(201).json(await calls.beginAuthorization(body.registration, body.deviceSecret));
  });
  const pollLimit = rateLimit({
    windowMs: 5_000, limit: 1, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? 'unknown')}:${String(req.body?.authorizationId ?? '')}`,
  });
  app.post('/api/device-authorizations/poll', pollLimit, async (req, res) => {
    const body = z.object({ authorizationId: z.string().uuid(), deviceSecret: z.string().min(32).max(256) }).strict().parse(req.body);
    res.json(await calls.pollAuthorization(body.authorizationId, body.deviceSecret));
  });

  app.use('/api', async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return next(new Fault(401, 'Authentication required'));
    try { res.locals.principal = await verify(token); next(); }
    catch (error) { next(authenticationFault(error)); }
  });
  const principal = (res: express.Response) => res.locals.principal as Principal;
  const human = (res: express.Response) => {
    const p = principal(res);
    if (p.kind !== 'human') throw new Fault(403, 'Human account required');
    return p;
  };
  const tv = (res: express.Response) => {
    const p = principal(res);
    if (p.kind !== 'tv') throw new Fault(403, 'TV authorization required');
    return p as TvPrincipal;
  };
  app.post('/api/account', async (_req, res) => res.json(await calls.account(human(res))));
  const approvalLimit = rateLimit({
    windowMs: 10 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (_req, res) => (res.locals.principal as Principal).uid,
  });
  app.post('/api/device-authorizations/inspect', approvalLimit, async (req, res) => {
    const body = z.object({ code: z.string().min(8).max(16) }).strict().parse(req.body);
    human(res);
    res.json(await calls.authorizationPreview(body.code));
  });
  app.post('/api/device-authorizations/approve', approvalLimit, async (req, res) => {
    const body = z.object({ code: z.string().min(8).max(16) }).strict().parse(req.body);
    res.json(await calls.approveAuthorization(human(res).uid, body.code));
  });
  app.post('/api/tv/register', async (req, res) => res.json(await calls.registerTv(tv(res), registration.parse(req.body))));
  app.patch('/api/tv/settings', async (req, res) => {
    const body = settings.extend({ doNotDisturb: z.boolean().optional(), autoAccept: z.boolean().optional() }).parse(req.body);
    res.json(await calls.updateTvSettings(tv(res), body));
  });
  app.get('/api/tv/active-call', async (_req, res) => res.json({ call: await calls.active(tv(res)) }));
  app.get('/api/devices', async (_req, res) => res.json(await calls.devices(human(res).uid)));
  app.patch('/api/devices/:deviceId', async (req, res) =>
    res.json(await calls.updateDevice(human(res).uid, deviceId.parse(req.params.deviceId), settings.parse(req.body))));
  app.delete('/api/devices/:deviceId', async (req, res) => {
    await calls.removeDevice(human(res).uid, deviceId.parse(req.params.deviceId)); res.status(204).end();
  });
  const callLimit = rateLimit({
    windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (_req, res) => (res.locals.principal as Principal).uid,
  });
  const callHourLimit = rateLimit({
    windowMs: 60 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (_req, res) => (res.locals.principal as Principal).uid,
  });
  app.post('/api/devices/:deviceId/calls', callLimit, callHourLimit, async (req, res) =>
    res.status(201).json(await calls.create(human(res).uid, deviceId.parse(req.params.deviceId))));
  app.get('/api/calls/:id', async (req, res) => res.json(await calls.get(principal(res), identifier.parse(req.params.id))));
  const mediaLimit = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (_req, res) => (res.locals.principal as Principal).uid });
  app.post('/api/calls/:id/media', mediaLimit, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await media.join(calls, principal(res), identifier.parse(req.params.id)));
  });
  app.post('/api/calls/:id/heartbeat', async (req, res) =>
    res.json(await calls.mediaSession(principal(res), identifier.parse(req.params.id), true)));
  app.post('/api/calls/:id/action', async (req, res) => {
    const body = z.object({ action: z.enum(['receive', 'accept', 'auto-accept', 'decline', 'cancel', 'end']) }).strict().parse(req.body);
    res.json(await calls.action(principal(res), identifier.parse(req.params.id), body.action));
  });
  if (webDirectory) app.use(express.static(webDirectory));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.issues.map((i) => ({ path: i.path, message: i.message })) }); return;
    }
    if (error instanceof Fault) {
      res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) }); return;
    }
    if (error instanceof SyntaxError) { res.status(400).json({ error: 'Invalid JSON' }); return; }
    console.error('Request failed', error instanceof Error ? error.name : 'unknown');
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
