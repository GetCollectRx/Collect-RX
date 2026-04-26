import * as Icons from './Icons';
import { formatCurrency } from '../utils/format';
import type { DashboardResponse, PatientSummary } from '../../types';

interface DashboardPageProps {
  data: DashboardResponse | null;
  patients: PatientSummary[];
}

const RECENT_ACTIVITY = [
  { type: 'call', text: 'Call completed with <strong>Delta Dental</strong> for Sarah Johnson', time: '5 min ago' },
  { type: 'payment', text: '<strong>$450</strong> payment received from Michael Chen', time: '12 min ago' },
  { type: 'reminder', text: 'Reminder sent to <strong>Emily Rodriguez</strong>', time: '28 min ago' },
  { type: 'call', text: 'Claim resolved for <strong>David Thompson</strong> - $1,240', time: '45 min ago' },
  { type: 'email', text: 'Payment link opened by <strong>Jessica Lee</strong>', time: '1 hr ago' },
  { type: 'payment', text: '<strong>$125</strong> payment received from Robert Martinez', time: '1 hr ago' },
  { type: 'call', text: 'Follow-up scheduled with <strong>Cigna</strong>', time: '2 hr ago' },
  { type: 'reminder', text: 'Second reminder sent to <strong>Amanda Wilson</strong>', time: '2 hr ago' },
  { type: 'payment', text: '<strong>$890</strong> payment received from James Brown', time: '3 hr ago' },
  { type: 'call', text: 'Claim submitted to <strong>Aetna</strong> for Lisa Garcia', time: '3 hr ago' },
];

export function DashboardPage({ data }: DashboardPageProps) {
  const insuranceAR = 62450;
  const patientAR = (data?.practice?.totalAR ?? 87340) - insuranceAR;
  const claimsResolvedThisWeek = 23;
  const claimsResolvedLastWeek = 18;
  const paymentsThisWeek = 12480;
  const paymentsLastWeek = 9340;

  return (
    <>
      <div className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Your daily command center</p>
          </div>
          <div className="btn-group">
            <button className="btn btn-secondary"><Icons.Download /> Export</button>
          </div>
        </div>
      </div>

      <div className="page-content">
        <div className="metric-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="metric-card highlight">
            <div className="metric-label">Total Outstanding AR</div>
            <div className="metric-value large">{formatCurrency(data?.practice?.totalAR ?? 87340)}</div>
            <div className="metric-change">
              {data?.practice?.activeBalances ?? 342} active balances across insurance and patient accounts
            </div>
          </div>
        </div>

        <div className="metric-split mb-6">
          <div className="split-card">
            <div className="split-card-header">
              <div className="split-card-icon insurance"><Icons.Building /></div>
              <span className="split-card-title">Insurance AR</span>
            </div>
            <div className="split-card-value">{formatCurrency(insuranceAR)}</div>
            <div className="split-card-detail">
              <span className="metric-change positive" style={{ marginTop: 0 }}>
                <Icons.TrendingDown /> Down 8% from last month
              </span>
            </div>
          </div>

          <div className="split-card">
            <div className="split-card-header">
              <div className="split-card-icon patient"><Icons.Users /></div>
              <span className="split-card-title">Patient AR</span>
            </div>
            <div className="split-card-value">{formatCurrency(patientAR)}</div>
            <div className="split-card-detail">
              <span className="metric-change positive" style={{ marginTop: 0 }}>
                <Icons.TrendingDown /> Down 12% from last month
              </span>
            </div>
          </div>
        </div>

        <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="metric-card">
            <div className="metric-label">Claims Resolved This Week</div>
            <div className="metric-value">{claimsResolvedThisWeek}</div>
            <div className="metric-change positive">
              <Icons.TrendingUp /> +{claimsResolvedThisWeek - claimsResolvedLastWeek} vs last week
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Payments Collected This Week</div>
            <div className="metric-value">{formatCurrency(paymentsThisWeek)}</div>
            <div className="metric-change positive">
              <Icons.TrendingUp /> +{Math.round((paymentsThisWeek - paymentsLastWeek) / paymentsLastWeek * 100)}% vs last week
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Emails Sent</div>
            <div className="metric-value">{data?.metrics?.emailsSent ?? 156}</div>
            <div className="metric-change neutral">This month</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Recovery Rate</div>
            <div className="metric-value">{data?.metrics?.recoveryRate ?? 34}%</div>
            <div className="metric-change positive"><Icons.TrendingUp /> +4% from last month</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px' }}>
          <div className="section">
            <div className="section-header"><h3 className="section-title">Call Queue Status</h3></div>
            <div className="section-content padded">
              <div className="queue-status">
                <div className="queue-stat"><div className="queue-stat-value">12</div><div className="queue-stat-label">Queued</div></div>
                <div className="queue-stat running"><div className="queue-stat-value">3</div><div className="queue-stat-label">Running</div></div>
                <div className="queue-stat"><div className="queue-stat-value">47</div><div className="queue-stat-label">Completed Today</div></div>
              </div>
              <button className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>
                <Icons.Phone /> View Call Queue
              </button>
            </div>
          </div>

          <div className="section">
            <div className="section-header">
              <h3 className="section-title">Recent Activity</h3>
              <span style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Last 10 actions</span>
            </div>
            <div className="activity-list">
              {RECENT_ACTIVITY.map((activity, i) => (
                <div key={i} className="activity-item">
                  <div className={`activity-icon ${activity.type}`}>
                    {(activity.type === 'call') && <Icons.Phone />}
                    {(activity.type === 'payment') && <Icons.DollarSign />}
                    {(activity.type === 'reminder' || activity.type === 'email') && <Icons.Mail />}
                  </div>
                  <div className="activity-content">
                    <div className="activity-text" dangerouslySetInnerHTML={{ __html: activity.text }} />
                    <div className="activity-time">{activity.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
