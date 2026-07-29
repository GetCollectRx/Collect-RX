/**
 * The global error handler used to return 500 for every error, including
 * body-parser client errors. That reported the server as broken when the
 * request was malformed, and buried real faults among routine bad input.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describe('global error handler status mapping', () => {
  it('reports malformed JSON as 400, not 500', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "unterminated');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('reports an oversized payload as 413, not 500', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(3 * 1024 * 1024) }));

    expect(res.status).toBe(413);
  });
});
