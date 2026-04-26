import { useState, Fragment } from 'react';
import * as Icons from './Icons';
import { formatCurrency, getAgeClass } from '../utils/format';
import { api } from '../hooks/useApi';
import type { PatientSummary } from '../../types';

type Step = 'completed' | 'active' | 'pending';

function getReminderSteps(patient: PatientSummary): Step[] {
  const sent = patient.emailContactAttempts || 0;
  return Array.from({ length: 4 }, (_, i) => {
    if (i < sent) return 'completed';
    if (i === sent) return 'active';
    return 'pending';
  });
}

export function PatientARPage({ patients }: { patients: PatientSummary[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = patients.filter((p) => {
    if (search && !`${p.firstName} ${p.lastName} ${p.email}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    return true;
  });

  const handleSendReminder = async (patientId: string) => {
    try {
      await api.sendReminder(patientId);
      alert('Reminder sent successfully');
    } catch {
      alert('Failed to send reminder');
    }
  };

  const handleCopyPaymentLink = async (patientId: string) => {
    try {
      const data = await api.generatePaymentLink(patientId);
      await navigator.clipboard.writeText(data.paymentLink);
      alert('Payment link copied to clipboard');
    } catch {
      alert('Failed to generate payment link');
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Patient AR</h1>
            <p className="page-subtitle">Outstanding patient balances and reminder status</p>
          </div>
          <div className="btn-group">
            <button className="btn btn-secondary"><Icons.Download /> Export</button>
            <button className="btn btn-primary"><Icons.Mail /> Send Bulk Reminders</button>
          </div>
        </div>
      </div>

      <div className="page-content">
        <div className="section">
          <div className="toolbar">
            <div className="toolbar-left">
              <div className="search-input-wrapper" style={{ width: '300px' }}>
                <Icons.Search />
                <input type="text" className="form-input" placeholder="Search patients..."
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="form-select" value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
                <option value="all">All Statuses</option>
                <option value="pending_payment">Pending Payment</option>
                <option value="payment_plan">Payment Plan</option>
                <option value="responsive">Responsive</option>
                <option value="needs_attention">Needs Attention</option>
              </select>
            </div>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Balance</th>
                  <th>Age</th>
                  <th>Reminder Sequence</th>
                  <th>Payment Link</th>
                  <th>Status</th>
                  <th style={{ width: '120px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((patient) => {
                  const steps = getReminderSteps(patient);
                  return (
                    <tr key={patient.id}>
                      <td>
                        <div className="cell-primary">{patient.firstName} {patient.lastName}</div>
                        <div className="cell-secondary">{patient.email}</div>
                      </td>
                      <td>
                        <span className={`cell-amount age-${getAgeClass(patient.daysOutstanding)}`}>
                          {formatCurrency(patient.balanceAmount)}
                        </span>
                        {patient.paymentPlanActive && patient.paymentPlanAmount && (
                          <div className="cell-secondary">{formatCurrency(patient.paymentPlanAmount)}/mo plan</div>
                        )}
                      </td>
                      <td>
                        <div className="age-indicator">
                          <span className={`age-dot ${getAgeClass(patient.daysOutstanding)}`}></span>
                          {patient.daysOutstanding} days
                        </div>
                      </td>
                      <td>
                        <div className="reminder-sequence">
                          {steps.map((step, i) => (
                            <Fragment key={i}>
                              <div className={`reminder-step ${step}`}>
                                {step === 'completed' ? <Icons.Check /> : i + 1}
                              </div>
                              {i < steps.length - 1 && (
                                <div className={`reminder-connector ${step === 'completed' ? 'completed' : ''}`} />
                              )}
                            </Fragment>
                          ))}
                        </div>
                      </td>
                      <td>
                        {patient.paymentLinkClicked ? (
                          <span className="badge badge-success">Opened</span>
                        ) : patient.emailClicks > 0 ? (
                          <span className="badge badge-info">Sent</span>
                        ) : (
                          <span className="badge badge-neutral">Not sent</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${
                          patient.status === 'needs_attention' ? 'badge-danger' :
                          patient.status === 'payment_plan' ? 'badge-info' :
                          patient.status === 'responsive' ? 'badge-success' : 'badge-warning'
                        }`}>
                          {patient.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => handleSendReminder(patient.id)}>
                            <Icons.Mail />
                          </button>
                          <button className="btn btn-secondary btn-sm" title="Copy Payment Link"
                            onClick={() => handleCopyPaymentLink(patient.id)}>
                            <Icons.Link />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
