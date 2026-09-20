/**
 * SendGrid inbound-parse router — defense-in-depth regression.
 *
 * The prospect lookup (`findUnique` / `findProspectByEmail`) ran as an
 * unguarded `await` inside this async route handler. Any error thrown from
 * that DB call — a transient connection failure, or a future data-shape
 * change — would have been an unhandled promise rejection, which this app's
 * `process.on('unhandledRejection', ...)` handler turns into
 * `process.exit(1)`, crashing the whole server over a single inbound email.
 * Wrapping the lookup in try/catch keeps that failure scoped to a 200
 * "ok" ack (SendGrid inbound parse expects 2xx or it retries) instead of
 * taking the process down.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createSendgridInboundRouter } from '../src/server/routes/sendgridInboundRouter.js';

function appWithFakePrisma(prisma: PrismaClient) {
  const app = express();
  app.use('/api/webhooks/sendgrid-inbound', createSendgridInboundRouter(prisma));
  return app;
}

describe('sendgrid inbound router — prospect lookup failure', () => {
  it('returns 200 instead of crashing when the prospect lookup throws', async () => {
    const prisma = {
      prospect: {
        findUnique: vi.fn().mockRejectedValue(new Error('connection reset')),
      },
    } as unknown as PrismaClient;
    const app = appWithFakePrisma(prisma);

    const res = await request(app)
      .post('/api/webhooks/sendgrid-inbound')
      .field('from', 'Someone <someone@example.com>')
      .field('text', 'hello')
      .field('headers', 'X-Prospect-Id: prospect-123');

    expect(res.status).toBe(200);
  });

  it('acks 200 when no prospect matches (existing behavior preserved)', async () => {
    const prisma = {
      prospect: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;
    const app = appWithFakePrisma(prisma);

    const res = await request(app)
      .post('/api/webhooks/sendgrid-inbound')
      .field('from', 'Someone <someone@example.com>')
      .field('text', 'hello')
      .field('headers', 'X-Prospect-Id: prospect-123');

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
    expect(prisma.prospect.findUnique).toHaveBeenCalledWith({ where: { id: 'prospect-123' } });
  });
});
