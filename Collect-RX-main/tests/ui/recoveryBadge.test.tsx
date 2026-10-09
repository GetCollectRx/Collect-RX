// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RecoveryBadge } from '../../src/components/RecoveryBadge'

afterEach(cleanup)

describe('RecoveryBadge', () => {
  it.each([
    ['sync_verified', 'Sync-verified', /PMS balance cleared/],
    ['carrier_confirmed', 'Carrier confirmed', /awaiting PMS sync/],
    ['in_progress', 'In progress', /not yet recovered/],
    ['at_risk', 'At risk', /needs staff action/],
  ] as const)('labels %s and explains it on hover', (verification, label, hint) => {
    render(<RecoveryBadge verification={verification} />)
    const badge = screen.getByText(label)
    expect(badge).toBeInTheDocument()
    expect(badge.closest('[title]')).toHaveAttribute('title', expect.stringMatching(hint))
  })
})
