import * as Icons from './Icons';
import { formatCurrency } from '../utils/format';
import type { DashboardResponse } from '../../types';

const CARRIERS = [
  { name: 'Delta Dental', rate: 89, avgDays: 12, color: 'var(--success)' },
  { name: 'Cigna', rate: 76, avgDays: 18, color: 'var(--brand-primary)' },
  { name: 'Aetna', rate: 71, avgDays: 21, color: 'var(--info)' },
  { name: 'MetLife', rate: 65, avgDays: 24, color: 'var(--warning)' },
  { name: 'Guardian', rate: 54, avgDays: 32, color: 'var(--danger)' },
];

const MONTHLY_TREND = [
  { month: 'Jan', value: 18200 },
  { month: 'Feb', value: 21400 },
  { month: 'Mar', value: 24800 },
  { month: 'Apr', value: 28450 },
];

export function AnalyticsPage({ data: _data }: { data: DashboardResponse | null }) {
  return (
    <>
      <div className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Analytics</h1>
            <p className="page-subtitle">Performance insights and value metrics</p>
          </div>
          <div className="btn-group">
            <select className="form-select" style={{ width: 'auto' }}>
              <option>This Month</option>
              <option>Last Month</option>
              <option>Last 90 Days</option>
              <option>Year to Date</option>
            </select>
            <button className="btn btn-secondary"><Icons.Download /> Export Report</button>
          </div>
        </div>
      </div>

      <div className="page-content">
        <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="metric-card highlight">
            <div className="metric-label">Time Saved This Month</div>
            <div className="metric-value large">47 hrs</div>
            <div className="metric-change">vs ~20 min per claim manually</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Dollars Recovered</div>
            <div className="metric-value">{formatCurrency(28450)}</div>
            <div className="metric-change positive"><Icons.TrendingUp /> +18% vs last month</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Avg Days to Resolution</div>
            <div className="metric-value">18</div>
            <div className="metric-change positive"><Icons.TrendingDown /> -3 days vs last month</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Reminder Effectiveness</div>
            <div className="metric-value">42%</div>
            <div className="metric-change neutral">paid within 7 days</div>
          </div>
        </div>

        <div className="section">
          <div className="section-header"><h3 className="section-title">Resolution Rate by Carrier</h3></div>
          <div className="section-content padded">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {CARRIERS.map((carrier) => (
                <div key={carrier.name} className="stat-bar">
                  <div className="stat-bar-label">{carrier.name}</div>
                  <div className="stat-bar-track">
                    <div className="stat-bar-fill" style={{ width: `${carrier.rate}%`, background: carrier.color }} />
                  </div>
                  <div className="stat-bar-value">{carrier.rate}%</div>
                  <div style={{ width: '80px', fontSize: '12px', color: 'var(--gray-500)' }}>~{carrier.avgDays} days</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          <div className="section">
            <div className="section-header"><h3 className="section-title">Monthly Trend</h3></div>
            <div className="section-content padded">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {MONTHLY_TREND.map(({ month, value }) => (
                  <div key={month} className="stat-bar">
                    <div className="stat-bar-label">{month}</div>
                    <div className="stat-bar-track">
                      <div className="stat-bar-fill" style={{ width: `${(value / 30000) * 100}%`, background: 'var(--brand-primary)' }} />
                    </div>
                    <div className="stat-bar-value">{formatCurrency(value)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-header"><h3 className="section-title">Call Efficiency</h3></div>
            <div className="section-content padded">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {[
                  { value: '156', label: 'Calls Made' },
                  { value: '73%', label: 'First-Call Resolution' },
                  { value: '4.2', label: 'Avg Call Duration (min)' },
                  { value: '$182', label: 'Avg Recovery/Call', highlight: true },
                ].map(({ value, label, highlight }) => (
                  <div key={label} style={{ padding: '16px', background: 'var(--gray-50)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px', fontWeight: 700, color: highlight ? 'var(--brand-primary)' : 'var(--gray-900)' }}>{value}</div>
                    <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
