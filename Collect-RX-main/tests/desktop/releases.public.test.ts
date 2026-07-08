import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server/index.js';

describe('GET /api/desktop/releases', () => {
  it('is public (no session required)', async () => {
    const res = await request(app).get('/api/desktop/releases');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
