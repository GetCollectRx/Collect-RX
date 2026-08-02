/**
 * P2-09: health-check endpoints — liveness, readiness, and metrics.
 *
 * These run without live infrastructure: ClickHouse defaults to "mock mode" when
 * CLICKHOUSE_URL is unset (see productAnalytics/clickhouse.ts), and queue health
 * (a live-DB dependency inside /api/health/metrics) is mocked here so the metrics
 * assertions don't depend on a reachable Postgres instance. /api/health/ready's
 * DB-unreachable path is exercised directly by mocking prisma.$queryRaw.
 */
import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { app, prisma } from './index.js'

vi.mock('./observability/queueHealth.js', () => ({
  getQueueHealth: vi.fn().mockResolvedValue({
    duePendingCount: 0,
    oldestDuePendingAgeMinutes: null,
    openCallAttempts: 0,
    oldestOpenAttemptAgeMinutes: null,
    withinCallWindow: false,
  }),
}))

describe('GET /api/health', () => {
  it('returns 200 with ok status', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.service).toBe('collectrx-api')
    expect(typeof res.body.ts).toBe('string')
    expect(['connected', 'mock', 'unavailable']).toContain(res.body.clickhouse)
  })
})

describe('GET /api/health/ready', () => {
  it('returns 200 with status ready when the database responds', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ '?column?': 1 }])
    const res = await request(app).get('/api/health/ready')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ready')
    spy.mockRestore()
  })

  it('returns 503 with status not_ready when the database is unreachable', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'))
    const res = await request(app).get('/api/health/ready')
    expect(res.status).toBe(503)
    expect(res.body.status).toBe('not_ready')
    spy.mockRestore()
  })
})

describe('GET /api/health/metrics', () => {
  it('returns 200 with a metrics body and queue health', async () => {
    const res = await request(app).get('/api/health/metrics')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.metrics).toBeDefined()
    expect(res.body.metrics.http).toBeDefined()
    expect(res.body.queue).toEqual({
      duePendingCount: 0,
      oldestDuePendingAgeMinutes: null,
      openCallAttempts: 0,
      oldestOpenAttemptAgeMinutes: null,
      withinCallWindow: false,
    })
  })

  it('falls back to queue: { error } when queue health lookup throws', async () => {
    const { getQueueHealth } = await import('./observability/queueHealth.js')
    vi.mocked(getQueueHealth).mockRejectedValueOnce(new Error('db unreachable'))
    const res = await request(app).get('/api/health/metrics')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.queue).toEqual({ error: 'unavailable' })
  })
})
