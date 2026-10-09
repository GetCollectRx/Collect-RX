import { describe, expect, it } from 'vitest'
import { assignFiles, featureCoverage, testsFor } from '../scripts/check-feature-coverage.mjs'

const registry = {
  excluded: { patterns: ['src/**/*.test.ts', 'src/types/**'] },
  features: [
    { id: 'calls', src: ['src/webhooks/**', 'src/vapi/client.ts'], tests: ['tests/calls/*.test.ts'], floor: 50 },
    { id: 'billing', src: ['src/billing/**'], tests: ['tests/billing.test.ts'], floor: 0 },
  ],
}

describe('feature coverage gate', () => {
  it('assigns each source file to the first matching feature and reports the rest as unmapped', () => {
    const { owner, unmapped } = assignFiles(registry, [
      'src/webhooks/vapi.ts',
      'src/webhooks/nested/deep.ts',
      'src/vapi/client.ts',
      'src/billing/tiers.ts',
      'src/billing/tiers.test.ts',
      'src/types/ws.ts',
      'src/orphan.ts',
      'src/assets/logo.svg',
    ])
    expect(Object.fromEntries(owner)).toEqual({
      'src/webhooks/vapi.ts': 'calls',
      'src/webhooks/nested/deep.ts': 'calls',
      'src/vapi/client.ts': 'calls',
      'src/billing/tiers.ts': 'billing',
    })
    expect(unmapped).toEqual(['src/orphan.ts'])
  })

  it('does not let a single star cross a directory boundary', () => {
    const files = ['tests/calls/a.test.ts', 'tests/calls/sub/b.test.ts', 'tests/other.test.ts']
    expect(testsFor(registry.features[0], files)).toEqual(['tests/calls/a.test.ts'])
  })

  it('sums line coverage per feature from a coverage summary', () => {
    const { owner } = assignFiles(registry, ['src/webhooks/vapi.ts', 'src/vapi/client.ts', 'src/billing/tiers.ts'])
    const totals = featureCoverage(registry, owner, {
      total: { lines: { covered: 0, total: 0 } },
      '/repo/Collect-RX-main/src/webhooks/vapi.ts': { lines: { covered: 30, total: 100 } },
      '/repo/Collect-RX-main/src/vapi/client.ts': { lines: { covered: 50, total: 100 } },
      '/repo/Collect-RX-main/src/billing/tiers.ts': { lines: { covered: 10, total: 10 } },
    })
    expect(totals.get('calls')).toEqual({ covered: 80, total: 200 })
    expect(totals.get('billing')).toEqual({ covered: 10, total: 10 })
  })
})
