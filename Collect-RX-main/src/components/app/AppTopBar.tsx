import { Link } from 'react-router-dom'
import { usePractice } from '../../context/PracticeContext'
import { CollectRxLogoMark } from '../brand/CollectRxLogo'
import { NotificationBell } from './NotificationBell'

export function AppTopBar({ onToggleNav }: { onToggleNav?: () => void }) {
  const { practices, practiceId, setPracticeId, logout, isPlatformDev, practice, userRole } = usePractice()
  const practiceName = practice?.name ?? practices.find((p) => p.id === practiceId)?.name

  return (
    <header className="crx-topbar flex-shrink-0" role="banner">
      <div className="crx-topbar-inner">
        <div className="crx-topbar-left">
          {onToggleNav && (
            <button type="button" className="crx-nav-toggle" onClick={onToggleNav} aria-label="Toggle navigation">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {practices.length > 1 ? (
            <label className="crx-topbar-practice">
              <span className="crx-topbar-practice-label">Practice</span>
              <select
                value={practiceId}
                onChange={(e) => setPracticeId(e.target.value)}
                className="crx-topbar-select"
                aria-label="Select practice"
              >
                {practices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            practiceName && <p className="crx-topbar-practice-name">{practiceName}</p>
          )}
          {isPlatformDev && userRole !== 'platform_admin' && (
            <span className="crx-topbar-dev-badge">Dev session</span>
          )}
        </div>

        <div className="crx-topbar-actions">
          <NotificationBell />
          <Link to="/changelog" className="crx-topbar-link">
            Changelog
          </Link>
          <button type="button" className="crx-topbar-signout" onClick={() => void logout()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}

type SidebarBrandProps = {
  to?: string
  suffix?: string
}

export function SidebarBrand({ to = '/dashboard', suffix }: SidebarBrandProps) {
  return (
    <Link to={to} className="crx-sidebar-brand">
      <span className="crx-sidebar-brand-mark" aria-hidden>
        <CollectRxLogoMark size={28} />
      </span>
      <span className="crx-sidebar-logo">
        Collect<span>Rx</span>
        {suffix ? <span className="crx-sidebar-logo-suffix">{suffix}</span> : null}
      </span>
    </Link>
  )
}
