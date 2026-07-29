/**
 * Batch DSO import serialises CSV rows to JSON, which inflates well past the
 * raw file size, so the 2mb global cap made the batch path reject payloads the
 * per-practice multipart route (12mb per file) accepts — a 7-location import
 * 413'd while importing each location one at a time worked.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

/** ~3mb of JSON — over the 2mb global cap, under the batch route's own ceiling. */
function oversizedBody(): string {
  return JSON.stringify({ imports: [{ padding: 'x'.repeat(3 * 1024 * 1024) }] });
}

describe('batch import body limit', () => {
  it('accepts a payload over the global cap on the batch import route', async () => {
    const res = await request(app)
      .post('/api/group/pms-import')
      .set('Content-Type', 'application/json')
      .send(oversizedBody());

    // Rejected for auth, not size — proves the body was parsed rather than
    // refused by the body parser.
    expect(res.status).not.toBe(413);
    expect([401, 403]).toContain(res.status);
  });

  it('still enforces the global cap on other API routes', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(oversizedBody());

    expect(res.status).toBe(413);
  });
});
