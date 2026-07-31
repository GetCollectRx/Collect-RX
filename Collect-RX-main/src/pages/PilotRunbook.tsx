import { useState } from 'react'
import { Card, CardHeader, Button } from '../components/ui'

type RunbookTab = 'go-live' | 'faq' | 'rollback'

const TABS: Array<{ id: RunbookTab; label: string }> = [
  { id: 'go-live', label: 'Go-live checklist' },
  { id: 'faq', label: 'Practice FAQ' },
  { id: 'rollback', label: 'Rollback procedure' },
]

function ChecklistSection({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden className="text-gray-400 dark:text-gray-500 select-none">☐</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function GoLiveChecklist() {
  return (
    <div className="space-y-4">
      <ChecklistSection
        title="Day −1 — before onboarding"
        items={[
          'Staging smoke test green',
          'Production secrets audited and rotated where stale',
          'Practice credentials and claims CSV template ready',
          'On-call and escalation phone numbers confirmed for day 1',
        ]}
      />
      <ChecklistSection
        title="Day 0 — onboard the practice"
        items={[
          'Create and confirm the practice in production',
          'Import the claims CSV (insurance outstanding only — not patient balances)',
          'Verify claims appear in the work queue and AR command center',
          'Admin → Integrations shows all expected greens',
          'Confirm billing/subscription status if required for the pilot',
        ]}
      />
      <ChecklistSection
        title="Day 0 — supervised call path"
        items={[
          'Pick one eligible claim (age, attempts, and business-hours rules all pass)',
          'Confirm no CARRIER_BLOCK is active for that carrier',
          'Dispatch and observe the call live',
          'Verify the PHI boundary: UUID tokens only — no patient name or DOB in call metadata',
          'Confirm the outcome lands on the claim (status, notes, escalation as designed)',
        ]}
      />
      <ChecklistSection
        title="CARRIER_BLOCK drill"
        items={[
          'Know how to confirm a block in Admin',
          'Confirm dispatch refuses that carrier while blocked',
          'Document who can clear a block and when',
        ]}
      />
      <ChecklistSection
        title="Exit criteria — pilot success"
        items={[
          'At least one full supervised insurance follow-up loop completed',
          'Zero unexplained PHI boundary violations',
          'Zero unacknowledged CARRIER_BLOCK events',
          'Backups and uptime monitoring still green',
          'Written go / no-go decision for broader rollout',
        ]}
      />
    </div>
  )
}

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: 'What does CollectRx actually do?',
    a: 'CollectRx calls insurance carriers on your behalf to follow up on outstanding claims. It does not call patients. An AI voice agent navigates the carrier phone system, checks claim status, and records the outcome against the claim in your dashboard.',
  },
  {
    q: 'When does it place calls?',
    a: 'Only Monday to Friday, 8am–5pm Eastern. A claim gets at most 3 call attempts. Claims under 30 days old are not called; claims over 90 days old skip the AI and are escalated straight to a person.',
  },
  {
    q: 'Is patient information safe?',
    a: 'Patient names, dates of birth, and health card numbers never leave the backend. The voice system works with anonymous tokens; identifying details needed for the carrier lookup are injected only at the moment of the call and are never stored in call logs.',
  },
  {
    q: 'What happens if a carrier detects automation?',
    a: 'All calls to that carrier stop immediately — not just the current call. Your dashboard shows the block, and a person reviews before calls to that carrier resume.',
  },
  {
    q: 'What do we need to do day to day?',
    a: 'Watch the "Needs human" tab for escalations, keep your claims data current (CSV import or PMS connector), and record payments when they arrive so recovered amounts reconcile.',
  },
  {
    q: 'How do we stop calls?',
    a: 'Practice Settings lets you disable the voice agent entirely, or disable individual carriers. Either takes effect before the next dispatch — no call is placed once disabled.',
  },
  {
    q: 'Who do we contact when something looks wrong?',
    a: 'Use the escalation contact provided during onboarding. For anything involving a carrier block or a suspected privacy issue, contact them immediately rather than waiting for the weekly review.',
  },
]

function PracticeFaq() {
  return (
    <div className="space-y-4">
      {FAQ_ITEMS.map((item) => (
        <Card key={item.q}>
          <CardHeader title={item.q} />
          <p className="text-sm text-gray-700 dark:text-gray-300">{item.a}</p>
        </Card>
      ))}
    </div>
  )
}

function RollbackProcedure() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="When to roll back"
          subtitle="A deploy is misbehaving in production and a forward fix is not minutes away."
        />
        <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 dark:text-gray-300">
          <li>Calls dispatching outside the allowed window or to blocked carriers</li>
          <li>PHI appearing anywhere it should not</li>
          <li>Login, claim import, or the work queue broken for practices</li>
        </ul>
      </Card>
      <Card>
        <CardHeader title="Procedure" />
        <ol className="list-decimal pl-5 space-y-2 text-sm text-gray-700 dark:text-gray-300">
          <li>Pause dispatch first: disable the voice agent for affected practices so no new calls go out during the rollback.</li>
          <li>Redeploy the previous known-good release from the hosting dashboard (or re-tag the previous image).</li>
          <li>Do not auto-downgrade database migrations in production. If a migration already ran, forward-fix the data instead of reversing the schema.</li>
          <li>Verify the core loop after rollback: login, claims visible, one supervised dispatch check.</li>
          <li>Re-enable the voice agent only after verification passes.</li>
          <li>Record what happened and why in the incident log before resuming normal operations.</li>
        </ol>
      </Card>
      <Card>
        <CardHeader title="After the rollback" />
        <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 dark:text-gray-300">
          <li>Reproduce the failure in staging before attempting the deploy again</li>
          <li>Add a test or alert that would have caught it</li>
          <li>Share a short summary with anyone affected at the practice</li>
        </ul>
      </Card>
    </div>
  )
}

export default function PilotRunbook() {
  const [tab, setTab] = useState<RunbookTab>('go-live')

  return (
    <div className="page-enter p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Pilot runbook</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Go-live checklist, practice FAQ, and rollback procedure — read-only reference for pilots.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <Button
            key={t.id}
            variant={tab === t.id ? 'primary' : 'secondary'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'go-live' && <GoLiveChecklist />}
      {tab === 'faq' && <PracticeFaq />}
      {tab === 'rollback' && <RollbackProcedure />}
    </div>
  )
}
