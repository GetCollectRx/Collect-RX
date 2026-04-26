import { useState, useMemo } from 'react';
import * as Icons from './Icons';
import { formatCurrency, getAgeClass } from '../utils/format';
import type { PatientSummary } from '../../types';

interface Claim extends PatientSummary {
  carrier: string;
  claimNumber: string;
  serviceDate: string;
  claimStatus: string;
}

const CARRIERS = ['Delta Dental', 'Cigna', 'Aetna', 'MetLife', 'Guardian'] as const;
const CLAIM_STATUSES = ['Pending', 'In Review', 'Needs Follow-up', 'Awaiting Info'] as const;

export function BalancesPage({ patients }: { patients: PatientSummary[] }) {
  const [search, setSearch] = useState('');
  const [ageFilter, setAgeFilter] = useState('all');
  const [selected, setSelected] = useState(new Set<string>());

  const claims = useMemo<Claim[]>(
    () =>
      patients.map((p) => ({
        ...p,
        carrier: CARRIERS[Math.floor(Math.random() * CARRIERS.length)],
        claimNumber: `CLM-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
        serviceDate: new Date(Date.now() - p.daysOutstanding * 24 * 60 * 60 * 1000).toISOString(),
        claimStatus: CLAIM_STATUSES[Math.floor(Math.random() * CLAIM_STATUSES.length)],
      })),
    [patients]
  );

  const filtered = claims.filter((c) => {
    if (search && !`${c.firstName} ${c.lastName} ${c.carrier}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (ageFilter === 'current' && c.daysOutstanding >= 30) return false;
    if (ageFilter === '30-60' && (c.daysOutstanding < 30 || c.daysOutstanding >= 60)) return false;
    if (ageFilter === '60+' && c.daysOutstanding < 60) return false;
    return true;
  });

  const totalShown = filtered.reduce((s, c) => s + c.balanceAmount, 0);
  const totalSelected = [...selected].reduce((s, id) => s + (claims.find((c) => c.id === id)?.balanceAmount ?? 0), 0);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () =>
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.id)));

  return (
    <>
      <div className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Insurance AR</h1>
            <p className="page-subtitle">Outstanding insurance claims awaiting payment</p>
          </div>
          <div className="btn-group">
            <button className="btn btn-secondary"><Icons.Download /> Export</button>
            <button className="btn btn-primary"><Icons.Phone /> Start Call Session</button>
          </div>
        </div>
      </div>

      <div className="page-content">
        <div className="section">
          <div className="toolbar">
            <div className="toolbar-left">
              <div className="search-input-wrapper" style={{ width: '300px' }}>
                <Icons.Search />
                <input type="text" className="form-input" placeholder="Search by patient or carrier..."
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="filter-pills">
                {(['all', 'current', '30-60', '60+'] as const).map((f) => (
                  <button key={f} className={`filter-pill ${ageFilter === f ? 'active' : ''}`}
                    onClick={() => setAgeFilter(f)}>
                    {f === 'all' ? 'All' : f === 'current' ? 'Current' : f === '30-60' ? '30-60 days' : '60+ days'}
                  </button>
                ))}
              </div>
            </div>
            <div className="toolbar-right">
              <button className="btn btn-ghost btn-icon"><Icons.Filter /></button>
            </div>
          </div>

          <div className="summary-bar">
            <div className="summary-stats">
              <div className="summary-stat">
                <span className="summary-stat-label">Showing</span>
                <span className="summary-stat-value">{filtered.length} claims</span>
              </div>
              <div className="summary-stat">
                <span className="summary-stat-label">Total</span>
                <span className="summary-stat-value">{formatCurrency(totalShown)}</span>
              </div>
              {selected.size > 0 && (
                <div className="summary-stat">
                  <span className="summary-stat-label">Selected</span>
                  <span className="summary-stat-value">{selected.size} ({formatCurrency(totalSelected)})</span>
                </div>
              )}
            </div>
            {selected.size > 0 && (
              <div className="bulk-actions">
                <button className="btn btn-secondary btn-sm"><Icons.Phone /> Call Selected</button>
                <button className="btn btn-secondary btn-sm"><Icons.Mail /> Send Reminders</button>
              </div>
            )}
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>
                    <input type="checkbox" className="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll} />
                  </th>
                  <th>Patient / Claim</th>
                  <th>Carrier</th>
                  <th>Amount</th>
                  <th>Age</th>
                  <th>Status</th>
                  <th style={{ width: '180px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((claim) => (
                  <tr key={claim.id}>
                    <td>
                      <input type="checkbox" className="checkbox"
                        checked={selected.has(claim.id)} onChange={() => toggle(claim.id)} />
                    </td>
                    <td>
                      <div className="cell-primary">{claim.firstName} {claim.lastName}</div>
                      <div className="cell-secondary font-mono">{claim.claimNumber}</div>
                    </td>
                    <td>{claim.carrier}</td>
                    <td>
                      <span className={`cell-amount age-${getAgeClass(claim.daysOutstanding)}`}>
                        {formatCurrency(claim.balanceAmount)}
                      </span>
                    </td>
                    <td>
                      <div className="age-indicator">
                        <span className={`age-dot ${getAgeClass(claim.daysOutstanding)}`}></span>
                        {claim.daysOutstanding} days
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${
                        claim.claimStatus === 'Needs Follow-up' ? 'badge-warning' :
                        claim.claimStatus === 'Awaiting Info' ? 'badge-danger' : 'badge-neutral'
                      }`}>{claim.claimStatus}</span>
                    </td>
                    <td className="text-right">
                      <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm">View</button>
                        <button className="btn btn-secondary btn-sm"><Icons.Phone /></button>
                        <button className="btn btn-ghost btn-sm btn-icon"><Icons.Trash /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
