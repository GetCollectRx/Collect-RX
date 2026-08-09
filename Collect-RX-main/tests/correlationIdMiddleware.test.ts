/**
 * P0.3 — every HTTP request gets a correlation ID: reused from the incoming
 * header if the caller already set one, generated fresh otherwise, echoed
 * on the response, and available to every logger.*() call made while
 * handling the request via AsyncLocalStorage (see correlationContext.ts).
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Request, Response } from 'express';
import {
  correlationIdMiddleware,
  CORRELATION_ID_HEADER,
} from '../src/server/middleware/correlationId.js';
import { getCorrelationId } from '../src/server/observability/correlationContext.js';
import { app, prisma } from '../src/server/index.js';

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

function fakeReqRes(headers: Record<string, string> = {}) {
  const responseHeaders: Record<string, string> = {};
  const req = { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
  const res = {
    setHeader: (name: string, value: string) => {
      responseHeaders[name] = value;
    },
  } as unknown as Response;
  return { req, res, responseHeaders };
}

describe('correlationIdMiddleware — unit', () => {
  it('generates a fresh UUID when no incoming header is present', () => {
    const { req, res, responseHeaders } = fakeReqRes();
    let seenInsideNext: string | undefined;
    correlationIdMiddleware(req, res, () => {
      seenInsideNext = getCorrelationId();
    });
    expect(responseHeaders[CORRELATION_ID_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(seenInsideNext).toBe(responseHeaders[CORRELATION_ID_HEADER]);
  });

  it('reuses an incoming correlation ID instead of generating a new one', () => {
    const { req, res, responseHeaders } = fakeReqRes({ [CORRELATION_ID_HEADER]: 'caller-supplied-id' });
    correlationIdMiddleware(req, res, () => undefined);
    expect(responseHeaders[CORRELATION_ID_HEADER]).toBe('caller-supplied-id');
  });

  it('ignores a blank/whitespace-only incoming header and generates fresh', () => {
    const { req, res, responseHeaders } = fakeReqRes({ [CORRELATION_ID_HEADER]: '   ' });
    correlationIdMiddleware(req, res, () => undefined);
    expect(responseHeaders[CORRELATION_ID_HEADER]).not.toBe('   ');
    expect(responseHeaders[CORRELATION_ID_HEADER]).toBeTruthy();
  });

  it('makes the correlation ID visible inside next() but not after the call returns', () => {
    const { req, res } = fakeReqRes();
    correlationIdMiddleware(req, res, () => undefined);
    expect(getCorrelationId()).toBeUndefined();
  });
});

describe('correlationIdMiddleware — wired into the real app', () => {
  it('echoes a caller-supplied x-correlation-id on the response', async () => {
    const res = await request(app)
      .get('/api/health')
      .set(CORRELATION_ID_HEADER, 'integration-test-id-123');
    expect(res.headers[CORRELATION_ID_HEADER]).toBe('integration-test-id-123');
  });

  it('generates a correlation ID when the caller sends none', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers[CORRELATION_ID_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('gives two separate requests two different correlation IDs', async () => {
    const first = await request(app).get('/api/health');
    const second = await request(app).get('/api/health');
    expect(first.headers[CORRELATION_ID_HEADER]).not.toBe(second.headers[CORRELATION_ID_HEADER]);
  });
});
