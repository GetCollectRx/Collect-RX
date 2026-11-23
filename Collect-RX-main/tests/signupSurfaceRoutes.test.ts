import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')
const appSource = readFileSync(join(root, 'src/App.tsx'), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(name)) out.push(p)
  }
  return out
}

describe('agreement text is reachable from the signup form', () => {
  const [, commandCenter, marketing] = appSource.split(/isCommandCenterSurface \? \(|\) : \(/)

  it.each(['/legal/terms', '/legal/privacy', '/legal/call-listening'])(
    'serves %s on the app surface and the marketing surface',
    (path) => {
      expect(commandCenter).toContain(`path="${path}"`)
      expect(marketing).toContain(`path="${path}"`)
    },
  )

  it('every agreement path in the registry has a route on the app surface', () => {
    const registry = readFileSync(join(root, 'src/server/agreements/agreementRegistry.ts'), 'utf8')
    const paths = [...registry.matchAll(/path: '([^']+)'/g)].map((m) => m[1])
    expect(paths.length).toBeGreaterThanOrEqual(3)
    for (const p of paths) expect(commandCenter).toContain(`path="${p}"`)
  })
})

describe('signup page uses a styled wrapper', () => {
  it('no component uses a portal class that has no CSS rule', () => {
    const css = readFileSync(join(root, 'src/styles/collectrxAppTheme.css'), 'utf8')
    const used = new Set<string>()
    for (const f of walk(join(root, 'src')).filter((p) => p.endsWith('.tsx'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/className="(crx-portal[\w-]*)"/g)) used.add(m[1])
    }
    const missing = [...used].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css))
    expect(missing).toEqual([])
  })
})
