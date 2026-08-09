import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate, useNavigate } from 'react-router-dom'
import { CookieBanner } from './components/CookieBanner'
const LegalTerms = lazy(() => import('./pages/LegalTerms'))
const LegalPrivacy = lazy(() => import('./pages/LegalPrivacy'))
const ProductOnePager = lazy(() => import('./pages/ProductOnePager'))
const Changelog = lazy(() => import('./pages/Changelog'))
const PilotDemo = lazy(() => import('./pages/PilotDemo'))
import { PracticeProvider, usePractice } from './context/PracticeContext'
import { SessionHealthBanner } from './components/SessionHealthBanner'
import { PlanUsageBanner } from './components/PlanUsageBanner'
import { DesktopConnectorBanner } from './components/desktop/DesktopConnectorBanner'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import { LoginPage }         from './pages/LoginPage'
import ResetPasswordPage       from './pages/ResetPasswordPage'
import SignupPage              from './pages/SignupPage'
import AcceptInvitePage        from './pages/AcceptInvitePage'
const Dashboard             = lazy(() => import('./pages/Dashboard'))
const Analytics             = lazy(() => import('./pages/Analytics'))
const AssumptionValidation  = lazy(() => import('./pages/AssumptionValidation'))
const PilotRunbook          = lazy(() => import('./pages/PilotRunbook'))
const Admin                 = lazy(() => import('./pages/Admin'))
const OfficeGuide           = lazy(() => import('./pages/OfficeGuide'))
const PracticeBillingPage   = lazy(() => import('./pages/PracticeBillingPage'))
const PreVisitCommandCenter = lazy(() => import('./pages/PreVisitCommandCenter'))
const CanadianExpansion     = lazy(() => import('./pages/CanadianExpansion'))
const GroupDashboard        = lazy(() => import('./pages/GroupDashboard'))
const GroupPmsImportPage    = lazy(() => import('./pages/GroupPmsImportPage'))
const ArCommandCenter       = lazy(() => import('./pages/ArCommandCenter'))
const InsuranceClaims       = lazy(() => import('./pages/InsuranceClaims'))
const InsuranceClaimDetail  = lazy(() => import('./pages/InsuranceClaimDetail'))
const PreTreatmentEstimate  = lazy(() => import('./pages/PreTreatmentEstimate'))
const WorkQueue             = lazy(() => import('./pages/WorkQueue'))
const SyncOpsDashboard      = lazy(() => import('./pages/SyncOpsDashboard'))
const DesktopDownload       = lazy(() => import('./pages/DesktopDownload'))
const LiveConsole           = lazy(() => import('./pages/LiveConsole'))
const CallHistory           = lazy(() => import('./pages/CallHistory'))
const AgingReport           = lazy(() => import('./pages/AgingReport'))
const CarrierStats          = lazy(() => import('./pages/CarrierStats'))
const PracticeSettings      = lazy(() => import('./pages/PracticeSettings'))
const Escalations           = lazy(() => import('./pages/Escalations'))
const QueueStatsReport      = lazy(() => import('./pages/QueueStatsReport'))
const Portfolio             = lazy(() => import('./pages/Portfolio'))
const AdminPractices        = lazy(() => import('./pages/AdminPractices'))
const PartnershipsBoard     = lazy(() => import('./pages/PartnershipsBoard'))
const ProspectDetail        = lazy(() => import('./pages/ProspectDetail'))
const SystemHealth          = lazy(() => import('./pages/SystemHealth'))
const UserManagement        = lazy(() => import('./pages/UserManagement'))
const BreakGlass            = lazy(() => import('./pages/BreakGlass'))
const UsersAdmin            = lazy(() => import('./pages/UsersAdmin'))
import { ProtectedRoute }    from './components/ProtectedRoute'
import { AppTopBar, SidebarBrand } from './components/app/AppTopBar'
import { NavIcon, type NavIconName } from './components/app/NavIcon'
import { HOME_ROUTE, type UserRole } from './types/userRole'
import { StartupScreen } from './components/StartupScreen'
import { AnalyticsSessionBridge } from './productAnalytics/AnalyticsSessionBridge'
const ProductUsageAnalytics = lazy(() => import('./pages/ProductUsageAnalytics'))
import { CollectRxLogoMark } from './components/brand/CollectRxLogo'
import { consumeLoginRedirect, pathRequiresAuth, storeLoginRedirect } from './lib/pathRequiresAuth'
import { isCommandCenterSurface } from './lib/appSurface'
const MarketingSite = lazy(() => import('./website/MarketingSite'))
import { usePublicPortalTheme } from './website/usePublicPortalTheme'
const CsvImportPage = lazy(() => import('./pages/CsvImportPage'))
import { ToastProvider } from './context/ToastContext'
import { CommandPalette } from './components/CommandPalette'
import './styles/tailwind.css'
import './App.css'
import './styles/brandTokens.css'
import './styles/collectrxAppTheme.css'

/** Fallback shown while a lazily-loaded route chunk is fetched. */
function RouteFallback({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center${fullScreen ? ' min-h-screen' : ' py-24'}`}
      style={fullScreen ? { background: 'var(--crx-bg1)' } : undefined}
    >
      <div className="flex items-center gap-2.5">
        <CollectRxLogoMark size={24} />
        <p className="text-sm font-medium" style={{ color: 'var(--crx-t2)' }}>Loading…</p>
      </div>
    </div>
  )
}

/** Paths that should redirect to the signed-in home route (not render AppShell content). */
function isPostAuthEntryPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path === '/' || path === '/login'
}

/**
 * Practice-user group admins (sessionUser present) home on the PHI-free
 * GroupDashboard. Platform billing-ops/admin sessions also carry the legacy
 * shim role 'group_admin' but have no sessionUser — they keep the
 * billing-ops persona home (/portfolio), whose APIs accept their JWT.
 */
function isPracticeGroupAdmin(role: string | null, sessionUser: unknown): boolean {
  return role === 'group_admin' && sessionUser != null
}

function signedInHomeRoute(groupAdmin: boolean, userRole: UserRole): string {
  return groupAdmin ? '/group-dashboard' : HOME_ROUTE[userRole]
}

function PublicDemoRoute() {
  const { authState, userRole, role, sessionUser } = usePractice()
  if (authState === 'loading') {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--crx-bg1, #F0ECE4)' }}
      >
        <p className="text-sm text-gray-600">Loading…</p>
      </div>
    )
  }
  if (authState === 'ready' && userRole) {
    return <Navigate to={signedInHomeRoute(isPracticeGroupAdmin(role, sessionUser), userRole)} replace />
  }
  return <PilotDemo />
}

function AppHomeFallback() {
  const { userRole, authState, role, sessionUser } = usePractice()
  if (authState === 'anon' || !userRole) {
    return <Navigate to="/login" replace />
  }
  return <Navigate to={signedInHomeRoute(isPracticeGroupAdmin(role, sessionUser), userRole)} replace />
}

function GroupAdminRoute({ children }: { children: ReactNode }) {
  const { authState, role } = usePractice()
  if (authState === 'anon') {
    return <Navigate to="/login" replace />
  }
  if (authState === 'ready' && role !== 'group_admin') {
    return <AppHomeFallback />
  }
  return <>{children}</>
}

type NavItem = { to: string; exact: boolean; label: string; icon: NavIconName }
type NavSection = { label: string; items: NavItem[] }

/** Routes blocked for platform developer sessions (PHI-bearing surfaces). */
const PLATFORM_DEV_BLOCKED_PREFIXES = [
  '/cdcp',
  '/pre-visit',
  '/canadian-2026',
]

const PLATFORM_DEV_NAV_PATHS = new Set([
  '/',
  '/dashboard',
  '/guide',
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

const PRACTICE_OWNER_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', exact: true, label: 'Dashboard', icon: 'dashboard' },
      { to: '/guide', exact: true, label: 'How it works', icon: 'guide' },
    ],
  },
  {
    label: 'After visit',
    items: [
      { to: '/insurance', exact: true, label: 'Claims', icon: 'insurance' },
      { to: '/import', exact: true, label: 'Import CSV', icon: 'download' },
      { to: '/ar-command-center', exact: true, label: 'AR command center', icon: 'workqueue' },
      { to: '/reports/aging', exact: false, label: 'Aging report', icon: 'analytics' },
    ],
  },
  {
    label: 'Before visit',
    items: [
      { to: '/pre-visit', exact: true, label: 'Pre-visit', icon: 'cdcp' },
      { to: '/pre-treatment-estimate', exact: true, label: 'Pre-treatment estimate', icon: 'estimate' },
      { to: '/canadian-2026', exact: true, label: 'CDCP 2026', icon: 'cdcp' },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/billing', exact: true, label: 'Plan & billing', icon: 'settings' },
      { to: '/settings', exact: true, label: 'Settings', icon: 'settings' },
      { to: '/admin/integrations', exact: false, label: 'Integrations', icon: 'admin' },
      { to: '/admin/staff', exact: true, label: 'Staff', icon: 'users' },
    ],
  },
]

const AUDITOR_NAV: NavItem[] = [
  { to: '/reports/aging', exact: false, label: 'Aging report', icon: 'analytics' },
  { to: '/reports/carriers', exact: false, label: 'Carrier stats', icon: 'carriers' },
  { to: '/reports/queue', exact: true, label: 'Queue stats', icon: 'workqueue' },
]

const GROUP_ADMIN_NAV: NavItem[] = [
  { to: '/group-dashboard', exact: true, label: 'Group overview', icon: 'portfolio' },
  { to: '/group/pms-import', exact: true, label: 'Batch PMS import', icon: 'workqueue' },
]

const BILLING_OPS_NAV: NavItem[] = [
  { to: '/portfolio', exact: true, label: 'Portfolio', icon: 'portfolio' },
  { to: '/reports/aging', exact: false, label: 'Aging (all)', icon: 'analytics' },
  { to: '/reports/carriers', exact: false, label: 'Carrier intel', icon: 'carriers' },
  { to: '/escalations', exact: true, label: 'Escalations', icon: 'escalations' },
]

const OFFICE_MANAGER_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', exact: true, label: 'Dashboard', icon: 'dashboard' },
      { to: '/guide', exact: true, label: 'How it works', icon: 'guide' },
    ],
  },
  {
    label: 'After visit',
    items: [
      { to: '/insurance', exact: true, label: 'Claims', icon: 'insurance' },
      { to: '/import', exact: true, label: 'Import CSV', icon: 'download' },
      { to: '/ar-command-center', exact: true, label: 'AR command center', icon: 'workqueue' },
      { to: '/reports/aging', exact: false, label: 'Aging report', icon: 'analytics' },
    ],
  },
  {
    label: 'Before visit',
    items: [
      { to: '/pre-visit', exact: true, label: 'Pre-visit', icon: 'cdcp' },
      { to: '/pre-treatment-estimate', exact: true, label: 'Pre-treatment estimate', icon: 'estimate' },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/billing', exact: true, label: 'Plan & billing', icon: 'settings' },
      { to: '/settings', exact: true, label: 'Settings', icon: 'settings' },
    ],
  },
]

const BILLING_COORDINATOR_NAV: NavItem[] = [
  { to: '/billing', exact: true, label: 'Plan & billing', icon: 'settings' },
  { to: '/insurance', exact: true, label: 'Claims', icon: 'insurance' },
  { to: '/reports/aging', exact: false, label: 'Aging report', icon: 'analytics' },
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
  '/analytics',
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
    label: 'After visit',
    items: [
      { to: '/insurance', exact: true, label: 'Claims', icon: 'insurance' },
    ],
  },
  {
    label: 'Before visit',
    items: [
      { to: '/pre-visit', exact: true, label: 'Pre-visit', icon: 'cdcp' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/analytics', exact: false, label: 'Analytics', icon: 'analytics' },
      { to: '/validation', exact: true, label: 'Validation', icon: 'analytics' },
      { to: '/cdcp', exact: false, label: 'CDCP (legacy)', icon: 'cdcp' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/admin', exact: false, label: 'Admin', icon: 'admin' },
      { to: '/admin/runbook', exact: true, label: 'Runbook', icon: 'admin' },
    ],
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
  groupAdmin?: boolean,
  role?: string | null,
): NavSection[] {
  // Raw-role checks come first: office_manager and billing_coordinator
  // collapse to the practice_owner persona, so their authored navs are only
  // reachable via the session role.
  const personaNav: NavSection[] =
    groupAdmin
      ? [{ label: 'Group', items: GROUP_ADMIN_NAV }]
      : role === 'office_manager'
      ? OFFICE_MANAGER_SECTIONS
      : role === 'billing_coordinator'
      ? [{ label: '', items: BILLING_COORDINATOR_NAV }]
      : userRole === 'auditor'
      ? [{ label: 'Reports', items: AUDITOR_NAV }]
      : userRole === 'billing_ops_manager'
        ? [{ label: 'Operations', items: BILLING_OPS_NAV }]
        : userRole === 'platform_admin' || isPlatformDev
          ? [{ label: 'Platform', items: PLATFORM_ADMIN_NAV }]
          : isPracticeOwner
            ? PRACTICE_OWNER_SECTIONS
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
function SidebarCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="crx-sidebar-close" onClick={onClose} aria-label="Close navigation">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isPlatformDev, isFrontDesk, isPracticeOwner, userRole, role, sessionUser } = usePractice()
  const location = useLocation()

  // Close the mobile drawer whenever the route changes (e.g. after tapping a nav link).
  useEffect(() => {
    onClose()
  }, [location.pathname])

  const sidebarClassName = `crx-sidebar${open ? ' crx-sidebar-open' : ''}`

  if (isFrontDesk) {
    return (
      <>
        {open && <button type="button" className="crx-sidebar-backdrop" onClick={onClose} aria-label="Close navigation" />}
        <aside className={sidebarClassName} aria-label="Front desk navigation">
          <div className="crx-sidebar-head">
            <SidebarBrand to="/console" suffix=" Desk" />
            <SidebarCloseButton onClose={onClose} />
          </div>
          <nav className="crx-sidebar-nav" role="navigation">
            {FRONT_DESK_NAV.map((item) => (
              <SidebarNavLink key={item.to} item={item} />
            ))}
          </nav>
        </aside>
      </>
    )
  }

  const navSections = sidebarNavSections(userRole, isPlatformDev, isPracticeOwner, isPracticeGroupAdmin(role, sessionUser), role)

  return (
    <>
      {open && <button type="button" className="crx-sidebar-backdrop" onClick={onClose} aria-label="Close navigation" />}
      <aside className={sidebarClassName} aria-label="Main navigation">
        <div className="crx-sidebar-head">
          <SidebarBrand />
          {isPlatformDev && userRole !== 'platform_admin' && <span className="crx-sidebar-dev-pill">Dev</span>}
          <SidebarCloseButton onClose={onClose} />
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
    </>
  )
}

function PlatformDevRouteGuard({ children }: { children: ReactNode }) {
  const { isPlatformDev, isFrontDesk, isPracticeOwner, userRole } = usePractice()
  const location = useLocation()
  if (
    isPlatformDev &&
    userRole !== 'platform_admin' &&
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

// ── App shell ─────────────────────────────────────────────────────────────
function AppShell() {
  useBrandAppShellTheme()
  const { sessionHealth, userRole } = usePractice()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  return (
    <div className="crx-app flex min-h-screen">
      <CommandPalette />
      <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="crx-app-main">
        <AppTopBar onToggleNav={() => setMobileNavOpen((v) => !v)} />
        <SessionHealthBanner
          health={sessionHealth}
          isPlatformAdmin={userRole === 'platform_admin'}
        />
        <DesktopConnectorBanner />
        <PlanUsageBanner />
        <main className="crx-app-content" id="main-content">
        <PlatformDevRouteGuard>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/console" element={<ProtectedRoute allowedRoles={['front_desk']}><LiveConsole /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute allowedRoles={['front_desk']}><CallHistory /></ProtectedRoute>} />
          <Route path="/console/history" element={<Navigate to="/history" replace />} />
          <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_ops_manager']}><Dashboard /></ProtectedRoute>} />
          <Route path="/reports/aging" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'auditor', 'billing_ops_manager', 'platform_admin']}><AgingReport /></ProtectedRoute>} />
          <Route path="/reports/carriers" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'auditor', 'billing_ops_manager', 'platform_admin']}><CarrierStats /></ProtectedRoute>} />
          <Route path="/reports/queue" element={<ProtectedRoute allowedRoles={['auditor', 'practice_owner', 'billing_ops_manager', 'platform_admin']}><QueueStatsReport /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'platform_admin']}><PracticeSettings /></ProtectedRoute>} />
          <Route path="/escalations" element={<ProtectedRoute allowedRoles={['front_desk', 'practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager']}><Escalations /></ProtectedRoute>} />
          <Route path="/portfolio" element={<ProtectedRoute allowedRoles={['billing_ops_manager']}><Portfolio /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute allowedRoles={['platform_admin']}><AdminPractices /></ProtectedRoute>} />
          <Route path="/admin/partnerships" element={<ProtectedRoute allowedRoles={['platform_admin']}><PartnershipsBoard /></ProtectedRoute>} />
          <Route path="/admin/partnerships/:id" element={<ProtectedRoute allowedRoles={['platform_admin']}><ProspectDetail /></ProtectedRoute>} />
          <Route path="/admin/health" element={<ProtectedRoute allowedRoles={['platform_admin']}><SystemHealth /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute allowedRoles={['platform_admin']}><UserManagement /></ProtectedRoute>} />
          <Route path="/admin/break-glass" element={<ProtectedRoute allowedRoles={['platform_admin']}><BreakGlass /></ProtectedRoute>} />
          <Route path="/admin/staff" element={<ProtectedRoute allowedRoles={['practice_owner']}><UsersAdmin /></ProtectedRoute>} />
          <Route path="/admin/integrations" element={<ProtectedRoute allowedRoles={['practice_owner', 'platform_admin']}><Admin /></ProtectedRoute>} />
          <Route path="/admin/runbook" element={<ProtectedRoute allowedRoles={['platform_admin']}><PilotRunbook /></ProtectedRoute>} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/guide" element={<OfficeGuide />} />
          <Route path="/download" element={<DesktopDownload />} />
          <Route path="/work-queue" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_ops_manager', 'platform_admin']}><WorkQueue /></ProtectedRoute>} />
          <Route path="/insurance/gates" element={<Navigate to="/insurance?tab=blocked" replace />} />
          <Route path="/insurance" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin']}><InsuranceClaims /></ProtectedRoute>} />
          <Route path="/ar-command-center" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin']}><ArCommandCenter /></ProtectedRoute>} />
          <Route path="/import" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin']}><CsvImportPage /></ProtectedRoute>} />
          <Route path="/insurance/:id" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin']}><InsuranceClaimDetail /></ProtectedRoute>} />
          <Route path="/admin/sync" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin']}><SyncOpsDashboard /></ProtectedRoute>} />
          <Route path="/analytics" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'auditor', 'billing_ops_manager', 'platform_admin']}><Analytics /></ProtectedRoute>} />
          <Route path="/validation" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_ops_manager', 'platform_admin']}><AssumptionValidation /></ProtectedRoute>} />
          <Route path="/usage-insights" element={<ProtectedRoute allowedRoles={['platform_admin', 'practice_owner']}><ProductUsageAnalytics /></ProtectedRoute>} />
          <Route path="/billing" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'accountant']}><PracticeBillingPage /></ProtectedRoute>} />
          <Route path="/cdcp"          element={<Navigate to="/pre-visit?tab=kpis" replace />} />
          <Route path="/pre-visit" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin']}><PreVisitCommandCenter /></ProtectedRoute>} />
          <Route path="/pre-treatment-estimate" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin']}><PreTreatmentEstimate /></ProtectedRoute>} />
          <Route path="/canadian-2026" element={<ProtectedRoute allowedRoles={['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin']}><CanadianExpansion /></ProtectedRoute>} />
          <Route path="/group-dashboard" element={<GroupAdminRoute><GroupDashboard /></GroupAdminRoute>} />
          <Route path="/group/pms-import" element={<GroupAdminRoute><GroupPmsImportPage /></GroupAdminRoute>} />
          <Route path="*" element={<AppHomeFallback />} />
        </Routes>
        </Suspense>
        </PlatformDevRouteGuard>
        </main>
      </div>
    </div>
  )
}

function RedirectToLogin() {
  const location = useLocation()
  useEffect(() => {
    storeLoginRedirect(location.pathname, location.search)
  }, [location.pathname, location.search])
  return <Navigate to="/login" replace />
}

function AnonOrLanding() {
  const { pathname } = useLocation()
  if (pathRequiresAuth(pathname)) {
    return <RedirectToLogin />
  }
  return <MarketingSite />
}

function AnonRoutes() {
  usePublicPortalTheme()
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/download" element={<DesktopDownload />} />
      <Route path="/dashboard" element={<RedirectToLogin />} />
      <Route path="/dashboard/*" element={<RedirectToLogin />} />
      <Route path="/" element={<MarketingSite />} />
      <Route path="/landing" element={<MarketingSite />} />
      <Route path="*" element={<AnonOrLanding />} />
    </Routes>
  )
}

function AuthGate() {
  const { authState, loading, subscription, isPlatformDev, userRole, role, sessionUser } = usePractice()
  const location = useLocation()
  const navigate = useNavigate()
  const [bootComplete, setBootComplete] = useState(false)

  const authReady = authState !== 'loading' && !loading

  useEffect(() => {
    if (authReady) setBootComplete(true)
  }, [authReady])

  const groupAdmin = isPracticeGroupAdmin(role, sessionUser)

  useEffect(() => {
    if (loading || authState !== 'ready' || !userRole) return
    const redirect = consumeLoginRedirect()
    if (redirect) {
      navigate(redirect, { replace: true })
      return
    }
    if (isPostAuthEntryPath(location.pathname)) {
      navigate(signedInHomeRoute(groupAdmin, userRole), { replace: true })
    }
  }, [loading, authState, userRole, groupAdmin, location.pathname, navigate])

  useEffect(() => {
    if (loading || authState !== 'anon') return
    if (!navigator.userAgent?.includes('Electron')) return
    if (location.pathname !== '/' && location.pathname !== '') return
    navigate('/login', { replace: true })
  }, [loading, authState, location.pathname, navigate])

  if (!bootComplete) {
    return <StartupScreen authReady={authReady} onComplete={() => setBootComplete(true)} />
  }

  if (authState === 'loading' || loading) {
    return (
      <div
        className="crx-app min-h-screen flex flex-col items-center justify-center"
        style={{ background: 'var(--crx-bg1)' }}
      >
        <div className="flex items-center gap-2.5">
          <CollectRxLogoMark size={24} />
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
  const shell = (
    <ThemeProvider>
      <ToastProvider>
        <PracticeProvider>
          <AnalyticsSessionBridge>
            <Suspense fallback={<RouteFallback fullScreen />}>
            {isCommandCenterSurface ? (
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/accept-invite" element={<AcceptInvitePage />} />
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="*" element={<AuthGate />} />
              </Routes>
            ) : (
              <Routes>
                <Route path="/" element={<MarketingSite />} />
                <Route path="/legal/terms" element={<LegalTerms />} />
                <Route path="/legal/privacy" element={<LegalPrivacy />} />
                <Route path="/product" element={<ProductOnePager />} />
                <Route path="/changelog" element={<Changelog />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/accept-invite" element={<AcceptInvitePage />} />
                <Route path="/demo" element={<PublicDemoRoute />} />
                <Route path="/demo/process" element={<Navigate to="/demo" replace />} />
                <Route path="/how-it-works" element={<MarketingSite />} />
                <Route path="/roi" element={<MarketingSite />} />
                <Route path="/pricing" element={<MarketingSite />} />
                <Route path="/features" element={<MarketingSite />} />
                <Route path="/carriers" element={<MarketingSite />} />
                <Route path="/compliance" element={<MarketingSite />} />
                <Route path="/about" element={<MarketingSite />} />
                <Route path="/landing" element={<MarketingSite />} />
                <Route path="*" element={<AuthGate />} />
              </Routes>
            )}
            </Suspense>
          </AnalyticsSessionBridge>
        </PracticeProvider>
      </ToastProvider>
    </ThemeProvider>
  )

  return (
    <BrowserRouter>
      {!isCommandCenterSurface && <CookieBanner />}
      {shell}
    </BrowserRouter>
  )
}

export default App
