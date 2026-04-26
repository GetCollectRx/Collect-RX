import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    maxWorkers: 1,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    passWithNoTests: false,
    // Integration tests set STRIPE_* per describe; default avoids accidental undefined in imports.
    env: {
      STRIPE_SECRET_KEY: 'sk_test_4eC39HqLyjWDarjtT1zdp7dc',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_00000000000000000000000000000000',
    },
  },
})
