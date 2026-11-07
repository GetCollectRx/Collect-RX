/**
 * In-process stand-in for the parts of Vapi's REST API the product uses:
 * create call, read call (with a control URL), list calls, delete recording,
 * and the live control URL itself. Mounted only in sandbox mode, where
 * VAPI_BASE_URL points here, so the product's real Vapi client code runs
 * unchanged against the carrier simulator.
 */
import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { carrierSimulator, type CarrierSimulator } from './carrierSimulator.js';
import { SANDBOX_VAPI_PATH, sandboxLocalOrigin } from './sandboxMode.js';

function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function hasBearer(req: Request): boolean {
  return /^Bearer\s+\S+/u.test(req.header('authorization') ?? '');
}

/**
 * Only the process itself may use the mock: on Fly, outside traffic arrives
 * through the proxy from a private address, never from loopback.
 */
export function isLoopbackRequest(req: Request): boolean {
  const addr = req.socket.remoteAddress ?? '';
  const forwarded = req.header('x-forwarded-for') ?? req.header('fly-client-ip');
  return !forwarded && (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1');
}

export function createMockVapiRouter(sim: CarrierSimulator = carrierSimulator): Router {
  const router = Router();
  router.use((req, res, next) => {
    if (!isLoopbackRequest(req)) {
      res.status(404).end();
      return;
    }
    next();
  });

  const callView = (id: string) => {
    const c = sim.get(id);
    if (!c) return null;
    return {
      id: c.vapiCallId,
      status: c.status,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      endedReason: c.endedReason,
      monitor: { controlUrl: `${sandboxLocalOrigin()}${SANDBOX_VAPI_PATH}/control/${c.vapiCallId}` },
    };
  };

  router.post('/call', (req: Request, res: Response) => {
    if (!hasBearer(req)) return res.status(401).json({ message: 'Unauthorized' });
    const body = record(req.body);
    if (typeof body.squadId !== 'string' || !record(body.assistantOverrides).metadata) {
      return res.status(400).json({ message: 'squadId and assistantOverrides.metadata are required' });
    }
    const id = `sbx-${randomUUID()}`;
    sim.start(id, body);
    return res.status(201).json({ id, status: 'queued', createdAt: new Date().toISOString() });
  });

  router.get('/call/:id', (req: Request, res: Response) => {
    if (!hasBearer(req)) return res.status(401).json({ message: 'Unauthorized' });
    const view = callView(req.params.id ?? '');
    return view ? res.json(view) : res.status(404).json({ message: 'Call not found' });
  });

  router.get('/call', (req: Request, res: Response) => {
    if (!hasBearer(req)) return res.status(401).json({ message: 'Unauthorized' });
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
    return res.json(sim.list(limit).map((c) => callView(c.vapiCallId)));
  });

  router.delete('/call/:id/recording', (req: Request, res: Response) => {
    if (!hasBearer(req)) return res.status(401).json({ message: 'Unauthorized' });
    return res.status(204).end();
  });

  router.post('/control/:id', (req: Request, res: Response) => {
    const id = req.params.id ?? '';
    const body = record(req.body);
    if (body.type === 'transfer') {
      const number = record(body.destination).number;
      if (typeof number !== 'string') return res.status(400).json({ error: 'destination.number is required' });
      return sim.transfer(id, number) ? res.json({}) : res.status(409).json({ error: 'call cannot be transferred now' });
    }
    if (body.type === 'end-call') {
      sim.hangUp(id);
      return res.json({});
    }
    return res.status(400).json({ error: 'unsupported control command' });
  });

  return router;
}
