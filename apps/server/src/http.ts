import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Calls, Fault } from './service.js';
import type { PublicConfig } from '../../../packages/client/src/index.js';
export function appFor(
  calls: Calls,
  verify: (token: string) => Promise<string>,
  config: PublicConfig,
  webDirectory?: string,
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: process.env.WEB_ORIGIN?.split(',') ?? false }));
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/config', (_req, res) => {
    res.json(config);
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use('/api', async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) {
      next(new Fault(401, 'Authentication required'));
      return;
    }
    try {
      res.locals.uid = await verify(token);
      next();
    } catch {
      next(new Fault(401, 'Invalid or expired authentication'));
    }
  });
  const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
  const uid = (res: express.Response) => res.locals.uid as string;
  app.post('/api/devices/register', async (req, res) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(80),
        token: z.string().min(20).max(4096),
        hardware: z.record(z.string().max(80), z.string().max(500)).default({}),
      })
      .parse(req.body);
    res.json(await calls.register(uid(res), b.name, b.token, b.hardware));
  });
  const pairLimit = rateLimit({
    windowMs: 5 * 60_000,
    limit: 10,
    keyGenerator: (_req, res) => uid(res),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  app.post('/api/devices/pairing-code', pairLimit, async (_req, res) => {
    res.json(await calls.pairing(uid(res)));
  });
  app.post('/api/pair', pairLimit, async (req, res) => {
    const b = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    res.json(await calls.pair(uid(res), b.code));
  });
  app.get('/api/devices', async (_req, res) => {
    res.json(await calls.devices(uid(res)));
  });
  app.get('/api/devices/active-call', async (_req, res) => {
    res.json({ call: await calls.active(uid(res)) });
  });
  app.post('/api/calls', async (req, res) => {
    const b = z.object({ tvId: id }).parse(req.body);
    res.status(201).json(await calls.create(uid(res), b.tvId));
  });
  app.get('/api/calls/:id', async (req, res) => {
    res.json(await calls.get(uid(res), id.parse(req.params.id)));
  });
  app.post('/api/calls/:id/action', async (req, res) => {
    const b = z
      .object({
        action: z.enum(['receive', 'accept', 'reject', 'cancel', 'end']),
      })
      .parse(req.body);
    res.json(await calls.action(uid(res), id.parse(req.params.id), b.action));
  });
  if (webDirectory) app.use(express.static(webDirectory));
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({
            error: 'Invalid request',
            details: error.issues.map((i) => ({
              path: i.path,
              message: i.message,
            })),
          });
        return;
      }
      if (error instanceof Fault) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof SyntaxError) {
        res.status(400).json({ error: 'Invalid JSON' });
        return;
      }
      console.error(
        'Request failed',
        error instanceof Error ? error.name : 'unknown',
      );
      res.status(500).json({ error: 'Internal server error' });
    },
  );
  return app;
}
