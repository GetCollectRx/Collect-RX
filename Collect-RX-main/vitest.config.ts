import { defineConfig } from 'vitest/config'

const isCi = Boolean(process.env.CI)

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
    env: {
      STRIPE_SECRET_KEY: 'sk_test_4eC39HqLyjWDarjtT1zdp7dc',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_00000000000000000000000000000000',
      VITEST: 'true',
      CONNECTOR_MONITOR_ENABLED: '0',
      DISABLE_SCHEDULER: '1',
      REDIS_URL: '',
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
