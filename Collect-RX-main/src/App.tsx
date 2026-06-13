import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate, useNavigate } from 'react-router-dom'
import { CookieBanner } from './components/CookieBanner'
import PublicPatientPay from './pages/PublicPatientPay'
import PaymentThankYou  from './pages/PaymentThankYou'
import LegalTerms from './pages/LegalTerms'
import LegalPrivacy from './pages/LegalPrivacy'
import ProductOnePager from './pages/ProductOnePager'
import Changelog from './pages/Changelog'
import PilotDemo  from './pages/PilotDemo'
import { PracticeProvider, usePractice } from './context/PracticeContext'
import { SessionHealthBanner } from './components/SessionHealthBanner'
import { ThemeProvider, useTheme } from './context/ThemeContext'
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
import RecoveryGatesInbox    from './pages/RecoveryGatesInbox'
import WorkQueue             from './pages/WorkQueue'
import SyncOpsDashboard      from './pages/SyncOpsDashboard'
import LiveConsole           from './pages/LiveConsole'
import CallHistory           from './pages/CallHistory'
import AgingReport           from './pages/AgingReport'
import CarrierStats          from './pages/CarrierStats'
import PracticeSettings      from './pages/PracticeSettings'
import Escalations           from './pages/Escalations'
import QueueStatsReport      from './pages/QueueStatsReport'
import Portfolio             from './pages/Portfolio'
import AdminPractices        from './pages/AdminPractices'
import PartnershipsBoard     from './pages/PartnershipsBoard'
import ProspectDetail        from './pages/ProspectDetail'
import SystemHealth          from './pages/SystemHealth'
import UserManagement        from './pages/UserManagement'
import BreakGlass            from './pages/BreakGlass'
import ResetPasswordPage       from './pages/ResetPasswordPage'
import UsersAdmin              from './pages/UsersAdmin'
import { ProtectedRoute }    from './components/ProtectedRoute'
import { AppTopBar, SidebarBrand } from './components/app/AppTopBar'
import { NavIcon, type NavIconName } from './components/app/NavIcon'
import { HOME_ROUTE, type UserRole } from './types/userRole'
import { useEffect, type ReactNode } from 'react'
import { AnalyticsSessionBridge } from './productAnalytics/AnalyticsSessionBridge'
import ProductUsageAnalytics from './pages/ProductUsageAnalytics'
import './styles/collectrxAppTheme.css'

type NavItem = { to: string; exact: boolean; label: string; icon: NavIconName }
type NavSection = { label: string; items: NavItem[] }

const LOGO_PATH =
  'M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14.924a7.003 7.003 0 01-2 0V11a1 1 0 112 0v3.924zm1-5.924a1 1 0 11-2 0 1 1 0 012 0z'

/** Routes blocked for platform developer sessions (PHI-bearing surfaces). */
const PLATFORM_DEV_BLOCKED_PREFIXES = [
  '/balances',
  '/patient-ar',
  '/estimate',
  '/outbox',
  '/cdcp',
  '/pay',
]

const PLATFORM_DEV_NAV_PATHS = new Set([
  '/',
  '/dashboard',
  '/guide',
  '/work-queue',
  '/insurance',
  '/analytics',
  '/usage-insights',
  '/admin',
  '/admin/partnerships',
  '/admin/sync',
])

const FRONT_DESK_NAV: NavItem[] = [
  { to: '/console', exact: true, label: 'Live console', icon: 'console' },
  { to: '/history', exact: true, label: 'Call history', icon: 'history' },
  { to: '/escalations', exact: true, label: 'Escalations', icon: 'escalations' },
]

const OWNER_NAV: NavItem[] = [
  { to: '/dashboard', exact: true, label: 'Dashboard', icon: 'dashboard' },
  { to: '/work-queue', exact: false, label: 'Work queue', icon: 'workqueue' },
  { to: '/insurance', exact: false, label: 'Insurance AR', icon: 'insurance' },
  { to: '/insurance/gates', exact: true, label: 'Gate inbox', icon: 'workqueue' },
  { to: '/usage-insights', exact: true, label: 'Usage insights', icon: 'analytics' },
  { to: '/reports/aging', exact: false, label: 'Aging report', icon: 'analytics' },
  { to: '/reports/carriers', exact: false, label: 'Carrier stats', icon: 'carriers' },
  { to: '/escalations', exact: true, label: 'Escalations', icon: 'escalations' },
  { to: '/billing', exact: true, label: 'Plan & billing', icon: 'settings' },
  { to: '/settings', exact: true, label: 'Settings', icon: 'settings' },
]

const AUDITOR_NAV: NavItem[] = [
  { to: '/reports/aging', exact: false, label: 'Aging report', icon: 'analytics' },
  { to: '/reports/carriers', exact: false, label: 'Carrier stats', icon: 'carriers' },
  { to: '/reports/queue', exact: true, label: 'Queue stats', icon: 'workqueue' },
]

const BILLING_OPS_NAV: NavItem[] = [
  { to: '/portfolio', exact: true, label: 'Portfolio', icon: 'portfolio' },
  { to: '/reports/aging', exact: false, label: 'Aging (all)', icon: 'analytics' },
  { to: '/reports/carriers', exact: false, label: 'Carrier intel', icon: 'carriers' },
  { to: '/escalations', exact: true, label: 'Escalations', icon: 'escalations' },
]

const PLATFORM_ADMIN_NAV: NavItem[] = [
  { to: '/admin', exact: true, label: 'Practices', icon: 'admin' },
  { to: '/admin/partnerships', exact: false, label: 'Partnerships', icon: 'portfolio' },
  { to: '/admin/health', exact: true, label: 'System health', icon: 'health' },
  { to: '/usage-insights', exact: true, label: 'Usage insights', icon: 'analytics' },
  { to: '/admin/users', exact: true, label: 'Users', icon: 'users' },
  { to: '/admin/break-glass', exact: true, label: 'Break-glass', icon: 'breakglass' },
]

const FRONT_DESK_BLOCKED_PREFIXES = [
  '/dashboard',
  '/reports',
  '/settings',
  '/',
  '/guide',
  '/work-queue',
  '/insurance',
  '/balances',
  '/patient-ar',
  '/estimate',
  '/analytics',
  '/outbox',
  '/cdcp',
  '/admin',
  '/portfolio',
]

const PRACTICE_OWNER_BLOCKED_PREFIXES = ['/console', '/history']

// ── Nav structure with section groupings ─────────────────────────────────
const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', exact: true, label: 'Dashboard', icon: 'dashboard' },
      { to: '/guide', exact: true, label: 'How it works', icon: 'guide' },
    ],
  },
  {
    label: 'Claims',
    items: [
      { to: '/work-queue', exact: false, label: 'Work queue', icon: 'workqueue' },
      { to: '/insurance', exact: false, label: 'Insurance AR', icon: 'insurance' },
      { to: '/insurance/gates', exact: true, label: 'Gate inbox', icon: 'workqueue' },
      { to: '/balances', exact: false, label: 'Outreach AR', icon: 'balances' },
      { to: '/patient-ar', exact: false, label: 'Patient AR', icon: 'patientar' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/estimate', exact: false, label: 'Estimate', icon: 'estimate' },
      { to: '/analytics', exact: false, label: 'Analytics', icon: 'analytics' },
      { to: '/outbox', exact: false, label: 'Outbox', icon: 'outbox' },
      { to: '/cdcp', exact: false, label: 'CDCP', icon: 'cdcp' },
    ],
  },
  {
    label: 'Setup',
    items: [{ to: '/admin', exact: false, label: 'Admin', icon: 'admin' }],
  },
]

function SidebarNavLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.exact}
      className={({ isActive }) => `crx-nav-item ${isActive ? 'active' : ''}`}
    >
      {({ isActive }) => (
        <>
          <NavIcon name={item.icon} active={isActive} />
          <span className="crx-nav-label">{item.label}</span>
        </>
      )}
    </NavLink>
  )
}

function sidebarNavSections(
  userRole: string | null,
  isPlatformDev: boolean,
  isPracticeOwner: boolean,
): NavSection[] {
  const personaNav: NavSection[] =
    userRole === 'auditor'
      ? [{ label: 'Reports', items: AUDITOR_NAV }]
      : userRole === 'billing_ops_manager'
        ? [{ label: 'Operations', items: BILLING_OPS_NAV }]
        : userRole === 'platform_admin' || isPlatformDev
          ? [{ label: 'Platform', items: PLATFORM_ADMIN_NAV }]
          : isPracticeOwner
            ? [{ label: '', items: OWNER_NAV }]
            : NAV_SECTIONS

  if (isPlatformDev && userRole !== 'platform_admin') {
    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => PLATFORM_DEV_NAV_PATHS.has(item.to)),
    })).filter((section) => section.items.length > 0)
  }
  return personaNav
}

// ── Sidebar ───────────────────────────────────────────────────────────────
function Sidebar() {
  const { isPlatformDev, isFrontDesk, isPracticeOwner, userRole } = usePractice()

  if (isFrontDesk) {
    return (
      <aside className="crx-sidebar" aria-label="Front desk navigation">
        <div className="crx-sidebar-head">
          <SidebarBrand to="/console" suffix=" Desk" />
        </div>
        <nav className="crx-sidebar-nav" role="navigation">
          {FRONT_DESK_NAV.map((item) => (
            <SidebarNavLink key={item.to} item={item} />
          ))}
        </nav>
      </aside>
    )
  }

  const navSections = sidebarNavSections(userRole, isPlatformDev, isPracticeOwner)

  return (
    <aside className="crx-sidebar" aria-label="Main navigation">
      <div className="crx-sidebar-head">
        <SidebarBrand />
        {isPlatformDev && <span className="crx-sidebar-dev-pill">Dev</span>}
      </div>
      <nav className="crx-sidebar-nav" role="navigation">
        {navSections.map((section) => (
          <div key={section.label || 'nav'} className="crx-nav-section">
            {section.label ? (
              <p className="crx-section-label crx-nav-section-label">{section.label}</p>
            ) : null}
            {section.items.map((item) => (
              <SidebarNavLink key={item.to} item={item} />
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}

function PlatformDevRouteGuard({ children }: { children: ReactNode }) {
  const { isPlatformDev, isFrontDesk, isPracticeOwner, userRole } = usePractice()
  const location = useLocation()
  if (
    isPlatformDev &&
    PLATFORM_DEV_BLOCKED_PREFIXES.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))
  ) {
    return <Navigate to="/" replace />
  }
  if (
    isFrontDesk &&
    FRONT_DESK_BLOCKED_PREFIXES.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))
  ) {
    return <Navigate to="/console" replace />
  }
  if (
    isPracticeOwner &&
    PRACTICE_OWNER_BLOCKED_PREFIXES.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))
  ) {
    return <Navigate to="/dashboard" replace />
  }
  if (userRole === 'auditor' && location.pathname.startsWith('/settings')) {
    return <Navigate to="/reports/aging" replace />
  }
  return <>{children}</>
}

// ── App shell ─────────────────────────────────────────────────────────────
/** Logged-in UI: creamy white `.crx-app` — never Tailwind html.dark. */
function useBrandAppShellTheme() {
  const { setTheme } = useTheme()
  useEffect(() => {
    setTheme('light')
  }, [setTheme])
}

/** Login and other public Tailwind pages: light card on cream (not dark gray). */
function usePublicPortalTheme() {
  const { setTheme } = useTheme()
  useEffect(() => {
    setTheme('light')
  }, [setTheme])
}

// ── App shell ─────────────────────────────────────────────────────────────
function AppShell() {
  useBrandAppShellTheme()
  const { sessionHealth, userRole } = usePractice()
  return (
    <div className="crx-app flex min-h-screen">
      <Sidebar />
      <div className="crx-app-main">
        <AppTopBar />
        <SessionHealthBanner
          health={sessionHealth}
          isPlatformAdmin={userRole === 'platform_admin'}
        />
        <main className="crx-app-content" id="main-content">
        <PlatformDevRouteGuard>
        <Routes>
          <Route path="/console" element={<ProtectedRoute allowedRoles={['front_desk']}><LiveConsole /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute allowedRoles={['front_desk']}><CallHistory /></ProtectedRoute>} />
          <Route path="/console/history" element={<Navigate to="/history" replace />} />
          <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['practice_owner', 'billing_ops_manager']}><Dashboard /></ProtectedRoute>} />
          <Route path="/reports/aging" element={<ProtectedRoute allowedRoles={['practice_owner', 'auditor', 'billing_ops_manager', 'platform_admin']}><AgingReport /></ProtectedRoute>} />
          <Route path="/reports/carriers" element={<ProtectedRoute allowedRoles={['practice_owner', 'auditor', 'billing_ops_manager', 'platform_admin']}><CarrierStats /></ProtectedRoute>} />
          <Route path="/reports/queue" element={<ProtectedRoute allowedRoles={['auditor', 'practice_owner', 'billing_ops_manager', 'platform_admin']}><QueueStatsReport /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute allowedRoles={['practice_owner', 'platform_admin']}><PracticeSettings /></ProtectedRoute>} />
          <Route path="/escalations" element={<ProtectedRoute allowedRoles={['front_desk', 'practice_owner', 'billing_ops_manager']}><Escalations /></ProtectedRoute>} />
          <Route path="/portfolio" element={<ProtectedRoute allowedRoles={['billing_ops_manager']}><Portfolio /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute allowedRoles={['platform_admin']}><AdminPractices /></ProtectedRoute>} />
          <Route path="/admin/partnerships" element={<ProtectedRoute allowedRoles={['platform_admin']}><PartnershipsBoard /></ProtectedRoute>} />
          <Route path="/admin/partnerships/:id" element={<ProtectedRoute allowedRoles={['platform_admin']}><ProspectDetail /></ProtectedRoute>} />
          <Route path="/admin/health" element={<ProtectedRoute allowedRoles={['platform_admin']}><SystemHealth /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute allowedRoles={['platform_admin']}><UserManagement /></ProtectedRoute>} />
          <Route path="/admin/break-glass" element={<ProtectedRoute allowedRoles={['platform_admin']}><BreakGlass /></ProtectedRoute>} />
          <Route path="/admin/staff" element={<ProtectedRoute allowedRoles={['practice_owner']}><UsersAdmin /></ProtectedRoute>} />
          <Route path="/admin/integrations" element={<ProtectedRoute allowedRoles={['practice_owner', 'platform_admin']}><Admin /></ProtectedRoute>} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/guide" element={<OfficeGuide />} />
          <Route path="/work-queue" element={<ProtectedRoute allowedRoles={['practice_owner', 'billing_ops_manager', 'platform_admin']}><WorkQueue /></ProtectedRoute>} />
          <Route path="/insurance/gates" element={<ProtectedRoute allowedRoles={['practice_owner', 'billing_ops_manager', 'platform_admin']}><RecoveryGatesInbox /></ProtectedRoute>} />
          <Route path="/insurance" element={<ProtectedRoute allowedRoles={['practice_owner', 'billing_ops_manager', 'platform_admin']}><InsuranceClaims /></ProtectedRoute>} />
          <Route path="/insurance/:id" element={<ProtectedRoute allowedRoles={['practice_owner', 'billing_ops_manager', 'platform_admin']}><InsuranceClaimDetail /></ProtectedRoute>} />
          <Route path="/balances"      element={<Balances />} />
          <Route path="/balances/:id"  element={<BalanceDetail />} />
          <Route path="/admin/sync"    element={<SyncOpsDashboard />} />
          <Route path="/patient-ar"    element={<PatientAR />} />
          <Route path="/estimate"      element={<PreTreatmentEstimate />} />
          <Route path="/analytics"     element={<Analytics />} />
          <Route path="/usage-insights" element={<ProtectedRoute allowedRoles={['platform_admin', 'practice_owner']}><ProductUsageAnalytics /></ProtectedRoute>} />
          <Route path="/billing" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'accountant'] as UserRole[]}><PracticeBillingPage /></ProtectedRoute>} />
          <Route path="/outbox"        element={<Outbox />} />
          <Route path="/pay/:balanceId" element={<PaymentPage />} />
          <Route path="/cdcp"          element={<Phase5Dashboard />} />
        </Routes>
        </PlatformDevRouteGuard>
        </main>
      </div>
    </div>
  )
}

function AnonRoutes() {
  usePublicPortalTheme()
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<LandingPage />} />
    </Routes>
  )
}

function AuthGate() {
  const { authState, loading, subscription, isPlatformDev, userRole } = usePractice()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading || authState !== 'ready' || !userRole) return
    const home = HOME_ROUTE[userRole]
    if (location.pathname === '/' || location.pathname === '') {
      navigate(home, { replace: true })
    }
  }, [loading, authState, userRole, location.pathname, navigate])

  useEffect(() => {
    if (loading || authState !== 'anon') return
    if (!navigator.userAgent?.includes('Electron')) return
    if (location.pathname !== '/' && location.pathname !== '') return
    navigate('/login', { replace: true })
  }, [loading, authState, location.pathname, navigate])

  if (authState === 'loading' || loading) {
    return (
      <div
        className="crx-app min-h-screen flex flex-col items-center justify-center"
        style={{ background: 'var(--crx-bg1)' }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-5 h-5 rounded-md flex items-center justify-center"
            style={{ background: 'var(--crx-green)' }}
          >
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" style={{ color: 'var(--crx-bg0)' }}>
              <path d={LOGO_PATH} />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--crx-t2)' }}>
            Loading…
          </p>
        </div>
      </div>
    )
  }
  if (authState === 'anon') {
    return <AnonRoutes />
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
          <AnalyticsSessionBridge>
          <Routes>
            <Route path="/pay/p/:publicToken" element={<PublicPatientPay />} />
            <Route path="/payment/thank-you" element={<PaymentThankYou />} />
            <Route path="/legal/terms" element={<LegalTerms />} />
            <Route path="/legal/privacy" element={<LegalPrivacy />} />
            <Route path="/product" element={<ProductOnePager />} />
            <Route path="/changelog" element={<Changelog />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/demo" element={<PilotDemo />} />
            <Route path="*" element={<AuthGate />} />
          </Routes>
          </AnalyticsSessionBridge>
        </PracticeProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
