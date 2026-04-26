import { useState } from 'react';
import * as Icons from './Icons';

export function AdminPage() {
  const [practiceName, setPracticeName] = useState('Smile Dental Care');
  const [reminderCadence, setReminderCadence] = useState('7');

  return (
    <>
      <div className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">Configure your practice and integrations</p>
          </div>
        </div>
      </div>

      <div className="page-content">
        <div className="settings-grid">
          <div className="settings-card">
            <div className="settings-card-header">
              <div className="settings-card-icon"><Icons.Building /></div>
              <div>
                <div className="settings-card-title">Practice Settings</div>
                <div className="settings-card-subtitle">Basic practice information</div>
              </div>
            </div>
            <div className="settings-card-content">
              <div className="form-group">
                <label className="form-label">Practice Name</label>
                <input type="text" className="form-input" value={practiceName}
                  onChange={(e) => setPracticeName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Default Reminder Cadence (days)</label>
                <select className="form-select" value={reminderCadence}
                  onChange={(e) => setReminderCadence(e.target.value)}>
                  <option value="3">Every 3 days</option>
                  <option value="7">Every 7 days</option>
                  <option value="14">Every 14 days</option>
                  <option value="30">Every 30 days</option>
                </select>
              </div>
              <button className="btn btn-primary" style={{ marginTop: '8px' }}>Save Changes</button>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">
              <div className="settings-card-icon"><Icons.Activity /></div>
              <div>
                <div className="settings-card-title">Carrier Priorities</div>
                <div className="settings-card-subtitle">Call queue ordering by carrier</div>
              </div>
            </div>
            <div className="settings-card-content">
              {[
                { name: 'Delta Dental', priority: 'High Priority' },
                { name: 'Cigna', priority: 'High Priority' },
                { name: 'Aetna', priority: 'Medium Priority' },
                { name: 'MetLife', priority: 'Medium Priority' },
                { name: 'Guardian', priority: 'Low Priority' },
              ].map(({ name, priority }, i) => (
                <div key={name} className="settings-row">
                  <span className="settings-row-label">{i + 1}. {name}</span>
                  <span className="settings-row-value">{priority}</span>
                </div>
              ))}
              <button className="btn btn-secondary" style={{ marginTop: '12px', width: '100%' }}>Edit Priorities</button>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">
              <div className="settings-card-icon" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>
                <Icons.CreditCard />
              </div>
              <div>
                <div className="settings-card-title">Stripe Connect</div>
                <div className="settings-card-subtitle">Payment processing status</div>
              </div>
            </div>
            <div className="settings-card-content">
              <div className="settings-row">
                <span className="settings-row-label">Connection Status</span>
                <span className="status-indicator">
                  <span className="status-dot online" />
                  <span className="settings-row-value">Connected</span>
                </span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Payouts Enabled</span>
                <span className="badge badge-success">Active</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Account ID</span>
                <span className="settings-row-value font-mono">acct_1Mx...4Zq</span>
              </div>
              <button className="btn btn-secondary" style={{ marginTop: '12px', width: '100%' }}>View in Stripe</button>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">
              <div className="settings-card-icon" style={{ background: 'var(--info-light)', color: 'var(--info)' }}>
                <Icons.Shield />
              </div>
              <div>
                <div className="settings-card-title">Environment Health</div>
                <div className="settings-card-subtitle">System and sync status</div>
              </div>
            </div>
            <div className="settings-card-content">
              <div className="settings-row">
                <span className="settings-row-label">Abeldent Sync</span>
                <span className="status-indicator">
                  <span className="status-dot online" /><span className="settings-row-value">Healthy</span>
                </span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Last Sync</span>
                <span className="settings-row-value">5 minutes ago</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Webhook Status</span>
                <span className="status-indicator">
                  <span className="status-dot online" /><span className="settings-row-value">All systems operational</span>
                </span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">API Version</span>
                <span className="settings-row-value font-mono">v2.4.1</span>
              </div>
              <button className="btn btn-secondary" style={{ marginTop: '12px', width: '100%' }}>
                <Icons.RefreshCw /> Force Sync
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
