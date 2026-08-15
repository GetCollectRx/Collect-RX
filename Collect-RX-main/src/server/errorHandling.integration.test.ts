/**
 * Error Handling Integration Tests
 *
 * Tests that the global error handler properly sanitizes error messages
 * and never leaks database details, API keys, PII/PHI, or stack traces to clients.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { globalErrorHandler } from './middleware/errorRedaction.js';

/**
 * Create a minimal Express app with the error handler for testing.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Route that throws a database error
  app.get('/api/test/db-error', (_req: Request, _res: Response) => {
    const err = new Error('ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:5432');
    (err as any).statusCode = 500;
    throw err;
  });

  // Route that throws a SQL error
  app.get('/api/test/sql-error', (_req: Request, _res: Response) => {
    const err = new Error('syntax error at or near "SELECT"');
    (err as any).statusCode = 500;
    throw err;
  });

  // Route that throws a schema error
  app.get('/api/test/schema-error', (_req: Request, _res: Response) => {
    const err = new Error('column "patientId" does not exist');
    (err as any).statusCode = 500;
    throw err;
  });

  // Route that throws an API key error
  app.get('/api/test/api-key-error', (_req: Request, _res: Response) => {
    const err = new Error('Invalid API key: sk_live_abc123def456');
    (err as any).statusCode = 401;
    throw err;
  });

  // Route that throws a password error
  app.get('/api/test/password-error', (_req: Request, _res: Response) => {
    const err = new Error('Password authentication failed for user postgres');
    (err as any).statusCode = 401;
    throw err;
  });

  // Route that throws a stack trace error
  app.get('/api/test/stack-trace-error', (_req: Request, _res: Response) => {
    const err = new Error('Something went wrong');
    err.stack = `Error: Something went wrong
    at Object.<anonymous> (/app/src/routes/claims.ts:42:15)
    at processRequest (/app/src/server.ts:120:8)`;
    (err as any).statusCode = 500;
    throw err;
  });

  // Route that throws a PII error
  app.get('/api/test/pii-error', (_req: Request, _res: Response) => {
    const err = new Error('Patient 123-45-6789 not found');
    (err as any).statusCode = 404;
    throw err;
  });

  // Route that throws a 404
  app.get('/api/test/not-found', (_req: Request, _res: Response) => {
    const err = new Error('Resource not found');
    (err as any).statusCode = 404;
    throw err;
  });

  // Route that throws a 403
  app.get('/api/test/forbidden', (_req: Request, _res: Response) => {
    const err = new Error('Access denied');
    (err as any).statusCode = 403;
    throw err;
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    globalErrorHandler(err, req, res, next);
  });

  return app;
}

describe('Error Handler Integration Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('Database error redaction', () => {
    it('should sanitize connection refused errors', async () => {
      const res = await request(app).get('/api/test/db-error');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('correlationId');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body.error).not.toMatch(/ECONNREFUSED/i);
      expect(res.body.error).toMatch(/error occurred processing/i);
    });

    it('should sanitize SQL errors', async () => {
      const res = await request(app).get('/api/test/sql-error');

      expect(res.status).toBe(500);
      expect(res.body.error).not.toMatch(/sql/i);
      expect(res.body.error).not.toMatch(/syntax error/i);
    });

    it('should sanitize schema errors', async () => {
      const res = await request(app).get('/api/test/schema-error');

      expect(res.status).toBe(500);
      expect(res.body.error).not.toMatch(/column/i);
      expect(res.body.error).not.toMatch(/patientId/);
    });
  });

  describe('Credentials redaction', () => {
    it('should sanitize API key errors', async () => {
      const res = await request(app).get('/api/test/api-key-error');

      expect(res.status).toBe(401);
      expect(res.body.error).not.toMatch(/api[_-]?key/i);
      expect(res.body.error).not.toMatch(/sk_live/);
    });

    it('should sanitize password errors', async () => {
      const res = await request(app).get('/api/test/password-error');

      expect(res.status).toBe(401);
      expect(res.body.error).not.toMatch(/password/i);
    });
  });

  describe('Stack trace redaction', () => {
    it('should sanitize stack traces', async () => {
      const res = await request(app).get('/api/test/stack-trace-error');

      expect(res.status).toBe(500);
      expect(res.body.error).not.toMatch(/\/app\//);
      expect(res.body.error).not.toMatch(/\.ts:\d+:\d+/);
      expect(res.body).not.toHaveProperty('stack');
    });
  });

  describe('PII/PHI redaction', () => {
    it('should sanitize SSN-like patterns', async () => {
      const res = await request(app).get('/api/test/pii-error');

      expect(res.status).toBe(404);
      expect(res.body.error).not.toMatch(/\d{3}-\d{2}-\d{4}/);
      expect(res.body.error).not.toMatch(/123-45-6789/);
    });
  });

  describe('Proper status code handling', () => {
    it('should return 404 with safe message', async () => {
      const res = await request(app).get('/api/test/not-found');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not found');
    });

    it('should return 403 with safe message', async () => {
      const res = await request(app).get('/api/test/forbidden');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });
  });

  describe('Correlation ID tracking', () => {
    it('should include correlation ID in response', async () => {
      const res = await request(app).get('/api/test/db-error');

      expect(res.body).toHaveProperty('correlationId');
      expect(res.body.correlationId).toBeTruthy();
      expect(typeof res.body.correlationId).toBe('string');
    });

    it('should include timestamp in response', async () => {
      const res = await request(app).get('/api/test/db-error');

      expect(res.body).toHaveProperty('timestamp');
      expect(() => new Date(res.body.timestamp)).not.toThrow();
    });

    it('should always include success: false', async () => {
      const res = await request(app).get('/api/test/db-error');

      expect(res.body.success).toBe(false);
    });
  });

  describe('Response structure', () => {
    it('should return well-formed error response', async () => {
      const res = await request(app).get('/api/test/db-error');

      expect(res.body).toEqual({
        success: false,
        error: expect.any(String),
        correlationId: expect.any(String),
        timestamp: expect.any(String),
      });

      // Verify no extra fields are present
      expect(Object.keys(res.body).length).toBe(4);
    });
  });
});
