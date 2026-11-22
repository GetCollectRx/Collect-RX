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
 * The CollectRx icon family. Drawn on a 24px grid with a 1.6 stroke, and each
 * icon carries exactly one brand-green accent (a dot, a bar or a stroke) so the
 * set reads as ours instead of a stock pack. The outline follows currentColor,
 * the accent is always brand green.
 */
const ACCENT = 'var(--crx-green)'

const PATHS: Record<NavIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="8" height="10" rx="2" />
      <rect x="13" y="3" width="8" height="5" rx="2" />
      <rect x="13" y="11" width="8" height="10" rx="2" />
      <rect x="3" y="16" width="8" height="5" rx="2" />
      <circle cx="7" cy="8" r="1.6" fill={ACCENT} stroke="none" />
    </>
  ),
  workqueue: (
    <>
      <path d="M10 6h10M10 12h10M10 18h6" />
      <circle cx="5" cy="6" r="1.6" fill={ACCENT} stroke="none" />
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="5" cy="18" r="1.4" />
    </>
  ),
  insurance: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M10 12h5" />
      <path d="M10.5 16.5l1.6 1.6 3-3.2" stroke={ACCENT} />
    </>
  ),
  analytics: (
    <>
      <path d="M3 21h18" />
      <rect x="5" y="13" width="3.5" height="8" rx="1" />
      <rect x="10.25" y="8" width="3.5" height="13" rx="1" />
      <rect x="15.5" y="4" width="3.5" height="17" rx="1" fill={ACCENT} stroke="none" />
    </>
  ),
  carriers: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V9l7-5 7 5v12" />
      <path d="M10 21v-5h4v5" />
      <circle cx="12" cy="11" r="1.6" fill={ACCENT} stroke="none" />
    </>
  ),
  escalations: (
    <>
      <path d="M12 20V5" />
      <path d="M6 11l6-6 6 6" />
      <circle cx="12" cy="20" r="1.6" fill={ACCENT} stroke="none" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" fill={ACCENT} stroke="none" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  console: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M9 21h6M12 17v4" />
      <path d="M7 11l2-3 2 5 2-4 2 2h2" stroke={ACCENT} />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.6-5.9" />
      <path d="M4 4v4h4" />
      <path d="M12 8v4l3 2" stroke={ACCENT} />
    </>
  ),
  portfolio: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
      <circle cx="12" cy="8" r="1.4" fill={ACCENT} stroke="none" />
    </>
  ),
  health: (
    <>
      <path d="M3 12h4l2-6 4 12 2-6h2" />
      <circle cx="20" cy="12" r="1.6" fill={ACCENT} stroke="none" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16.5 5.3a3 3 0 0 1 0 5.4M18 14.8c1.8.7 3 2.3 3 4.2" stroke={ACCENT} />
    </>
  ),
  breakglass: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="16" r="1.5" fill={ACCENT} stroke="none" />
    </>
  ),
  guide: (
    <>
      <path d="M12 6c-2-1.5-5-2-8-1.5V18c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5C17 4 14 4.5 12 6z" />
      <path d="M12 6v13.5" stroke={ACCENT} />
    </>
  ),
  balances: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.8 9.4c-.3-1-1.3-1.6-2.8-1.6-1.6 0-2.7.7-2.7 1.9 0 2.7 5.6 1.2 5.6 3.9 0 1.2-1.1 2-2.9 2-1.6 0-2.6-.7-2.9-1.8" stroke={ACCENT} />
    </>
  ),
  patientar: (
    <>
      <circle cx="10" cy="8" r="3.2" />
      <path d="M4 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <circle cx="19" cy="17" r="2.2" fill={ACCENT} stroke="none" />
    </>
  ),
  estimate: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6" />
      <circle cx="9" cy="13" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="1.1" fill={ACCENT} stroke="none" />
    </>
  ),
  outbox: (
    <>
      <path d="M3 13h5l1.5 2.5h5L16 13h5" />
      <path d="M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6" />
      <path d="M12 11V4M9 7l3-3 3 3" stroke={ACCENT} />
    </>
  ),
  cdcp: (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.2 7.5-8 9-4.8-1.5-8-4.5-8-9V6z" />
      <path d="M12 9v6M9 12h6" stroke={ACCENT} />
    </>
  ),
  admin: (
    <>
      <circle cx="6" cy="12" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="18" cy="18" r="2.2" />
      <path d="M8 11l8-4M8 13l8 4" />
      <circle cx="12" cy="12" r="1.4" fill={ACCENT} stroke="none" />
    </>
  ),
  download: (
    <>
      <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
      <path d="M12 4v10M8 10l4 4 4-4" stroke={ACCENT} />
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {PATHS[name]}
      </svg>
    </span>
  )
}
