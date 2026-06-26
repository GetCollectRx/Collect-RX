import { useCallback, useEffect, useState } from 'react';
import { usePractice } from '../context/PracticeContext';
import { apiFetchJson } from '../lib/apiFetch';

interface CdcpCase {
  id: string;
  procedureCode: string | null;
  denialDate: string;
  status: string;
  daysRemaining: number;
  windowExpired: boolean;
  patientToken: string;
}

interface VerificationRow {
  id: string;
  patientToken: string;
  carrierId: string;
  procedureCodes: string[];
  appointmentAt: string;
  status: string;
  reason: string | null;
  cdcpDaysRemaining: number | null;
  missingArtifacts: string[];
}

function statusColor(status: string): string {
  if (status === 'GREEN') return '#16a34a';
  if (status === 'YELLOW') return '#ca8a04';
  return '#dc2626';
}

export default function PreVisitCommandCenter() {
  const { practiceId } = usePractice();
  const [deadlines, setDeadlines] = useState<CdcpCase[]>([]);
  const [verifications, setVerifications] = useState<VerificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      const [dl, ver] = await Promise.all([
        apiFetchJson<{ cases: CdcpCase[] }>('/api/pre-visit/cdcp-deadlines'),
        apiFetchJson<{ verifications: VerificationRow[] }>('/api/pre-visit/verifications'),
      ]);
      setDeadlines(dl.cases ?? []);
      setVerifications(ver.verifications ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const expiringSoon = deadlines.filter((c) => c.daysRemaining <= 14);
  const urgent = deadlines.filter((c) => c.daysRemaining <= 7);

  return (
    <div className="crx-page" style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>Pre-visit command center</h1>
        <p style={{ color: '#64748b', fontSize: 14 }}>
          CDCP reconsideration deadlines and appointment verification signals before patients arrive.
        </p>
      </header>

      {error && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="crx-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{deadlines.length}</div>
          <div style={{ color: '#64748b', fontSize: 13 }}>Open CDCP reconsiderations</div>
        </div>
        <div className="crx-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#ca8a04' }}>{expiringSoon.length}</div>
          <div style={{ color: '#64748b', fontSize: 13 }}>Expiring within 14 days</div>
        </div>
        <div className="crx-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#dc2626' }}>{urgent.length}</div>
          <div style={{ color: '#64748b', fontSize: 13 }}>Urgent — 7 days or less</div>
        </div>
      </div>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>CDCP deadline tracker</h2>
        {loading ? (
          <p>Loading…</p>
        ) : deadlines.length === 0 ? (
          <p style={{ color: '#64748b' }}>No open CDCP reconsideration cases.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '8px 4px' }}>Procedure</th>
                <th>Status</th>
                <th>Days left</th>
                <th>Denial date</th>
                <th>Patient token</th>
              </tr>
            </thead>
            <tbody>
              {deadlines.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 4px' }}>{c.procedureCode ?? '—'}</td>
                  <td>{c.status}</td>
                  <td style={{ color: c.daysRemaining <= 7 ? '#dc2626' : c.daysRemaining <= 14 ? '#ca8a04' : undefined }}>
                    {c.daysRemaining}
                  </td>
                  <td>{new Date(c.denialDate).toLocaleDateString()}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.patientToken.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Upcoming appointment verifications</h2>
        {verifications.length === 0 ? (
          <p style={{ color: '#64748b' }}>No verifications yet. Ingest appointments via API or POST /api/pre-visit/verify.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '8px 4px' }}>Appointment</th>
                <th>Carrier</th>
                <th>Procedures</th>
                <th>Signal</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {verifications.map((v) => (
                <tr key={v.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 4px' }}>{new Date(v.appointmentAt).toLocaleString()}</td>
                  <td>{v.carrierId}</td>
                  <td>{v.procedureCodes.join(', ')}</td>
                  <td style={{ color: statusColor(v.status), fontWeight: 600 }}>{v.status}</td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>{v.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
