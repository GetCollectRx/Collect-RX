import { BrowserRouter, Routes, Route, NavLink, Link, useLocation, Navigate, useNavigate } from 'react-router-dom'
import { CookieBanner } from './components/CookieBanner'
import { ChangePasswordModal } from './components/ChangePasswordModal'
import PublicPatientPay from './pages/PublicPatientPay'
import PaymentThankYou  from './pages/PaymentThankYou'
import LegalTerms from './pages/LegalTerms'
import LegalPrivacy from './pages/LegalPrivacy'
import ProductOnePager from './pages/ProductOnePager'
import Changelog from './pages/Changelog'
import { PracticeProvider, usePractice } from './context/PracticeContext'
import { ThemeProvider, useTheme }        from './context/ThemeContext'
import Dashboard             from './pages/Dashboard'
import Balances              from './pages/Balances'
import BalanceDetail         from './pages/BalanceDetail'
import PatientAR             from './pages/PatientAR'
import PreTreatmentEstimate  from './pages/PreTreatmentEstimate'
import Analytics             from './pages/Analytics'
import Outbox                from './pages/Outbox'
import Admin                 from './pages/Admin'
import OfficeGuide           from './pages/OfficeGuide'
import PaymentPage           from './pages/PaymentPage'
import { LoginPage }         from './pages/LoginPage'
import LandingPage           from './pages/LandingPage'
import PracticeBillingPage   from './pages/PracticeBillingPage'
import Phase5Dashboard       from './pages/Phase5Dashboard'
import InsuranceClaims       from './pages/InsuranceClaims'
import InsuranceClaimDetail  from './pages/InsuranceClaimDetail'
import WorkQueue             from './pages/WorkQueue'
import SyncOpsDashboard      from './pages/SyncOpsDashboard'
import PatientLookup         from './pages/PatientLookup'
import UsersAdmin            from './pages/UsersAdmin'
import ResetPasswordPage     from './pages/ResetPasswordPage'
import GroupDashboard        from './pages/GroupDashboard'
import { useRoleAccess }     from './lib/useRoleAccess'
import { ROLE_LABELS }       from './lib/authTypes'
import { useEffect, useState, type ReactNode } from 'react'

// ── Icons ─────────────────────────────────────────────────────────────────
const ICONS = {
  dashboard:  'M2 10a8 8 0 1116 0A8 8 0 012 10zm7-3a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1zm1 3a1 1 0 00-.707 1.707l2 2a1 1 0 001.414-1.414L11 11.586V10a1 1 0 00-1-1z',
  balances:   'M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z',
  insurance:  'M9 2a1 1 0 000 2h2a1 1 0 100-2H9z M4 5a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm4 5a1 1 0 100 2h4a1 1 0 100-2H8z',
  workqueue:  'M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zm10 0a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
  patientar:  'M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z',
  estimate:   'M9 2a1 1 0 000 2h2a1 1 0 100-2H9z M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z',
  analytics:  'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z',
  outbox:     'M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z',
  admin:      'M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z',
  guide:      'M9 4h6v2H9V4zM7 6h10a2 2 0 012 2v10H5V8a2 2 0 012-2zm2 4h6v2H9v-2zm0 4h6v2H9v-2z',
  cdcp:       'M9 2a1 1 0 000 2h2a1 1 0 100-2H9zM4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z',
  sun:        'M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z',
  moon:       'M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z',
  logo:       'M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14.924a7.003 7.003 0 01-2 0V11a1 1 0 112 0v3.924zm1-5.924a1 1 0 11-2 0 1 1 0 012 0z',
  signout:    'M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z',
}

// ── Dark-mode toggle ──────────────────────────────────────────────────────
function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme()
  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
    >
      {isDark ? (
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d={ICONS.sun} /></svg>
      ) : (
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d={ICONS.moon} /></svg>
      )}
    </button>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────
function Sidebar() {
  const { practices, practiceId, setPracticeId, logout, isPlatformDev, sessionUser } = usePractice()
  const access = useRoleAccess()
  const location = useLocation()
  const [showChangePw, setShowChangePw] = useState(false)

  // Build nav sections filtered by role access
  const allSections = [
  {
    label: 'Overview',
    items: [
      access.canViewDashboard      && { to: '/',                 exact: true,  label: 'Dashboard',       icon: ICONS.dashboard },
      access.canViewGroupDashboard && { to: '/group-dashboard',  exact: true,  label: 'Group overview',  icon: ICONS.analytics },
      access.canViewGuide          && { to: '/guide',            exact: true,  label: 'How it works',    icon: ICONS.guide    },
    ],
  },
    {
      label: 'Claims',
      items: [
        access.canViewWorkQueue  && { to: '/work-queue', exact: false, label: 'Work Queue',   icon: ICONS.workqueue },
        access.canViewInsurance  && { to: '/insurance',  exact: false, label: 'Insurance AR', icon: ICONS.insurance },
        access.canViewBalances   && { to: '/balances',   exact: false, label: 'Outreach AR',  icon: ICONS.balances  },
        access.canViewPatientAR  && { to: '/patient-ar', exact: false, label: 'Patient AR',   icon: ICONS.patientar },
      ],
    },
    {
      label: 'Tools',
      items: [
        access.canViewEstimate   && { to: '/estimate',  exact: false, label: 'Estimate',  icon: ICONS.estimate  },
        access.canViewAnalytics  && { to: '/analytics', exact: false, label: 'Analytics', icon: ICONS.analytics },
        access.canViewOutbox     && { to: '/outbox',    exact: false, label: 'Outbox',    icon: ICONS.outbox    },
        access.canViewCdcp       && { to: '/cdcp',      exact: false, label: 'CDCP',      icon: ICONS.cdcp      },
      ],
    },
    {
      label: 'Setup',
      items: [
        access.canViewAdmin   && { to: '/admin',        exact: false, label: 'Admin',    icon: ICONS.admin   },
        access.canManageUsers && { to: '/admin/users',  exact: false, label: 'Staff',    icon: ICONS.patientar },
        access.canViewBilling && { to: '/billing',      exact: false, label: 'Billing',  icon: ICONS.balances },
      ],
    },
  ]

  const navSections = allSections
    .map(s => ({ ...s, items: s.items.filter(Boolean) as { to: string; exact: boolean; label: string; icon: string }[] }))
    .filter(s => s.items.length > 0)

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-[220px] flex flex-col bg-white dark:bg-gray-950 border-r border-gray-100 dark:border-gray-800/70 z-30"
      style={{ boxShadow: '1px 0 0 0 rgba(0,0,0,0.04)' }}
      aria-label="Main navigation"
    >
      {/* ── Logo ── */}
      <div className="flex items-center justify-between px-4 h-[52px] border-b border-gray-100 dark:border-gray-800/70 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-[6px] bg-crx-500 flex items-center justify-center flex-shrink-0" aria-hidden="true">
            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path d={ICONS.logo} />
            </svg>
          </div>
          <span className="font-semibold text-gray-900 dark:text-gray-50 text-sm tracking-tight">
            Collect<span className="text-crx-500">Rx</span>
          </span>
          {isPlatformDev && (
            <span className="text-2xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
              Dev
            </span>
          )}
        </div>
        <span className="text-2xs text-gray-300 dark:text-gray-700 font-mono">v1.0</span>
      </div>

      {/* ── Nav sections ── */}
      <nav className="flex-1 py-3 overflow-y-auto" role="navigation">
        {navSections.map(section => (
          <div key={section.label} className="mb-4">
            <p className="px-4 mb-1 text-2xs font-semibold text-gray-300 dark:text-gray-700 uppercase tracking-wider">
              {section.label}
            </p>
            <div className="px-2 space-y-0.5">
              {section.items.map(item => {
                const isActive = item.exact
                  ? location.pathname === item.to
                  : location.pathname.startsWith(item.to)
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.exact}
                    className={`nav-item ${isActive ? 'active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d={item.icon} />
                    </svg>
                    {item.label}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className="border-t border-gray-100 dark:border-gray-800/70 flex-shrink-0">
        {/* Logged-in user */}
        {sessionUser && (
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800/70">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate leading-tight">
              {sessionUser.displayName}
            </p>
            <p className="text-2xs text-gray-400 dark:text-gray-600 mt-0.5">
              {ROLE_LABELS[sessionUser.role] ?? sessionUser.role}
            </p>
            <button
              onClick={() => setShowChangePw(true)}
              className="mt-1 text-2xs text-crx-500 hover:text-crx-600 dark:hover:text-crx-400 transition-colors"
            >
              Change password
            </button>
          </div>
        )}

        {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}

        {/* Practice selector */}
        {practices.length > 0 && (
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800/70">
            {isPlatformDev && (
              <p className="text-2xs text-amber-700 dark:text-amber-400 mb-1.5 leading-snug">
                PHI-free session — pick a practice context for ops APIs.
              </p>
            )}
            {practices.length === 1 && !isPlatformDev ? (
              <div>
                <p className="text-2xs text-gray-400 dark:text-gray-600 mb-0.5">Practice</p>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate leading-tight">
                  {practices[0]?.name}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-2xs text-gray-400 dark:text-gray-600 mb-1">Practice</p>
                <select
                  value={practiceId}
                  onChange={e => setPracticeId(e.target.value)}
                  className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-crx-500"
                  aria-label="Select practice"
                >
                  {practices.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Bottom row */}
        <div className="px-3 py-2.5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void logout()}
            className="flex items-center gap-1.5 text-2xs text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path d={ICONS.signout} /></svg>
            Sign out
          </button>
          <div className="flex items-center gap-1.5">
            <Link to="/changelog" className="text-2xs text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              Log
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </aside>
  )
}

// ── Route guard — redirects role to its allowed home if accessing a blocked path ──
function RoleRouteGuard({ children }: { children: ReactNode }) {
  const access = useRoleAccess()
  const location = useLocation()

  // Map paths to the access flag that permits them
  const routeAccess: [string, boolean][] = [
    ['/work-queue',       access.canViewWorkQueue],
    ['/insurance',        access.canViewInsurance],
    ['/balances',         access.canViewBalances],
    ['/patient-ar',       access.canViewPatientAR],
    ['/estimate',         access.canViewEstimate],
    ['/analytics',        access.canViewAnalytics],
    ['/outbox',           access.canViewOutbox],
    ['/cdcp',             access.canViewCdcp],
    ['/admin/users',      access.canManageUsers],
    ['/admin',            access.canViewAdmin],
    ['/billing',          access.canViewBilling],
    ['/group-dashboard',  access.canViewGroupDashboard],
    ['/',                 access.canViewDashboard],
    ['/guide',            access.canViewGuide],
  ]

  const blocked = routeAccess.find(([prefix, allowed]) => {
    const matches = prefix === '/'
      ? location.pathname === '/'
      : location.pathname === prefix || location.pathname.startsWith(`${prefix}/`)
    return matches && !allowed
  })

  if (blocked) return <Navigate to={access.homeRoute} replace />
  return <>{children}</>
}

// ── App shell ─────────────────────────────────────────────────────────────
function AppShell() {
  const access = useRoleAccess()

  // Front desk gets their own minimal shell (no sidebar)
  if (access.isPatientLookupOnly) {
    return (
      <Routes>
        <Route path="/patient-lookup" element={<PatientLookup />} />
        <Route path="*" element={<Navigate to="/patient-lookup" replace />} />
      </Routes>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50/60 dark:bg-gray-950">
      <Sidebar />
      <main
        className="flex-1 ml-[220px] min-h-screen flex flex-col"
        id="main-content"
      >
        <RoleRouteGuard>
          <Routes>
            <Route path="/"              element={<Dashboard />} />
            <Route path="/guide"         element={<OfficeGuide />} />
            <Route path="/work-queue"    element={<WorkQueue />} />
            <Route path="/insurance"     element={<InsuranceClaims />} />
            <Route path="/insurance/:id" element={<InsuranceClaimDetail />} />
            <Route path="/balances"      element={<Balances />} />
            <Route path="/balances/:id"  element={<BalanceDetail />} />
            <Route path="/admin/sync"    element={<SyncOpsDashboard />} />
            <Route path="/admin/users"   element={<UsersAdmin />} />
            <Route path="/group-dashboard" element={<GroupDashboard />} />
            <Route path="/patient-ar"    element={<PatientAR />} />
            <Route path="/estimate"      element={<PreTreatmentEstimate />} />
            <Route path="/analytics"     element={<Analytics />} />
            <Route path="/outbox"        element={<Outbox />} />
            <Route path="/admin"         element={<Admin />} />
            <Route path="/billing"       element={<PracticeBillingPage />} />
            <Route path="/pay/:balanceId" element={<PaymentPage />} />
            <Route path="/cdcp"          element={<Phase5Dashboard />} />
            <Route path="*"              element={<Navigate to={access.homeRoute} replace />} />
          </Routes>
        </RoleRouteGuard>
      </main>
    </div>
  )
}

function AuthGate() {
  const { authState, loading, subscription, isPlatformDev } = usePractice()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading || authState !== 'anon') return
    if (!navigator.userAgent?.includes('Electron')) return
    if (location.pathname !== '/' && location.pathname !== '') return
    navigate('/login', { replace: true })
  }, [loading, authState, location.pathname, navigate])

  if (authState === 'loading' || loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-md bg-crx-500 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" viewBox="0 0 20 20" fill="currentColor"><path d={ICONS.logo} /></svg>
          </div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Loading…</p>
        </div>
      </div>
    )
  }
  if (authState === 'anon') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*"      element={<LandingPage />} />
      </Routes>
    )
  }
  if (subscription.enforce && !subscription.active && !isPlatformDev) {
    return (
      <Routes>
        <Route path="/billing" element={<PracticeBillingPage />} />
        <Route path="*" element={<Navigate to="/billing" replace />} />
      </Routes>
    )
  }
  return <AppShell />
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <CookieBanner />
        <PracticeProvider>
          <Routes>
            <Route path="/pay/p/:publicToken" element={<PublicPatientPay />} />
            <Route path="/payment/thank-you" element={<PaymentThankYou />} />
            <Route path="/legal/terms" element={<LegalTerms />} />
            <Route path="/legal/privacy" element={<LegalPrivacy />} />
            <Route path="/product" element={<ProductOnePager />} />
            <Route path="/changelog" element={<Changelog />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="*" element={<AuthGate />} />
          </Routes>
        </PracticeProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
