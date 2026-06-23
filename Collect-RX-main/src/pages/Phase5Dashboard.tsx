/**
 * Phase 5: 8-Dimension KPI Dashboard
 *
 * Tracks the 8 eval dimensions for the CDCP Reconsideration & High-Precision
 * Adjudication Module:
 *  1. Reconsideration Success Rate (target >40%)
 *  2. IVR Navigation Success Rate
 *  3. Authentication Success Rate (third-party attestation)
 *  4. Status Retrieval Accuracy
 *  5. Denial Taxonomy Mapping Accuracy
 *  6. Zero Hallucination Rate (target 100%)
 *  7. 100% Disclosure Compliance Rate
 *  8. Median Call Duration (target <12 min)
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePractice } from '../context/PracticeContext';
import { apiFetchJson } from '../lib/apiFetch';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiDimension {
  id: number;
  name: string;
  shortName: string;
  value: number;
  target: number;
  unit: string;
  higherIsBetter: boolean;
  description: string;
}

interface ReconsiderationRow {
  claimId: string;
  denialDate: string;
  deadline: string;
  daysRemaining: number;
  procedure: string;
  denialCode: string;
  status: 'eligible' | 'urgent' | 'submitted' | 'approved' | 'denied_final' | 'expired';
  province: string;
}

interface TrendPoint {
  week: string;
  successRate: number;
  callDuration: number;
  hallucinationFree: number;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_KPI_DIMENSIONS: KpiDimension[] = [
  {
    id: 1,
    name: 'Reconsideration Success Rate',
    shortName: 'Recon Success',
    value: 43,
    target: 40,
    unit: '%',
    higherIsBetter: true,
    description: 'Percentage of initially denied CDCP claims converted to Paid after Level 1 Reconsideration.',
  },
  {
    id: 2,
    name: 'IVR Navigation Success',
    shortName: 'IVR Nav',
    value: 91,
    target: 90,
    unit: '%',
    higherIsBetter: true,
    description: 'Percentage of calls successfully reaching a live CDCP Contact Centre adjudicator (1-888-888-8110).',
  },
  {
    id: 3,
    name: 'Authentication Success',
    shortName: 'Auth',
    value: 96,
    target: 95,
    unit: '%',
    higherIsBetter: true,
    description: 'Third-party on-call attestation accepted by Sun Life adjudicators.',
  },
  {
    id: 4,
    name: 'Status Retrieval Accuracy',
    shortName: 'Status Acc.',
    value: 98,
    target: 95,
    unit: '%',
    higherIsBetter: true,
    description: 'Claim status retrieved matches actual CDCP system status.',
  },
  {
    id: 5,
    name: 'Denial Taxonomy Accuracy',
    shortName: 'Taxonomy',
    value: 94,
    target: 95,
    unit: '%',
    higherIsBetter: true,
    description: 'CDCP denial reason codes correctly mapped to the evidence checklist.',
  },
  {
    id: 6,
    name: 'Zero Hallucination Rate',
    shortName: 'No Halluc.',
    value: 99.7,
    target: 100,
    unit: '%',
    higherIsBetter: true,
    description: 'Percentage of calls with zero hallucinated patient data, claim numbers, or clinical facts.',
  },
  {
    id: 7,
    name: 'Disclosure Compliance',
    shortName: 'Disclosure',
    value: 100,
    target: 100,
    unit: '%',
    higherIsBetter: true,
    description: 'Percentage of calls where required third-party disclosure script was read at call start.',
  },
  {
    id: 8,
    name: 'Median Call Duration',
    shortName: 'Call Time',
    value: 9.4,
    target: 12,
    unit: ' min',
    higherIsBetter: false,
    description: 'Median call duration including hold time. Target: under 12 minutes.',
  },
];

const MOCK_RECONSIDERATIONS: ReconsiderationRow[] = [
  { claimId: 'CLM-2847', denialDate: '2026-04-01', deadline: '2026-05-31', daysRemaining: 16, procedure: 'D2750 Crown (Porc-fused-metal)', denialCode: 'F-010', status: 'urgent', province: 'ON' },
  { claimId: 'CLM-2831', denialDate: '2026-04-08', deadline: '2026-06-07', daysRemaining: 23, procedure: 'D3310 Endo, Anterior', denialCode: 'F-010', status: 'eligible', province: 'AB' },
  { claimId: 'CLM-2819', denialDate: '2026-04-12', deadline: '2026-06-11', daysRemaining: 27, procedure: 'D4341 SRP, 4+ teeth', denialCode: 'F-011', status: 'submitted', province: 'BC' },
  { claimId: 'CLM-2801', denialDate: '2026-04-20', deadline: '2026-06-19', daysRemaining: 35, procedure: 'D2790 Crown (Full-cast)', denialCode: 'F-010', status: 'eligible', province: 'ON' },
  { claimId: 'CLM-2788', denialDate: '2026-04-22', deadline: '2026-06-21', daysRemaining: 37, procedure: 'D3330 Endo, Molar', denialCode: 'F-010', status: 'approved', province: 'AB' },
  { claimId: 'CLM-2762', denialDate: '2026-03-10', deadline: '2026-05-09', daysRemaining: 0, procedure: 'D2740 Crown (Porcelain)', denialCode: 'F-014', status: 'expired', province: 'ON' },
];

const MOCK_TREND: TrendPoint[] = [
  { week: 'Apr W1', successRate: 35, callDuration: 11.2, hallucinationFree: 99.1 },
  { week: 'Apr W2', successRate: 38, callDuration: 10.8, hallucinationFree: 99.5 },
  { week: 'Apr W3', successRate: 41, callDuration: 10.1, hallucinationFree: 99.7 },
  { week: 'Apr W4', successRate: 40, callDuration: 9.8,  hallucinationFree: 99.9 },
  { week: 'May W1', successRate: 43, callDuration: 9.4,  hallucinationFree: 99.7 },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function statusBadge(status: ReconsiderationRow['status']): JSX.Element {
  const map: Record<string, { label: string; cls: string }> = {
    eligible:    { label: 'Eligible',     cls: 'bg-blue-100 text-blue-700' },
    urgent:      { label: 'URGENT',       cls: 'bg-red-100 text-red-700 font-bold animate-pulse' },
    submitted:   { label: 'Submitted',    cls: 'bg-yellow-100 text-yellow-700' },
    approved:    { label: 'Approved ✓',   cls: 'bg-emerald-100 text-emerald-700' },
    denied_final:{ label: 'Final Denial', cls: 'bg-gray-200 text-gray-600' },
    expired:     { label: 'Expired',      cls: 'bg-red-200 text-red-800' },
  };
  const s = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs ${s.cls}`}>{s.label}</span>
  );
}

function KpiCard({ dim }: { dim: KpiDimension }) {
  const isCallDuration = !dim.higherIsBetter;
  const passing = isCallDuration
    ? dim.value <= dim.target
    : dim.value >= dim.target;

  const pct = isCallDuration
    ? Math.min(100, (dim.target / dim.value) * 100)
    : Math.min(100, (dim.value / dim.target) * 100);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">Dim {dim.id}</p>
          <p className="text-sm font-semibold text-gray-700 mt-0.5">{dim.name}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${passing ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
          {passing ? '✓ On target' : '⚠ Below target'}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <span className={`text-3xl font-bold ${passing ? 'text-emerald-600' : 'text-red-500'}`}>
          {dim.value}{dim.unit}
        </span>
        <span className="text-sm text-gray-400 mb-1">target {dim.target}{dim.unit}</span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full transition-all ${passing ? 'bg-emerald-500' : 'bg-red-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-xs text-gray-400 leading-snug">{dim.description}</p>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Phase5Dashboard() {
  const { practiceId } = usePractice();
  const [searchParams] = useSearchParams();
  const deepLinkCaseId = searchParams.get('case');
  const [activeTab, setActiveTab] = useState<'overview' | 'queue' | 'trends'>('overview');
  const [highlightClaimRef, setHighlightClaimRef] = useState<string | null>(null);
  const [dims, setDims] = useState<KpiDimension[]>(MOCK_KPI_DIMENSIONS);
  const [queue, setQueue] = useState<ReconsiderationRow[]>(MOCK_RECONSIDERATIONS);
  const [queueSource, setQueueSource] = useState<'live' | 'mock'>('mock');
  const [trend, setTrend] = useState<TrendPoint[]>(MOCK_TREND);
  const [kpiSource, setKpiSource] = useState<'live' | 'mock'>('mock');

  useEffect(() => {
    if (!practiceId) return;
    apiFetchJson<{
      queue?: Array<{
        priority: string;
        record: {
          claimId: string;
          denialDate: string;
          deadlineDate: string;
          status: ReconsiderationRow['status'];
          denialReasonCode: string;
        };
        cdtCode?: string;
        province?: string;
      }>;
    }>('/api/cdcp/queue')
      .then((res) => {
        const items = res.queue ?? [];
        if (items.length === 0) return;
        const now = Date.now();
        setQueue(
          items.map((t) => {
            const deadline = new Date(t.record.deadlineDate);
            const daysRemaining = Math.ceil((deadline.getTime() - now) / 86400000);
            return {
              claimId: t.record.claimId,
              denialDate: t.record.denialDate.slice(0, 10),
              deadline: t.record.deadlineDate.slice(0, 10),
              daysRemaining,
              procedure: t.cdtCode ? `CDT ${t.cdtCode}` : 'N/A',
              denialCode: t.record.denialReasonCode,
              status: (t.priority === 'urgent' ? 'urgent' : t.record.status) as ReconsiderationRow['status'],
              province: t.province ?? 'N/A',
            };
          }),
        );
        setQueueSource('live');
      })
      .catch(() => setQueueSource('mock'));
  }, [practiceId]);

  useEffect(() => {
    if (!deepLinkCaseId || !practiceId) return;
    apiFetchJson<{ cases?: Array<{ id: string; claimRef: string }> }>(
      '/api/canadian/cdcp/reconsiderations',
    )
      .then((res) => {
        const found = res.cases?.find((c) => c.id === deepLinkCaseId);
        if (found) {
          setHighlightClaimRef(found.claimRef);
          setActiveTab('queue');
        }
      })
      .catch(() => undefined);
  }, [deepLinkCaseId, practiceId]);

  useEffect(() => {
    if (!practiceId) return;
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    Promise.all([
      apiFetchJson<{
        success: boolean;
        data: {
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
        };
      }>(`/api/analytics/phase5-kpis?days=30`),
      apiFetchJson<{
        success: boolean;
        data: {
          callVolume: { date: string; calls: number; resolved: number }[];
        };
      }>(`/api/analytics/insurance?from=${from}&to=${to}`),
    ])
      .then(([kpiRes, insRes]) => {
        const k = kpiRes.data;
        if (k && k.source === 'live') {
          setDims((prev) =>
            prev.map((dim) => {
              switch (dim.id) {
                case 1: return { ...dim, value: k.reconsiderationSuccessRate };
                case 2: return { ...dim, value: k.ivrNavigationSuccessRate };
                case 3: return { ...dim, value: k.authenticationSuccessRate };
                case 4: return { ...dim, value: k.statusRetrievalAccuracy };
                case 5: return { ...dim, value: k.denialTaxonomyMappingAccuracy };
                case 6: return { ...dim, value: k.zeroHallucinationRate };
                case 7: return { ...dim, value: k.disclosureComplianceRate };
                case 8: return { ...dim, value: k.medianCallDurationMinutes };
                default: return dim;
              }
            }),
          );
          setKpiSource('live');
        }
        const vol = insRes.data?.callVolume ?? [];
        if (vol.length > 0) {
          const avgCallMin = k?.medianCallDurationMinutes ?? MOCK_KPI_DIMENSIONS[7].value;
          setTrend(
            vol.slice(-5).map((p, i) => ({
              week: `W${i + 1}`,
              successRate: p.calls > 0 ? Math.round((p.resolved / p.calls) * 100) : 0,
              callDuration: avgCallMin,
              hallucinationFree: k?.zeroHallucinationRate ?? 99.5,
            })),
          );
        }
      })
      .catch(() => setKpiSource('mock'));
  }, [practiceId]);

  const urgentCount = queue.filter(r => r.status === 'urgent').length;
  const approvedCount = queue.filter(r => r.status === 'approved').length;
  const totalFiled = queue.filter(r => r.status !== 'expired').length;
  const successRate = totalFiled > 0 ? Math.round((approvedCount / totalFiled) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Phase 5, CDCP Reconsideration</h1>
            <p className="text-sm text-gray-500 mt-1">
              High-Precision Adjudication Module · KPI source: {kpiSource === 'live' ? 'live insurance analytics' : 'demo mock (no calls yet)'}
            </p>
          </div>
          <div className="flex gap-2">
            {urgentCount > 0 && (
              <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <span className="text-red-600 font-bold text-sm">{urgentCount} URGENT</span>
                <span className="text-red-400 text-xs">≥45 days elapsed</span>
              </div>
            )}
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600">
              <span className="font-semibold text-emerald-600">{successRate}%</span> recon success
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 bg-white border border-gray-200 rounded-lg p-1 w-fit">
          {(['overview', 'queue', 'trends'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Tab, 8 KPI Cards */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {dims.map(dim => <KpiCard key={dim.id} dim={dim} />)}
        </div>
      )}

      {/* Queue Tab */}
      {activeTab === 'queue' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Reconsideration Queue</h2>
            <span className="text-xs text-gray-400">
              {queue.length} claims · {queueSource === 'live' ? 'CDCP API' : 'demo data'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Claim</th>
                  <th className="px-4 py-3 text-left">Procedure</th>
                  <th className="px-4 py-3 text-left">Denial Code</th>
                  <th className="px-4 py-3 text-left">Province</th>
                  <th className="px-4 py-3 text-left">Deadline</th>
                  <th className="px-4 py-3 text-left">Days Left</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {queue
                  .sort((a, b) => a.daysRemaining - b.daysRemaining)
                  .map(row => (
                    <tr
                      key={row.claimId}
                      className={`hover:bg-gray-50 ${
                        row.status === 'urgent' ? 'bg-red-50' : ''
                      } ${highlightClaimRef === row.claimId ? 'ring-2 ring-emerald-500 ring-inset' : ''}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.claimId}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{row.procedure}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">
                          {row.denialCode}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{row.province}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{row.deadline}</td>
                      <td className="px-4 py-3">
                        {row.daysRemaining > 0 ? (
                          <span className={`font-semibold text-xs ${row.daysRemaining <= 15 ? 'text-red-600' : row.daysRemaining <= 30 ? 'text-orange-500' : 'text-gray-600'}`}>
                            {row.daysRemaining}d
                          </span>
                        ) : (
                          <span className="text-red-500 text-xs">Expired</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{statusBadge(row.status)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trends Tab */}
      {activeTab === 'trends' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Reconsideration Success Rate Trend */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-1">Reconsideration Success Rate</h3>
            <p className="text-xs text-gray-400 mb-4">Weekly % of denied claims approved on reconsideration · Target 40%</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 60]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v) => [`${v}%`, 'Success Rate']} />
                <ReferenceLine y={40} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Target 40%', fontSize: 10, fill: '#f59e0b' }} />
                <Line type="monotone" dataKey="successRate" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Median Call Duration Trend */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-1">Median Call Duration</h3>
            <p className="text-xs text-gray-400 mb-4">Minutes per call including hold time · Target &lt;12 min</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 15]} tick={{ fontSize: 11 }} unit="m" />
                <Tooltip formatter={(v) => [`${v} min`, 'Call Duration']} />
                <ReferenceLine y={12} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Max 12m', fontSize: 10, fill: '#ef4444' }} />
                <Bar dataKey="callDuration" radius={[4, 4, 0, 0]}>
                  {trend.map((entry, i) => (
                    <Cell key={i} fill={entry.callDuration <= 12 ? '#10b981' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Zero Hallucination Rate */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-1">Zero Hallucination Rate</h3>
            <p className="text-xs text-gray-400 mb-4">% of calls with no hallucinated patient or clinical data · Target 100%</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis domain={[98, 100.5]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v) => [`${v}%`, 'Hallucination-free']} />
                <ReferenceLine y={100} stroke="#10b981" strokeDasharray="4 4" label={{ value: 'Target 100%', fontSize: 10, fill: '#10b981' }} />
                <Line type="monotone" dataKey="hallucinationFree" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Summary Stats */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-4">CDCP Pipeline Summary</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Total Denied Claims', value: queue.length, color: 'text-gray-700' },
                { label: 'Urgent (≥45 days)', value: urgentCount, color: 'text-red-600' },
                { label: 'Reconsidered', value: queue.filter(r => ['submitted','approved','denied_final'].includes(r.status)).length, color: 'text-yellow-600' },
                { label: 'Approved', value: approvedCount, color: 'text-emerald-600' },
                { label: 'Expired', value: queue.filter(r => r.status === 'expired').length, color: 'text-gray-400' },
                { label: 'Success Rate', value: `${successRate}%`, color: successRate >= 40 ? 'text-emerald-600' : 'text-red-500' },
              ].map(stat => (
                <div key={stat.label} className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400">{stat.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
