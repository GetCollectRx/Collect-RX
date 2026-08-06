/**
 * P2-09: health-check endpoints — liveness, readiness, and metrics.
 *
 * These run without live infrastructure: ClickHouse defaults to "mock mode" when
 * CLICKHOUSE_URL is unset (see productAnalytics/clickhouse.ts), and queue health
 * (a live-DB dependency inside /api/health/metrics) is mocked here so the metrics
 * assertions don't depend on a reachable Postgres instance. /api/health/ready's
 * DB-unreachable path is exercised directly by mocking prisma.$queryRaw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { app, prisma } from './index.js'

vi.mock('./observability/queueHealth.js', () => ({
  getQueueHealth: vi.fn().mockResolvedValue({
    duePendingCount: 0,
    oldestDuePendingAgeMinutes: null,
    openCallAttempts: 0,
    oldestOpenAttemptAgeMinutes: null,
    withinCallWindow: false,
    lastSuccessfulTickAt: null,
    consecutiveTickFailures: 0,
    lastTickFailureAt: null,
  }),
}))

vi.mock('./observability/eventLoopHealth.js', () => ({
  getEventLoopHealth: vi.fn().mockReturnValue({
    meanMs: 1.2,
    p99Ms: 3.4,
    maxMs: 5.6,
    blocked: false,
  }),
}))

vi.mock('./jobs/arQueue.js', () => ({
  getQueueJobCounts: vi.fn().mockResolvedValue({
    queue: 'collectrx-ar',
    active: 0,
    waiting: 2,
    delayed: 1,
    failed: 0,
    completed: 40,
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
      lastSuccessfulTickAt: null,
      consecutiveTickFailures: 0,
      lastTickFailureAt: null,
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

describe('GET /api/health/live', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 200 alive when event-loop lag is below the blocked threshold', async () => {
    const res = await request(app).get('/api/health/live')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('alive')
    expect(res.body.eventLoopDelayMs).toEqual({ mean: 1.2, p99: 3.4, max: 5.6 })
    expect(typeof res.body.uptimeSec).toBe('number')
  })

  it('returns 503 blocked when event-loop lag is at/above the blocked threshold', async () => {
    const { getEventLoopHealth } = await import('./observability/eventLoopHealth.js')
    vi.mocked(getEventLoopHealth).mockReturnValueOnce({ meanMs: 900, p99Ms: 1800, maxMs: 2500, blocked: true })
    const res = await request(app).get('/api/health/live')
    expect(res.status).toBe(503)
    expect(res.body.status).toBe('blocked')
  })
})

describe('GET /api/diagnostics', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows access without a token outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const res = await request(app).get('/api/diagnostics')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.eventLoop).toEqual({ meanMs: 1.2, p99Ms: 3.4, maxMs: 5.6, blocked: false })
    expect(res.body.vapiCircuitBreaker).toBeDefined()
    expect(res.body.vapiCircuitBreaker.state).toBeDefined()
    expect(res.body.deskQueue).toBeDefined()
  })

  it('rejects requests with no token in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HEALTH_METRICS_TOKEN', 'diag-secret')
    const res = await request(app).get('/api/diagnostics')
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('rejects requests in production when HEALTH_METRICS_TOKEN itself was never configured (fails closed)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HEALTH_METRICS_TOKEN', '')
    const res = await request(app).get('/api/diagnostics').set('Authorization', 'Bearer anything')
    expect(res.status).toBe(401)
  })

  it('allows access in production with a matching bearer token', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HEALTH_METRICS_TOKEN', 'diag-secret')
    const res = await request(app)
      .get('/api/diagnostics')
      .set('Authorization', 'Bearer diag-secret')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('reports bullmq.configured: false when REDIS_URL is unset', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('REDIS_URL', '')
    const res = await request(app).get('/api/diagnostics')
    expect(res.status).toBe(200)
    expect(res.body.bullmq).toEqual({ configured: false })
  })

  it('reports bullmq job counts and DLQ pending count when REDIS_URL is set', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const spy = vi.spyOn(prisma.workerDeadLetter, 'count').mockResolvedValueOnce(3)
    const res = await request(app).get('/api/diagnostics')
    expect(res.status).toBe(200)
    expect(res.body.bullmq).toEqual({
      configured: true,
      jobCounts: { active: 0, waiting: 2, delayed: 1, failed: 0, completed: 40 },
      dlqPending: 3,
    })
    spy.mockRestore()
  })

  it('isolates a DB failure to database.ok:false rather than failing the whole snapshot', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('db down'))
    const res = await request(app).get('/api/diagnostics')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.database).toMatchObject({ ok: false, error: 'db down' })
    spy.mockRestore()
  })

  it('returns 500 when a sub-check throws outside its own isolation (e.g. event-loop read fails)', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const { getEventLoopHealth } = await import('./observability/eventLoopHealth.js')
    vi.mocked(getEventLoopHealth).mockImplementationOnce(() => {
      throw new Error('perf_hooks unavailable')
    })
    const res = await request(app).get('/api/diagnostics')
    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
  })
})
