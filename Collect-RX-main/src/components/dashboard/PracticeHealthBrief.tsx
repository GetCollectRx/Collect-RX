import { Link } from 'react-router-dom'
import type { DashboardLastPmsImport } from './PmsSyncBanner'
import type { PracticePmsInfo } from '../../types/pms'

export type HealthBriefMetrics = {
  totalOpenAR: number
  openWorkItemCount: number
  agingOver60: number
  claimsResolvedToday: number
  callsToday: number
  activeCalls: number
  blockingGatesOpen: number
  recovered30d: number
  recoveredAllTime: number
  awaitingSync: number
  openEscalations: number
}

export type HealthActionItem = {
  id: string
  severity: 'urgent' | 'watch' | 'info'
  title: string
  detail: string
  href: string
}

type Props = {
  practiceName: string
  metrics: HealthBriefMetrics
  actions: HealthActionItem[]
  pms?: PracticePmsInfo | null
  lastImport?: DashboardLastPmsImport | null
  loading?: boolean
}

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(v)
}

function overallStatus(m: HealthBriefMetrics, actions: HealthActionItem[]): {
  label: string
  tone: 'good' | 'watch' | 'action'
  summary: string
} {
  const urgent = actions.filter((a) => a.severity === 'urgent').length
  if (urgent > 0 || m.blockingGatesOpen > 0 || m.openEscalations > 0) {
    return {
      label: 'Needs attention',
      tone: 'action',
      summary: `${urgent + m.blockingGatesOpen + m.openEscalations} item${urgent + m.blockingGatesOpen + m.openEscalations === 1 ? '' : 's'} need a decision or follow-up today.`,
    }
  }
  if (m.totalOpenAR > 0 && m.agingOver60 > m.totalOpenAR * 0.25) {
    return {
      label: 'Watch aging',
      tone: 'watch',
      summary: 'A quarter or more of open insurance A/R is over 60 days, worth a quick review.',
    }
  }
  if (m.totalOpenAR === 0) {
    return {
      label: 'Getting started',
      tone: 'watch',
      summary: 'No open insurance claims yet. Import from your PMS or add claims to see recovery here.',
    }
  }
  return {
    label: 'On track',
    tone: 'good',
    summary: 'Agents are working claims and nothing is blocking collections right now.',
  }
}

function syncLabel(lastImport?: DashboardLastPmsImport | null, pms?: PracticePmsInfo | null): string {
  if (!pms?.vendorId) return 'PMS not connected, connect in Settings'
  if (!lastImport) return `${pms.displayName ?? 'PMS'} connected, no import yet`
  const when = new Date(lastImport.startedAt).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  if (lastImport.status === 'failed') return `Last sync failed (${when})`
  if (lastImport.status === 'running') return 'Sync in progress…'
  return `Last sync ${when} · ${lastImport.recordsImported ?? 0} records`
}

export function PracticeHealthBrief({
  practiceName,
  metrics: m,
  actions,
  pms,
  lastImport,
  loading = false,
}: Props) {
  const status = overallStatus(m, actions)
  const today = new Date().toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="practice-health-brief page-enter">
      <header className="practice-health-header">
        <div>
          <p className="crx-section-label">Practice health</p>
          <h1 className="crx-h1">{practiceName}</h1>
          <p className="crx-sub mt-1">{today}</p>
        </div>
        <div className={`practice-health-status practice-health-status--${status.tone}`}>
          <span className="practice-health-status-label">{status.label}</span>
          <p className="practice-health-status-copy">{status.summary}</p>
        </div>
      </header>

      <section className="practice-health-answers" aria-label="Key answers">
        <article className={`practice-health-card ${loading ? 'is-loading' : ''}`}>
          <h2 className="practice-health-q">How much insurance money is still outstanding?</h2>
          <p className="practice-health-value">{loading ? 'N/A' : fmtCurrency(m.totalOpenAR)}</p>
          <p className="crx-sub">
            {loading
              ? 'Loading…'
              : m.openWorkItemCount > 0
                ? `${m.openWorkItemCount} open claim${m.openWorkItemCount === 1 ? '' : 's'} in the queue`
                : 'No open claims in the work queue'}
          </p>
          <Link to="/insurance" className="practice-health-link">
            View insurance A/R →
          </Link>
        </article>

        <article className={`practice-health-card ${loading ? 'is-loading' : ''}`}>
          <h2 className="practice-health-q">What&apos;s blocking collections?</h2>
          <p className="practice-health-value">
            {loading ? 'N/A' : m.blockingGatesOpen + m.openEscalations}
          </p>
          <p className="crx-sub">
            {loading
              ? 'Loading…'
              : m.blockingGatesOpen + m.openEscalations === 0
                ? 'No gates or escalations waiting on you'
                : `${m.blockingGatesOpen} gate${m.blockingGatesOpen === 1 ? '' : 's'} · ${m.openEscalations} escalation${m.openEscalations === 1 ? '' : 's'}`}
          </p>
          <div className="practice-health-link-row">
            {m.blockingGatesOpen > 0 && (
              <Link to="/insurance/gates" className="practice-health-link">
                Gate inbox →
              </Link>
            )}
            {m.openEscalations > 0 && (
              <Link to="/escalations" className="practice-health-link">
                Escalations →
              </Link>
            )}
            {!loading && m.blockingGatesOpen === 0 && m.openEscalations === 0 && (
              <Link to="/work-queue" className="practice-health-link">
                Work queue →
              </Link>
            )}
          </div>
        </article>

        <article className={`practice-health-card ${loading ? 'is-loading' : ''}`}>
          <h2 className="practice-health-q">What did we recover this month?</h2>
          <p className="practice-health-value">{loading ? 'N/A' : fmtCurrency(m.recovered30d)}</p>
          <p className="crx-sub">
            {loading
              ? 'Loading…'
              : m.recoveredAllTime > 0
                ? `${fmtCurrency(m.recoveredAllTime)} all-time · confirmed when PMS sync clears the balance`
                : 'Recovery shows here after carrier pay + PMS sync verification'}
          </p>
          <Link to="/reports/aging" className="practice-health-link">
            Aging report →
          </Link>
        </article>

        <article className={`practice-health-card ${loading ? 'is-loading' : ''}`}>
          <h2 className="practice-health-q">Are agents and sync running?</h2>
          <p className="practice-health-value">
            {loading ? 'N/A' : m.activeCalls > 0 ? `${m.activeCalls} live` : `${m.callsToday} calls today`}
          </p>
          <p className="crx-sub">
            {loading ? 'Loading…' : syncLabel(lastImport, pms)}
          </p>
          {m.awaitingSync > 0 && !loading && (
            <p className="practice-health-note">{m.awaitingSync} approved, waiting on PMS sync</p>
          )}
          <Link to="/settings" className="practice-health-link">
            Settings & integrations →
          </Link>
        </article>
      </section>

      {actions.length > 0 && (
        <section className="practice-health-actions" aria-label="Needs your attention">
          <h2 className="practice-health-actions-title">Needs your attention</h2>
          <ul className="practice-health-action-list">
            {actions.slice(0, 6).map((item) => (
              <li key={item.id}>
                <Link to={item.href} className={`practice-health-action practice-health-action--${item.severity}`}>
                  <span className="practice-health-action-title">{item.title}</span>
                  <span className="practice-health-action-detail">{item.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="practice-health-footer">
        <p className="crx-sub">
          Resolved today: <strong>{loading ? 'N/A' : m.claimsResolvedToday}</strong>
          {!loading && m.agingOver60 > 0 && (
            <>
              {' '}
              · Over 60 days: <strong>{fmtCurrency(m.agingOver60)}</strong>
            </>
          )}
        </p>
        <div className="practice-health-quick">
          <Link to="/work-queue" className="crx-btn-primary">
            Open work queue
          </Link>
          <Link to="/reports/carriers" className="crx-btn-ghost">
            Carrier stats
          </Link>
        </div>
      </section>
    </div>
  )
}
