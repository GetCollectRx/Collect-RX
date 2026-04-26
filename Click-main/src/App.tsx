import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { PracticeProvider, usePractice } from './context/PracticeContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import logo from './assets/collectrx-logo.svg'
import './App.css'

// Route-level code splitting with React.lazy
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Balances = lazy(() => import('./pages/Balances'))
const BalanceDetail = lazy(() => import('./pages/BalanceDetail'))
const Outbox = lazy(() => import('./pages/Outbox'))
const PatientAR = lazy(() => import('./pages/PatientAR'))
const PreTreatmentEstimate = lazy(() => import('./pages/PreTreatmentEstimate'))
const Admin = lazy(() => import('./pages/Admin'))
const PaymentPage = lazy(() => import('./pages/PaymentPage'))
const Settings = lazy(() => import('./pages/Settings'))
const Login = lazy(() => import('./pages/Login'))

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const location = useLocation()
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to))
  return (
    <Link to={to} className={isActive ? 'active' : ''} aria-current={isActive ? 'page' : undefined}>
      {children}
    </Link>
  )
}

function Navbar() {
  const { practices, practiceId, setPracticeId } = usePractice()
  const { user, logout } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <Link to="/" className="navbar-brand" aria-label="CollectRx home">
        <img src={logo} alt="" style={{ width: 32, height: 32 }} aria-hidden="true" />
        <span className="navbar-brand-text">Collect<span>Rx</span></span>
      </Link>

      {/* Mobile hamburger button */}
      <button
        className="mobile-menu-toggle"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-expanded={mobileMenuOpen}
        aria-controls="main-nav-links"
        aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
      >
        <span className="hamburger-line" />
        <span className="hamburger-line" />
        <span className="hamburger-line" />
      </button>

      <div
        id="main-nav-links"
        className={`nav-links ${mobileMenuOpen ? 'nav-links-open' : ''}`}
        role="menubar"
      >
        <NavLink to="/">Dashboard</NavLink>
        <NavLink to="/analytics">Analytics</NavLink>
        <NavLink to="/balances">Balances</NavLink>
        <NavLink to="/patient-ar">Patient AR</NavLink>
        <NavLink to="/estimate">Estimate</NavLink>
        <NavLink to="/outbox">Outbox</NavLink>
        <NavLink to="/admin">Admin</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </div>

      {practices.length > 1 && (
        <select
          className="navbar-practice-select"
          value={practiceId}
          onChange={e => setPracticeId(e.target.value)}
          aria-label="Select practice"
        >
          {practices.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
      {practices.length === 1 && (
        <span className="navbar-practice-name">{practices[0].name}</span>
      )}

      {user && (
        <button
          className="btn btn-secondary logout-btn"
          onClick={logout}
          title={`Signed in as ${user.email}`}
          aria-label="Sign out"
        >
          Sign out
        </button>
      )}
    </nav>
  )
}

function PageLoading() {
  return <div className="loading" role="status" aria-label="Loading page">Loading...</div>
}

function AppShell() {
  const { user, isLoading } = useAuth()

  if (isLoading) return <PageLoading />

  // Payment page is public — patients pay without logging in
  if (!user && window.location.pathname.startsWith('/pay/')) {
    return (
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/pay/:balanceId" element={<PaymentPage />} />
        </Routes>
      </Suspense>
    )
  }

  if (!user) {
    return (
      <Suspense fallback={<PageLoading />}>
        <Login />
      </Suspense>
    )
  }

  return (
    <PracticeProvider>
      <div className="app">
        <Navbar />
        <div className="content">
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/balances" element={<Balances />} />
              <Route path="/balances/:id" element={<BalanceDetail />} />
              <Route path="/outbox" element={<Outbox />} />
              <Route path="/patient-ar" element={<PatientAR />} />
              <Route path="/estimate" element={<PreTreatmentEstimate />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/pay/:balanceId" element={<PaymentPage />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </PracticeProvider>
  )
}

function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
