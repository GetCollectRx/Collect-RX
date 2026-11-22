import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NavIcon, type NavIconName } from './NavIcon'

const NAMES: NavIconName[] = [
  'dashboard', 'workqueue', 'insurance', 'analytics', 'carriers', 'escalations', 'settings',
  'console', 'history', 'portfolio', 'health', 'users', 'breakglass', 'guide', 'balances',
  'patientar', 'estimate', 'outbox', 'cdcp', 'admin', 'download',
]

describe('NavIcon', () => {
  it.each(NAMES)('draws %s with one brand-green accent', (name) => {
    const html = renderToStaticMarkup(<NavIcon name={name} />)
    expect(html).toContain('<svg')
    expect(html).toMatch(/<(path|rect|circle)/)
    expect(html).toContain('var(--crx-green)')
  })

  it('marks the active icon', () => {
    expect(renderToStaticMarkup(<NavIcon name="dashboard" active />)).toContain('is-active')
  })
})
