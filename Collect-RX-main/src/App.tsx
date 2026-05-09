import { BrowserRouter, Routes, Route, NavLink, Link, useLocation } from 'react-router-dom'
import { CookieBanner } from './components/CookieBanner'
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
import CanadianExpansion from './pages/CanadianExpansion'
import './App.css'

// ── Icons (inline SVG — zero dependency) ─────────────────────────────────
const ICONS = {
  dashboard:  'M2 10a8 8 0 1116 0A8 8 0 012 10zm7-3a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1zm1 3a1 1 0 00-.707 1.707l2 2a1 1 0 001.414-1.414L11 11.586V10a1 1 0 00-1-1z',
  balances:   'M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z',
  patientar:  'M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z',
  estimate:   'M9 2a1 1 0 000 2h2a1 1 0 100-2H9z M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z',
  analytics:  'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z',
  canadian:   'M4 4h12v2H4V4zm0 4h12v2H4V8zm0 4h8v2H4v-2zm10 0l2 4 2-4h-4z',
  outbox:     'M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z',
  admin:      'M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z',
  guide:      'M9 4h6v2H9V4zM7 6h10a2 2 0 012 2v10H5V8a2 2 0 012-2zm2 4h6v2H9v-2zm0 4h6v2H9v-2z',
  sun:        'M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z',
  moon:       'M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z',
  logo:       'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z',
}

const NAV_ITEMS = [
  { to: '/',          exact: true,  label: 'Dashboard',  icon: ICONS.dashboard  },
  { to: '/guide',    exact: true,  label: 'How it works', icon: ICONS.guide     },
  { to: '/balances',  exact: false, label: 'Balances',   icon: ICONS.balances   },
  { to: '/patient-ar',exact: false, label: 'Patient AR', icon: ICONS.patientar  },
  { to: '/estimate',  exact: false, label: 'Estimate',   icon: ICONS.estimate   },
  { to: '/analytics', exact: false, label: 'Analytics',  icon: ICONS.analytics  },
  { to: '/canadian-2026', exact: false, label: 'CDCP 2026', icon: ICONS.canadian },
  { to: '/outbox',    exact: false, label: 'Outbox',     icon: ICONS.outbox     },
  { to: '/admin',     exact: false, label: 'Admin',      icon: ICONS.admin      },
]

// ── Dark-mode toggle button ───────────────────────────────────────────────
function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme()
  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
    >
      {isDark ? (
        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d={ICONS.sun} /></svg>
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d={ICONS.moon} /></svg>
      )}
    </button>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────
function Sidebar() {
  const { practices, practiceId, setPracticeId, logout } = usePractice()
  const location = useLocation()

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-[228px] flex flex-col bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-r border-gray-200/80 dark:border-gray-800 shadow-sidebar z-30"
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-crx-500 flex items-center justify-center flex-shrink-0" aria-hidden="true">
          <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path d={ICONS.logo} />
          </svg>
        </div>
        <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm tracking-tight">
          Collect<span className="text-crx-500">Rx</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto" role="navigation">
        {NAV_ITEMS.map(item => {
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
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d={item.icon} />
              </svg>
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      {/* Footer: practice + theme toggle */}
      <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-800 space-y-2 flex-shrink-0">
        <div className="px-1 space-y-1.5">
          <p className="text-2xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Resources</p>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-2xs">
            <Link to="/legal/terms" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Terms</Link>
            <Link to="/legal/privacy" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Privacy</Link>
            <Link to="/product" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Product</Link>
            <Link to="/changelog" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Changelog</Link>
            <Link to="/guide" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Office guide</Link>
          </div>
        </div>

        {practices.length > 0 && (
          <div className="px-1">
            <p className="text-2xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
              Practice
            </p>
            {practices.length === 1 ? (
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                {practices[0]?.name}
              </p>
            ) : (
              <select
                value={practiceId}
                onChange={e => setPracticeId(e.target.value)}
                className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-crx-500"
                aria-label="Select practice"
              >
                {practices.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="flex items-center justify-between px-1 gap-2">
          <button
            type="button"
            onClick={() => void logout()}
            className="text-2xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
          >
            Sign out
          </button>
          <span className="text-2xs text-gray-400 dark:text-gray-500">v1.0.0</span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  )
}

// ── App shell ─────────────────────────────────────────────────────────────
function AppShell() {
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 via-white to-crx-50/40 dark:from-gray-950 dark:via-gray-950 dark:to-crx-950/15">
      <Sidebar />
      <main
        className="flex-1 ml-[228px] min-h-screen flex flex-col"
        id="main-content"
      >
        <Routes>
          <Route path="/"             element={<Dashboard />} />
          <Route path="/guide"        element={<OfficeGuide />} />
          <Route path="/balances"     element={<Balances />} />
          <Route path="/balances/:id" element={<BalanceDetail />} />
          <Route path="/patient-ar"   element={<PatientAR />} />
          <Route path="/estimate"     element={<PreTreatmentEstimate />} />
          <Route path="/analytics"    element={<Analytics />} />
          <Route path="/canadian-2026" element={<CanadianExpansion />} />
          <Route path="/outbox"       element={<Outbox />} />
          <Route path="/admin"        element={<Admin />} />
          <Route path="/pay/:balanceId" element={<PaymentPage />} />
        </Routes>
      </main>
    </div>
  )
}

function AuthGate() {
  const { authState, loading } = usePractice()
  if (authState === 'loading' || loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-sm text-gray-600 dark:text-gray-300">Loading…</p>
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
            <Route path="*" element={<AuthGate />} />
          </Routes>
        </PracticeProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
