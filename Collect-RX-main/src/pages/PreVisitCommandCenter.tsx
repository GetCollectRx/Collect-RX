import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
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

interface AdjudicationGraphBucket {
  key: string;
  count: number;
  successCount: number;
}

interface AdjudicationGraph {
  totalEvents: number;
  byCallType: AdjudicationGraphBucket[];
  byDenialCode: AdjudicationGraphBucket[];
  byCarrier: AdjudicationGraphBucket[];
  weeklyTrend: Array<{
    weekStart: string;
    events: number;
    successRate: number;
    medianDurationMs: number | null;
  }>;
  days: number;
}

interface Phase5Kpis {
  reconsiderationSuccessRate: number;
  ivrNavigationSuccessRate: number;
  authenticationSuccessRate: number;
  statusRetrievalAccuracy: number;
  denialTaxonomyMappingAccuracy: number;
  zeroHallucinationRate: number;
  disclosureComplianceRate: number;
  medianCallDurationMinutes: number;
  totalCalls: number;
  source: 'live' | 'insufficient_data';
}

type Tab = 'overview' | 'verifications' | 'deadlines' | 'adjudication' | 'kpis';

function statusColor(status: string): string {
  if (status === 'GREEN') return '#16a34a';
  if (status === 'YELLOW') return '#ca8a04';
  return '#dc2626';
}

function BucketTable({ title, buckets }: { title: string; buckets: AdjudicationGraphBucket[] }) {
  if (buckets.length === 0) {
    return (
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
        <p style={{ color: '#64748b', fontSize: 13 }}>No data yet.</p>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
            <th style={{ padding: '6px 4px' }}>Key</th>
            <th>Events</th>
            <th>Success</th>
          </tr>
        </thead>
        <tbody>
          {buckets.slice(0, 12).map((b) => (
            <tr key={b.key} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '6px 4px', fontFamily: 'monospace', fontSize: 12 }}>{b.key}</td>
              <td>{b.count}</td>
              <td>{b.successCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const KPI_LABELS: Array<{ key: keyof Phase5Kpis; label: string; unit: string }> = [
  { key: 'reconsiderationSuccessRate', label: 'Reconsideration success', unit: '%' },
  { key: 'ivrNavigationSuccessRate', label: 'IVR navigation', unit: '%' },
  { key: 'authenticationSuccessRate', label: 'Authentication', unit: '%' },
  { key: 'statusRetrievalAccuracy', label: 'Status retrieval', unit: '%' },
  { key: 'denialTaxonomyMappingAccuracy', label: 'Denial taxonomy', unit: '%' },
  { key: 'disclosureComplianceRate', label: 'Disclosure compliance', unit: '%' },
  { key: 'medianCallDurationMinutes', label: 'Median call duration', unit: ' min' },
  { key: 'totalCalls', label: 'Total interactions', unit: '' },
];

export default function PreVisitCommandCenter() {
  const { practiceId } = usePractice();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as Tab) || 'overview';
  const [deadlines, setDeadlines] = useState<CdcpCase[]>([]);
  const [verifications, setVerifications] = useState<VerificationRow[]>([]);
  const [graph, setGraph] = useState<AdjudicationGraph | null>(null);
  const [kpis, setKpis] = useState<Phase5Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setTab = (t: Tab) => {
    setSearchParams({ tab: t });
  };

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      const requests: Promise<void>[] = [
        apiFetchJson<{ cases: CdcpCase[] }>('/api/pre-visit/cdcp-deadlines').then((dl) => {
          setDeadlines(dl.cases ?? []);
        }),
        apiFetchJson<{ verifications: VerificationRow[] }>('/api/pre-visit/verifications').then((ver) => {
          setVerifications(ver.verifications ?? []);
        }),
      ];
      if (tab === 'adjudication' || tab === 'overview') {
        requests.push(
          apiFetchJson<{ graph: AdjudicationGraph }>('/api/pre-visit/adjudication-graph?days=90').then((res) => {
            setGraph(res.graph);
          }),
        );
      }
      if (tab === 'kpis' || tab === 'overview') {
        requests.push(
          apiFetchJson<{ success: boolean; data: Phase5Kpis }>('/api/analytics/phase5-kpis?days=30').then((res) => {
            setKpis(res.data);
          }),
        );
      }
      await Promise.all(requests);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [practiceId, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const expiringSoon = deadlines.filter((c) => c.daysRemaining <= 14);
  const urgent = deadlines.filter((c) => c.daysRemaining <= 7);
  const greenCount = verifications.filter((v) => v.status === 'GREEN').length;
  const redCount = verifications.filter((v) => v.status === 'RED').length;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'verifications', label: 'Verifications' },
    { id: 'deadlines', label: 'CDCP deadlines' },
    { id: 'adjudication', label: 'Adjudication graph' },
    { id: 'kpis', label: 'KPIs' },
  ];

  return (
    <div className="crx-page" style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>Pre-visit command center</h1>
        <p style={{ color: '#64748b', fontSize: 14 }}>
          CDCP deadlines, appointment verification signals, and carrier adjudication analytics.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              background: tab === t.id ? '#0f766e' : '#fff',
              color: tab === t.id ? '#fff' : '#334155',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && <p style={{ color: '#64748b' }}>Loading…</p>}

      {!loading && tab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 24 }}>
            <div className="crx-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{deadlines.length}</div>
              <div style={{ color: '#64748b', fontSize: 13 }}>Open CDCP cases</div>
            </div>
            <div className="crx-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#16a34a' }}>{greenCount}</div>
              <div style={{ color: '#64748b', fontSize: 13 }}>GREEN verifications</div>
            </div>
            <div className="crx-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#dc2626' }}>{redCount}</div>
              <div style={{ color: '#64748b', fontSize: 13 }}>RED verifications</div>
            </div>
            <div className="crx-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{graph?.totalEvents ?? 0}</div>
              <div style={{ color: '#64748b', fontSize: 13 }}>Adjudication events (90d)</div>
            </div>
          </div>
          {kpis && (
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              KPI source: {kpis.source === 'live' ? 'live' : 'no interactions yet'} ·{' '}
              <button type="button" onClick={() => setTab('kpis')} style={{ color: '#0f766e', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                View KPIs
              </button>
            </p>
          )}
        </>
      )}

      {!loading && tab === 'deadlines' && (
        <section>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>CDCP deadline tracker</h2>
          {deadlines.length === 0 ? (
            <p style={{ color: '#64748b' }}>No open CDCP reconsideration cases.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '8px 4px' }}>Procedure</th>
                  <th>Status</th>
                  <th>Days left</th>
                  <th>Denial date</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(expiringSoon.length > 0 || urgent.length > 0) && (
            <p style={{ marginTop: 12, fontSize: 13, color: '#ca8a04' }}>
              {urgent.length} urgent (≤7d), {expiringSoon.length} expiring within 14 days.
            </p>
          )}
        </section>
      )}

      {!loading && tab === 'verifications' && (
        <section>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Appointment verifications</h2>
          {verifications.length === 0 ? (
            <p style={{ color: '#64748b' }}>
              No verifications yet. Use <code>POST /api/pre-visit/verify</code> or appointment ingest.
            </p>
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
      )}

      {!loading && tab === 'adjudication' && graph && (
        <section>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 4 }}>Adjudication graph</h2>
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
            {graph.totalEvents} carrier interaction events in the last {graph.days} days.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <BucketTable title="By call type" buckets={graph.byCallType} />
            <BucketTable title="By carrier" buckets={graph.byCarrier} />
            <BucketTable title="By denial code" buckets={graph.byDenialCode} />
          </div>
          {graph.weeklyTrend.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Weekly trend</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '6px 4px' }}>Week</th>
                    <th>Events</th>
                    <th>Success rate</th>
                    <th>Median duration</th>
                  </tr>
                </thead>
                <tbody>
                  {graph.weeklyTrend.map((w) => (
                    <tr key={w.weekStart} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 4px' }}>{w.weekStart}</td>
                      <td>{w.events}</td>
                      <td>{w.successRate}%</td>
                      <td>{w.medianDurationMs ? `${Math.round(w.medianDurationMs / 1000)}s` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!loading && tab === 'kpis' && (
        <section>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Phase 5 KPIs (30 days)</h2>
          {!kpis || kpis.source === 'insufficient_data' ? (
            <p style={{ color: '#64748b' }}>
              No carrier interactions recorded yet. KPIs populate after pre-visit or post-visit calls complete.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {KPI_LABELS.map(({ key, label, unit }) => (
                <div key={key} className="crx-card" style={{ padding: 14 }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                    {kpis[key]}{unit}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <footer style={{ marginTop: 32, fontSize: 12, color: '#94a3b8' }}>
        Configure pre-visit VAPI squad via <code>VAPI_PREVISIT_SQUAD_ID</code> — see{' '}
        <code>vapi-previsit-config.json</code>. Legacy <Link to="/pre-visit?tab=kpis">/cdcp</Link> redirects here.
      </footer>
    </div>
  );
}
