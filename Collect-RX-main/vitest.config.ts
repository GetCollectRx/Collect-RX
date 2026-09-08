import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'

const isCi = Boolean(process.env.CI)

// Load .env.local for local development and CI environments
config({ path: '.env.local' })
config({ path: '.env' })

// Ensure DATABASE_URL is available in process.env for Prisma schema validation
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://collectrx:collectrx_local_dev_only@localhost:5433/collectrx'
}

export default defineConfig({
  test: {
    environment: 'node',
    maxWorkers: 1,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    exclude: ['tests/carrier-whitelist-validation.test.ts'],
    passWithNoTests: false,
    reporters: isCi ? ['default', 'junit'] : ['default'],
    outputFile: isCi ? { junit: 'test-results/junit.xml' } : undefined,
    // Integration tests set STRIPE_* per describe; default avoids accidental undefined in imports.
    // REDIS_URL can be overridden at runtime for queue/worker testing (set before test run).
    // DATABASE_URL is required for integration tests connecting to Postgres.
    env: {
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://collectrx:collectrx_local_dev_only@localhost:5433/collectrx',
      STRIPE_SECRET_KEY: 'sk_test_4eC39HqLyjWDarjtT1zdp7dc',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_00000000000000000000000000000000',
      VAPI_WEBHOOK_SECRET: 'test_vapi_secret_12345678',
      VITEST: 'true',
      CONNECTOR_MONITOR_ENABLED: '0',
      DISABLE_SCHEDULER: '1',
      REDIS_URL: process.env.REDIS_URL || '',
      JWT_SECRET: process.env.JWT_SECRET || 'test_jwt_secret_for_vitest',
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
