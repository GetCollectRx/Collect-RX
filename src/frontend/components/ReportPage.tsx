import * as Icons from './Icons';
import { formatCurrency } from '../utils/format';

const REPORT = {
  timeSaved: 47,
  arRecovered: 28450,
  callsMade: 156,
  resolutionRate: 73,
  patientPayments: 8420,
  emailsSent: 234,
  avgDaysToResolution: 18,
  topOutstanding: [
    { patient: 'Johnson, Sarah', carrier: 'Delta Dental', amount: 2450, days: 45 },
    { patient: 'Chen, Michael', carrier: 'Cigna', amount: 1890, days: 52 },
    { patient: 'Rodriguez, Emily', carrier: 'Aetna', amount: 1650, days: 38 },
    { patient: 'Thompson, David', carrier: 'MetLife', amount: 1420, days: 61 },
    { patient: 'Lee, Jessica', carrier: 'Guardian', amount: 1180, days: 44 },
  ],
};

export function ReportPage() {
  const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Monthly Report</h1>
            <p className="page-subtitle">Summary for practice owner review</p>
          </div>
          <div className="btn-group">
            <select className="form-select" style={{ width: 'auto' }}>
              <option>March 2026</option>
              <option>February 2026</option>
              <option>January 2026</option>
            </select>
          </div>
        </div>
      </div>

      <div className="page-content">
        <div className="report-container">
          <div className="report-header">
            <div className="report-logo">CollectRx</div>
            <h1 className="report-title">Monthly Performance Report</h1>
            <p className="report-period">{currentMonth}</p>
          </div>

          <div className="report-headline">
            <div className="headline-label">This tool saved you approximately</div>
            <div className="headline-value">{REPORT.timeSaved} hours</div>
            <div className="headline-detail">of manual insurance follow-up work this month</div>
          </div>

          <div className="report-section">
            <h3 className="report-section-title">Key Metrics</h3>
            <div className="report-metric-grid">
              {[
                { label: 'AR Recovered', value: formatCurrency(REPORT.arRecovered) },
                { label: 'Patient Payments', value: formatCurrency(REPORT.patientPayments) },
                { label: 'Calls Made', value: String(REPORT.callsMade) },
                { label: 'Resolution Rate', value: `${REPORT.resolutionRate}%` },
                { label: 'Reminders Sent', value: String(REPORT.emailsSent) },
                { label: 'Avg Days to Resolution', value: String(REPORT.avgDaysToResolution) },
              ].map(({ label, value }) => (
                <div key={label} className="report-metric">
                  <div className="report-metric-label">{label}</div>
                  <div className="report-metric-value">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="report-section">
            <h3 className="report-section-title">Top Outstanding Claims</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Patient</th><th>Carrier</th><th>Amount</th><th>Days Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {REPORT.topOutstanding.map((item, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{item.patient}</td>
                    <td>{item.carrier}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(item.amount)}</td>
                    <td>
                      <span className={`badge ${item.days >= 60 ? 'badge-danger' : item.days >= 30 ? 'badge-warning' : 'badge-success'}`}>
                        {item.days} days
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="report-section" style={{ background: 'var(--gray-50)' }}>
            <h3 className="report-section-title">Summary</h3>
            <p style={{ fontSize: '14px', color: 'var(--gray-600)', lineHeight: 1.7 }}>
              This month, CollectRx automated {REPORT.callsMade} insurance follow-up calls and sent {REPORT.emailsSent} patient payment reminders,
              recovering <strong>{formatCurrency(REPORT.arRecovered + REPORT.patientPayments)}</strong> in total outstanding balances.
              The average claim resolution time improved to {REPORT.avgDaysToResolution} days,
              with a {REPORT.resolutionRate}% first-call resolution rate.
            </p>
          </div>

          <div className="report-actions">
            <button className="btn btn-primary" onClick={() => window.print()}><Icons.Printer /> Print Report</button>
            <button className="btn btn-secondary"><Icons.Mail /> Email Report</button>
            <button className="btn btn-secondary"><Icons.Download /> Download PDF</button>
          </div>
        </div>
      </div>
    </>
  );
}
