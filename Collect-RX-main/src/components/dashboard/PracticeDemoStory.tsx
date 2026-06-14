import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { HealthBriefMetrics } from './PracticeHealthBrief'

type Props = {
  practiceName: string
  metrics: HealthBriefMetrics
  loading?: boolean
}

type PainCard = {
  id: string
  pain: string
  without: string
  withCollectRx: string
  proof: string
  href: string
  linkLabel: string
}

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(v)
}

function buildCards(m: HealthBriefMetrics, loading: boolean): PainCard[] {
  const arProof = loading
    ? 'Loading your open A/R…'
    : m.totalOpenAR > 0
      ? `${fmtCurrency(m.totalOpenAR)} open insurance A/R in this practice right now`
      : 'Sample data shows typical mid-size practice exposure'

  const agingProof = loading
    ? 'Loading aging…'
    : m.agingOver60 > 0
      ? `${fmtCurrency(m.agingOver60)} past 60 days, where appeal windows close`
      : 'Aging bands below show where claims stall'

  const gatesProof = loading
    ? 'Loading gates…'
    : m.blockingGatesOpen > 0
      ? `${m.blockingGatesOpen} gate${m.blockingGatesOpen === 1 ? '' : 's'} waiting on your office today`
      : 'Gate inbox catches resubmit, missing docs, and verify steps'

  const recoveryProof = loading
    ? 'Loading recovery…'
    : m.recovered30d > 0
      ? `${fmtCurrency(m.recovered30d)} sync-verified in the last 30 days`
      : m.recoveredAllTime > 0
        ? `${fmtCurrency(m.recoveredAllTime)} confirmed when PMS balances cleared`
        : 'Recovery counts only when your PMS sync drops the balance'

  const callsProof = loading
    ? 'Loading telephony…'
    : m.callsToday > 0 || m.activeCalls > 0
      ? `${m.callsToday} carrier call${m.callsToday === 1 ? '' : 's'} today${m.activeCalls > 0 ? ` · ${m.activeCalls} live now` : ''}`
      : 'Agents dial carriers on your schedule, not Sarah at the front desk'

  return [
    {
      id: 'hold',
      pain: 'Staff hours lost on hold',
      without: 'Front desk calls Sun Life, Canada Life, and Manulife between patients. Three hours gone. Two claims checked.',
      withCollectRx: 'CollectRx voice agents navigate phone trees and speak with carrier reps while your team runs the practice.',
      proof: callsProof,
      href: '/work-queue',
      linkLabel: 'See the work queue',
    },
    {
      id: 'aging',
      pain: 'Claims age past appeal windows',
      without: 'Open insurance A/R sits in spreadsheets. Nobody owns follow-up. A $2,400 crown expires quietly.',
      withCollectRx: 'Every open claim lands in a prioritized queue with aging you can see at a glance.',
      proof: `${arProof}. ${agingProof}.`,
      href: '/reports/aging',
      linkLabel: 'Open aging report',
    },
    {
      id: 'blockers',
      pain: 'No one knows what is blocking payment',
      without: 'Carriers need attachments, resubmits, or a human yes. That stalls in email and sticky notes.',
      withCollectRx: 'Practice gates surface blockers in one inbox so nothing waits on a forgotten task.',
      proof: gatesProof,
      href: '/insurance/gates',
      linkLabel: 'Open gate inbox',
    },
    {
      id: 'verify',
      pain: 'Paid on the phone, not in the PMS',
      without: '"It should be paid" is not cash. Without PMS confirmation, recovered revenue stays invisible.',
      withCollectRx: 'CollectRx tracks sync-verified recovery: money counts when your PMS import clears the balance.',
      proof: recoveryProof,
      href: '/insurance',
      linkLabel: 'Browse insurance A/R',
    },
  ]
}

const PRESENTER_STEPS = [
  'Start with Practice health above: one screen answers "are we okay?" for the owner.',
  'Scroll to Live command center: queue depth, aging orb, and pipeline show the same data your team would live in daily.',
  'Open Gate inbox or Insurance A/R to show where human decisions happen, not black-box automation.',
  'Close with sync-verified recovery: CollectRx proves value when the PMS balance drops, not when a rep says "approved."',
]

export function PracticeDemoStory({ practiceName, metrics, loading = false }: Props) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem('crx_demo_story_collapsed') !== '1'
    } catch {
      return true
    }
  })
  const [notesOpen, setNotesOpen] = useState(false)

  const cards = buildCards(metrics, loading)

  function collapse() {
    setExpanded(false)
    try {
      localStorage.setItem('crx_demo_story_collapsed', '1')
    } catch {
      /* ignore */
    }
  }

  function expand() {
    setExpanded(true)
    try {
      localStorage.removeItem('crx_demo_story_collapsed')
    } catch {
      /* ignore */
    }
  }

  if (!expanded) {
    return (
      <div className="practice-demo-story practice-demo-story--collapsed page-enter">
        <button type="button" className="practice-demo-story-reopen" onClick={expand}>
          Show demo walkthrough for {practiceName}
        </button>
      </div>
    )
  }

  return (
    <section className="practice-demo-story page-enter" aria-labelledby="demo-story-title">
      <div className="practice-demo-story-head">
        <div>
          <p className="crx-section-label">Demo walkthrough</p>
          <h2 id="demo-story-title" className="practice-demo-story-title">
            What CollectRx is, and what it fixes for {practiceName}
          </h2>
          <p className="practice-demo-story-lede">
            Canadian dental practices lose money twice on insurance A/R: staff time on carrier phones, and
            claims that never get collected. CollectRx automates follow-up, shows what is blocking payment,
            and proves recovery when your PMS sync clears the balance.
          </p>
        </div>
        <div className="practice-demo-story-actions">
          <Link to="/demo" className="crx-btn-primary">
            Full animated demo
          </Link>
          <button type="button" className="crx-btn-ghost" onClick={collapse}>
            Hide for daily use
          </button>
        </div>
      </div>

      <div className="practice-demo-story-grid">
        {cards.map((card) => (
          <article key={card.id} className="practice-demo-story-card">
            <p className="practice-demo-story-pain">{card.pain}</p>
            <div className="practice-demo-story-compare">
              <div>
                <p className="practice-demo-story-label">Without CollectRx</p>
                <p className="practice-demo-story-copy">{card.without}</p>
              </div>
              <div>
                <p className="practice-demo-story-label practice-demo-story-label--good">With CollectRx</p>
                <p className="practice-demo-story-copy">{card.withCollectRx}</p>
              </div>
            </div>
            <p className="practice-demo-story-proof">{card.proof}</p>
            <Link to={card.href} className="practice-demo-story-link">
              {card.linkLabel} →
            </Link>
          </article>
        ))}
      </div>

      <div className="practice-demo-story-flow">
        <p className="practice-demo-story-flow-title">How the loop works</p>
        <ol className="practice-demo-story-flow-steps">
          <li>PMS export or import brings open claims into CollectRx.</li>
          <li>Work queue prioritizes what to call next by age, carrier, and rules.</li>
          <li>Voice agents follow up with insurers and log outcomes.</li>
          <li>Gates pause automation when your office must act.</li>
          <li>Recovery is counted when sync verifies the balance cleared in your PMS.</li>
        </ol>
      </div>

      <div className="practice-demo-story-notes">
        <button
          type="button"
          className="practice-demo-story-notes-toggle"
          aria-expanded={notesOpen}
          onClick={() => setNotesOpen((v) => !v)}
        >
          {notesOpen ? 'Hide presenter notes' : 'Show presenter notes'}
        </button>
        {notesOpen && (
          <ul className="practice-demo-story-notes-list">
            {PRESENTER_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
