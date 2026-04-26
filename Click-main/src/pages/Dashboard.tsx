import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { usePractice } from '../context/PracticeContext'
import { api } from '../utils/api'
import {
  Card, CardHeader, CardTitle,
  Badge, ListItem,
  SkeletonCard, SkeletonListItem,
  EmptyState, LoadingState,
  Button, BottomSheet,
} from '../components/base'
import CarrierPriorityPanel from '../components/CarrierPriorityPanel'
import type { DashboardStats, CollectionRate, PriorityBalance, BalanceListItem } from '../types'

// ── Data types ────────────────────────────────────────────────────────────────

interface DashboardData {
  stats: DashboardStats
  collectionRate: CollectionRate
  priorityBalances: PriorityBalance[]
  recentActivity: BalanceListItem[]
}

// ── Helper: format dollar amounts ─────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
}

// ── Metric card ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string
  value: string
  sub?: string
  trend?: { label: string; positive: boolean }
  accentColor?: string
}

function MetricCard({ label, value, sub, trend, accentColor = '#40916C' }: MetricCardProps) {
  return (
    <Card padding="md" variant="default" className="flex flex-col gap-1">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={{ color: accentColor }}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
      {trend && (
        <p className={`text-xs font-medium ${trend.positive ? 'text-emerald-600' : 'text-red-500'}`}>
          {trend.positive ? '↑' : '↓'} {trend.label}
        </p>
      )}
    </Card>
  )
}

// ── Stage badge ───────────────────────────────────────────────────────────────

const stageVariant: Record<string, 'warning' | 'error' | 'info' | 'neutral' | 'success'> = {
  CREATED:      'neutral',
  NOTIFIED:     'info',
  REMINDER_1:   'warning',
  REMINDER_2:   'warning',
  ESCALATED:    'error',
  STAFF_REVIEW: 'error',
  CLOSED:       'success',
}

function StageBadge({ stage }: { stage: string }) {
  const variant = stageVariant[stage] ?? 'neutral'
  const label = stage.replace(/_/g, ' ')
  return <Badge variant={variant} size="sm">{label}</Badge>
}

// ── Aging bar chart ───────────────────────────────────────────────────────────

const AGING_COLORS = ['#2D6A4F', '#92400E', '#B91C1C']

function AgingChart({ aging }: { aging: DashboardStats['aging'] }) {
  const data = [
    { label: '0-30 Days',  value: aging['0-30'],  fill: AGING_COLORS[0] },
    { label: '31-60 Days', value: aging['31-60'], fill: AGING_COLORS[1] },
    { label: '>60 Days',   value: aging['>60'],   fill: AGING_COLORS[2] },
  ]

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: '#5C6B63' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
          tick={{ fontSize: 11, fill: '#5C6B63' }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip
          formatter={(v) => [fmt(Number(v)), 'Open A/R']}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB' }}
          cursor={{ fill: '#F0F3F1' }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Main Dashboard page ───────────────────────────────────────────────────────

export default function Dashboard() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const navigate = useNavigate()

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [priorityOpen, setPriorityOpen] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    try {
      const [stats, collectionRate, { priorityBalances }, recentActivity] = await Promise.all([
        api.get<DashboardStats>(`/api/dashboard/stats?practiceId=${practiceId}`),
        api.get<CollectionRate>(`/api/analytics/collection-rate?practiceId=${practiceId}`),
        api.get<{ priorityBalances: PriorityBalance[] }>(`/api/analytics/priority-balances?practiceId=${practiceId}`),
        api.get<BalanceListItem[]>(`/api/dashboard/recent?practiceId=${practiceId}`),
      ])
      setData({ stats, collectionRate, priorityBalances, recentActivity })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [practiceId])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Loading state ─────────────────────────────────────────────────────────

  if (practiceLoading) {
    return <LoadingState message="Loading practice…" />
  }

  if (loading) {
    return (
      <main className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonCard />
          <div className="space-y-px border border-gray-200 rounded-lg overflow-hidden">
            {[1,2,3,4,5].map(i => <SkeletonListItem key={i} />)}
          </div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="p-4 md:p-6">
        <EmptyState
          icon={
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          }
          title="Failed to load dashboard"
          description={error}
          action={<Button variant="primary" onClick={fetchAll}>Retry</Button>}
        />
      </main>
    )
  }

  if (!data) return null

  const { stats, collectionRate, priorityBalances, recentActivity } = data

  // How many claims are overdue (>60 days)
  const urgentCount = priorityBalances.filter(b => b.daysOutstanding > 60).length

  return (
    <main
      role="main"
      aria-label="Dashboard"
      className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto pb-20 md:pb-6"
    >
      {/* ── Page title ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-emerald-900">Dashboard</h1>
          <p className="text-sm text-gray-500">A/R overview</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setPriorityOpen(true)}
          leftIcon={
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 10.5a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5a.75.75 0 01-.75-.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10z" clipRule="evenodd" />
            </svg>
          }
        >
          Call Priority
        </Button>
      </div>

      {/* ── Metric cards ───────────────────────────────────────────────────── */}
      <section
        aria-label="Summary metrics"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <MetricCard
          label="Total Open A/R"
          value={fmt(stats.totalOpenAR)}
          sub={`${stats.openBalanceCount} open balances`}
          accentColor="#1A3D2B"
        />
        <MetricCard
          label="Collected"
          value={fmt(collectionRate.totalCollected)}
          sub={`${collectionRate.paidCount} paid`}
          trend={{ label: `${collectionRate.collectionRate.toFixed(1)}% rate`, positive: collectionRate.collectionRate >= 70 }}
          accentColor="#2D6A4F"
        />
        <MetricCard
          label="Avg. Days to Pay"
          value={`${collectionRate.avgDaysToPayment.toFixed(0)}d`}
          sub="from creation"
          trend={{ label: collectionRate.avgDaysToPayment <= 30 ? 'On track' : 'Needs attention', positive: collectionRate.avgDaysToPayment <= 30 }}
          accentColor="#2D6A4F"
        />
        <MetricCard
          label="Overdue (>60d)"
          value={String(urgentCount)}
          sub="require urgent action"
          accentColor={urgentCount > 0 ? '#B91C1C' : '#2D6A4F'}
        />
      </section>

      {/* ── Main content grid ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Left column: aging chart + stage breakdown */}
        <div className="space-y-4">

          {/* A/R Aging chart */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>A/R Aging Breakdown</CardTitle>
            </CardHeader>
            <AgingChart aging={stats.aging} />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                { label: '0-30d', value: stats.aging['0-30'], color: AGING_COLORS[0] },
                { label: '31-60d', value: stats.aging['31-60'], color: AGING_COLORS[1] },
                { label: '>60d', value: stats.aging['>60'], color: AGING_COLORS[2] },
              ].map(b => (
                <div key={b.label}>
                  <p className="text-xs text-gray-500">{b.label}</p>
                  <p className="text-sm font-semibold tabular-nums" style={{ color: b.color }}>
                    {fmt(b.value)}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* Stage breakdown */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Balances by Stage</CardTitle>
            </CardHeader>
            <div className="divide-y divide-gray-100">
              {Object.entries(stats.stageCounts).length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No stage data</p>
              ) : (
                Object.entries(stats.stageCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([stage, count]) => (
                    <div key={stage} className="flex items-center justify-between py-2.5">
                      <StageBadge stage={stage} />
                      <span className="text-sm font-semibold tabular-nums text-gray-800">{count}</span>
                    </div>
                  ))
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => navigate('/balances')}>
                View all balances →
              </Button>
            </div>
          </Card>
        </div>

        {/* Right column: priority claims + recent activity */}
        <div className="space-y-4">

          {/* Priority claims */}
          <Card padding="none">
            <div className="px-4 pt-4 pb-2">
              <CardHeader>
                <CardTitle>Priority Claims</CardTitle>
                {urgentCount > 0 && (
                  <Badge variant="error" dot>{urgentCount} urgent</Badge>
                )}
              </CardHeader>
            </div>

            {priorityBalances.length === 0 ? (
              <EmptyState
                title="No priority claims"
                description="All balances are on track."
                compact
              />
            ) : (
              <div className="divide-y divide-gray-100">
                {priorityBalances.slice(0, 6).map(b => (
                  <ListItem
                    key={b.id}
                    title={b.patient.displayName}
                    subtitle={`${b.daysOutstanding}d outstanding`}
                    urgency={b.daysOutstanding > 60 ? 'urgent' : b.daysOutstanding > 30 ? 'warning' : null}
                    chevron
                    trailing={
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums text-gray-900">{fmt(b.amount)}</p>
                        <StageBadge stage={b.currentStage} />
                      </div>
                    }
                    onClick={() => navigate(`/balances/${b.id}`)}
                  />
                ))}
              </div>
            )}

            <div className="px-4 pb-3 pt-2 border-t border-gray-100 flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => navigate('/balances')}>
                View all →
              </Button>
            </div>
          </Card>

          {/* Recent activity */}
          <Card padding="none">
            <div className="px-4 pt-4 pb-2">
              <CardTitle>Recent Activity</CardTitle>
            </div>

            {recentActivity.length === 0 ? (
              <EmptyState title="No recent activity" compact />
            ) : (
              <div className="divide-y divide-gray-100">
                {recentActivity.slice(0, 5).map(b => (
                  <ListItem
                    key={b.id}
                    title={b.patient.displayName}
                    subtitle={new Date(b.createdAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                    chevron
                    trailing={
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums">{fmt(b.amount)}</p>
                        <Badge
                          variant={b.status === 'PAID' ? 'success' : b.status === 'OPEN' ? 'warning' : 'neutral'}
                          size="sm"
                        >
                          {b.status}
                        </Badge>
                      </div>
                    }
                    onClick={() => navigate(`/balances/${b.id}`)}
                  />
                ))}
              </div>
            )}

            <div className="px-4 pb-3 pt-2 border-t border-gray-100 flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => navigate('/outbox')}>
                View outbox →
              </Button>
            </div>
          </Card>

          {/* Quick actions */}
          <Card padding="md">
            <CardTitle>Quick Actions</CardTitle>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="primary" size="sm" fullWidth onClick={() => navigate('/balances')}>
                View Balances
              </Button>
              <Button variant="secondary" size="sm" fullWidth onClick={() => navigate('/estimate')}>
                Run Estimate
              </Button>
              <Button variant="secondary" size="sm" fullWidth onClick={() => navigate('/patient-ar')}>
                Patient A/R
              </Button>
              <Button variant="secondary" size="sm" fullWidth onClick={() => navigate('/analytics')}>
                Analytics
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* ── Carrier priority bottom sheet ─────────────────────────────────── */}
      <BottomSheet
        open={priorityOpen}
        onClose={() => setPriorityOpen(false)}
        title="Set Call Priority"
        height="auto"
      >
        <CarrierPriorityPanel practiceId={practiceId} />
      </BottomSheet>
    </main>
  )
}
