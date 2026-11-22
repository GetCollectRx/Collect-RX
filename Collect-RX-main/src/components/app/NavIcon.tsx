import type { ReactNode } from 'react'

export type NavIconName =
  | 'dashboard'
  | 'workqueue'
  | 'insurance'
  | 'analytics'
  | 'carriers'
  | 'escalations'
  | 'settings'
  | 'console'
  | 'history'
  | 'portfolio'
  | 'health'
  | 'users'
  | 'breakglass'
  | 'guide'
  | 'balances'
  | 'patientar'
  | 'estimate'
  | 'outbox'
  | 'cdcp'
  | 'admin'
  | 'download'

/**
 * The CollectRx icon family. Drawn on a 24px grid with a 1.5 stroke, square line
 * ends, mitred corners and a 1px corner radius, so the set reads technical and
 * flat rather than rounded and playful. Each icon carries one thin brand-green
 * line as its accent; the outline follows currentColor.
 */
const ACCENT = 'var(--crx-green)'

const PATHS: Record<NavIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1" />
      <path d="M6 8h2" stroke={ACCENT} />
    </>
  ),
  workqueue: (
    <>
      <path d="M4.5 12h2M4.5 17.5h2M10 12h9.5M10 17.5h6" />
      <path d="M4.5 6.5h2M10 6.5h9.5" stroke={ACCENT} />
    </>
  ),
  insurance: (
    <>
      <path d="M6.5 3.5h8l3 3v14h-11z" />
      <path d="M14.5 3.5v3h3" />
      <path d="M9.5 14l2 2 3.5-4" stroke={ACCENT} />
    </>
  ),
  analytics: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M6.5 20V14M12 20V9" />
      <path d="M17.5 20V4" stroke={ACCENT} />
    </>
  ),
  carriers: (
    <>
      <path d="M3.5 20.5h17M5.5 20.5V9l6.5-4.5L18.5 9v11.5" />
      <path d="M10 20.5v-5h4v5" stroke={ACCENT} />
    </>
  ),
  escalations: (
    <>
      <path d="M6.5 10.5L12 5l5.5 5.5" />
      <path d="M12 20.5V5.5" stroke={ACCENT} />
    </>
  ),
  settings: (
    <>
      <path d="M3.5 7.5h10M17.5 7.5h3M3.5 16.5h3M10.5 16.5h10" />
      <path d="M15.5 5v5M8.5 14v5" stroke={ACCENT} />
    </>
  ),
  console: (
    <>
      <rect x="3.5" y="4.5" width="17" height="12" rx="1" />
      <path d="M9 20.5h6M12 16.5v4" />
      <path d="M7 11h2l1.5-3 3 6 1.5-3h2" stroke={ACCENT} />
    </>
  ),
  history: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" />
      <path d="M4.5 4v4h4" />
      <path d="M12 7.5V12l3 2" stroke={ACCENT} />
    </>
  ),
  portfolio: (
    <>
      <path d="M12 3.5L20.5 8 12 12.5 3.5 8z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
      <path d="M3.5 16.5L12 21l8.5-4.5" stroke={ACCENT} />
    </>
  ),
  health: (
    <>
      <path d="M3.5 12h4M16 12h4.5" />
      <path d="M7.5 12l2-6 4 12 2.5-6" stroke={ACCENT} />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20.5c0-3.3 2.4-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <path d="M16 5a3 3 0 0 1 0 6M18 15c1.8.7 2.5 2.3 2.5 5.5" stroke={ACCENT} />
    </>
  ),
  breakglass: (
    <>
      <rect x="5.5" y="11.5" width="13" height="9" rx="1" />
      <path d="M8.5 11.5V8a3.5 3.5 0 0 1 7 0v3.5" />
      <path d="M12 15v2.5" stroke={ACCENT} />
    </>
  ),
  guide: (
    <>
      <path d="M12 6c-2-1.5-5-2-8-1.5v13.5c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5C17 4 14 4.5 12 6z" />
      <path d="M12 6v13.5" stroke={ACCENT} />
    </>
  ),
  balances: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.5H10a1.5 1.5 0 0 0 0 3h4a1.5 1.5 0 0 1 0 3H9.5M12 7.5v2M12 15.5v1.5" stroke={ACCENT} />
    </>
  ),
  patientar: (
    <>
      <circle cx="10" cy="8" r="3.2" />
      <path d="M4 20.5c0-3.3 2.4-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16.5 17.5h4M18.5 15.5v4" stroke={ACCENT} />
    </>
  ),
  estimate: (
    <>
      <rect x="5.5" y="3.5" width="13" height="17" rx="1" />
      <path d="M9 7.5h6" />
      <path d="M9 12h6M9 16h3.5" stroke={ACCENT} />
    </>
  ),
  outbox: (
    <>
      <path d="M3.5 13h5l1.5 2.5h4l1.5-2.5h5M3.5 13v7.5h17V13" />
      <path d="M12 11V4M9 7l3-3 3 3" stroke={ACCENT} />
    </>
  ),
  cdcp: (
    <>
      <path d="M12 3.5l8 3v5.5c0 4.5-3.2 7.5-8 9-4.8-1.5-8-4.5-8-9V6.5z" />
      <path d="M12 9v6M9 12h6" stroke={ACCENT} />
    </>
  ),
  admin: (
    <>
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 11l8-4M8 13l8 4" stroke={ACCENT} />
    </>
  ),
  download: (
    <>
      <path d="M4.5 15v5.5h15V15" />
      <path d="M12 4v11M8 11l4 4 4-4" stroke={ACCENT} />
    </>
  ),
}

type Props = {
  name: NavIconName
  active?: boolean
}

export function NavIcon({ name, active }: Props) {
  return (
    <span className={`crx-nav-icon ${active ? 'is-active' : ''}`} aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter">
        {PATHS[name]}
      </svg>
    </span>
  )
}
