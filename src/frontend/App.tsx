import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './components/DashboardPage';
import { BalancesPage } from './components/BalancesPage';
import { PatientARPage } from './components/PatientARPage';
import { EstimatesPage } from './components/EstimatesPage';
import { AnalyticsPage } from './components/AnalyticsPage';
import { ReportPage } from './components/ReportPage';
import { AdminPage } from './components/AdminPage';
import { api, getSession, loginRequest, logoutRequest } from './hooks/useApi';
import type { DashboardResponse, PatientSummary } from '../types';

type Page = 'dashboard' | 'balances' | 'patient-ar' | 'estimates' | 'analytics' | 'report' | 'admin';
type AppState = { status: 'boot' } | { status: 'login' } | { status: 'ready' };

function LoginView({ onSuccess }: { onSuccess: () => void }) {
  const [practiceId, setPracticeId] = useState('practice_001');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await loginRequest(practiceId.trim(), password);
      onSuccess();
    } catch {
      setError('Invalid practice ID or password. After seed, try practice_001 / changeme');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loading-state" style={{ minHeight: '100vh', justifyContent: 'center' }}>
      <form
        onSubmit={onSubmit}
        style={{ maxWidth: 360, width: '100%', textAlign: 'left' as const, padding: 24 }}
      >
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Sign in to CollectRx</h1>
        <p style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 16 }}>
          Session is stored in an httpOnly cookie. Rotate default passwords in production.
        </p>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Practice ID</label>
        <input
          value={practiceId}
          onChange={(e) => setPracticeId(e.target.value)}
          style={{ width: '100%', marginBottom: 12, padding: 8, borderRadius: 6, border: '1px solid var(--gray-200)' }}
        />
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', marginBottom: 12, padding: 8, borderRadius: 6, border: '1px solid var(--gray-200)' }}
        />
        {error && <p style={{ color: '#b91c1c', fontSize: 13, marginBottom: 8 }}>{error}</p>}
        <button type="submit" disabled={busy} className="btn btn-primary" style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export function App() {
  const [app, setApp] = useState<AppState>({ status: 'boot' });
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [patients, setPatients] = useState<PatientSummary[]>([]);

  const loadDashboard = useCallback(async () => {
    const [dashboardData, patientsData] = await Promise.all([
      api.fetchDashboard(),
      api.fetchPatients({ status: 'all' }),
    ]);
    setData(dashboardData);
    setPatients(patientsData.patients || []);
  }, []);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (session?.practice?.id) {
        setApp({ status: 'ready' });
        try {
          await loadDashboard();
        } catch (e) {
          console.error(e);
          setApp({ status: 'login' });
        }
      } else {
        setApp({ status: 'login' });
      }
    })();
  }, [loadDashboard]);

  if (app.status === 'boot' || (app.status === 'ready' && !data)) {
    return (
      <div className="loading-state" style={{ height: '100vh' }}>
        <div className="spinner" />
        <p style={{ marginTop: '16px' }}>
          {app.status === 'boot' ? 'Loading CollectRx…' : 'Loading data…'}
        </p>
        {app.status === 'boot' && (
          <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--gray-400)' }}>
            API at same-origin /api (Vite proxy) or port 3001
          </p>
        )}
      </div>
    );
  }

  if (app.status === 'login') {
    return (
      <LoginView
        onSuccess={async () => {
          setApp({ status: 'ready' });
          setData(null);
          try {
            await loadDashboard();
          } catch (e) {
            console.error(e);
            setApp({ status: 'login' });
          }
        }}
      />
    );
  }

  if (!data) {
    return <LoginView onSuccess={loadDashboard} />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage data={data} patients={patients} />;
      case 'balances':
        return <BalancesPage patients={patients} />;
      case 'patient-ar':
        return <PatientARPage patients={patients} />;
      case 'estimates':
        return <EstimatesPage />;
      case 'analytics':
        return <AnalyticsPage data={data} />;
      case 'report':
        return <ReportPage />;
      case 'admin':
        return <AdminPage />;
    }
  };

  return (
    <div className="app-layout">
      <div style={{ position: 'fixed' as const, top: 8, right: 8, zIndex: 10 }}>
        <button
          type="button"
          onClick={() => {
            void logoutRequest().then(() => {
              setData(null);
              setPatients([]);
              setApp({ status: 'login' });
            });
          }}
          className="btn"
          style={{ fontSize: 12 }}
        >
          Sign out
        </button>
      </div>
      <Sidebar currentPage={currentPage} setPage={setCurrentPage} />
      <main className="main-content">{renderPage()}</main>
    </div>
  );
}
