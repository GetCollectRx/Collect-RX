import { Link } from 'react-router-dom'
import { usePractice } from '../../context/PracticeContext'

const LOGO_PATH =
  'M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14.924a7.003 7.003 0 01-2 0V11a1 1 0 112 0v3.924zm1-5.924a1 1 0 11-2 0 1 1 0 012 0z'

export function AppTopBar() {
  const { practices, practiceId, setPracticeId, logout, isPlatformDev, practice } = usePractice()
  const practiceName = practice?.name ?? practices.find((p) => p.id === practiceId)?.name

  return (
    <header className="crx-topbar flex-shrink-0" role="banner">
      <div className="crx-topbar-inner">
        <div className="crx-topbar-left">
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
          {isPlatformDev && (
            <span className="crx-topbar-dev-badge">Dev session</span>
          )}
        </div>

        <div className="crx-topbar-actions">
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
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path d={LOGO_PATH} />
        </svg>
      </span>
      <span className="crx-sidebar-logo">
        Collect<span>Rx</span>
        {suffix ? <span className="crx-sidebar-logo-suffix">{suffix}</span> : null}
      </span>
    </Link>
  )
}
