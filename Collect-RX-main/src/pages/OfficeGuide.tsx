import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../components/ui'

/**
 * Plain-language guide for office managers — insurance carrier recovery only.
 */
export default function OfficeGuide() {
  return (
    <div className="page-enter p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">How CollectRx works</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          For owners, office managers, and coordinators: how insurance follow-up runs and what to do when something breaks.
        </p>
      </div>

      <Card>
        <CardHeader
          title="The flow in one minute"
          subtitle="CollectRx calls insurance carriers on your behalf — not patients."
        />
        <ol className="list-decimal list-inside space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <li>
            <strong className="text-gray-900 dark:text-gray-100">After the visit — claims recovery.</strong>{' '}
            Open insurance A/R appears in{' '}
            <Link to="/insurance" className="text-crx-600 dark:text-crx-400 underline">
              Claims
            </Link>{' '}
            (All claims, Priority queue, Blocked gates, Needs human tabs). The{' '}
            <Link to="/dashboard" className="text-crx-600 dark:text-crx-400 underline">
              Dashboard
            </Link>{' '}
            command center shows what needs you, live calls, and top money at risk.
          </li>
          <li>
            <strong className="text-gray-900 dark:text-gray-100">Before the visit — pre-visit checks.</strong>{' '}
            CDCP predetermination and eligibility signals live in{' '}
            <Link to="/pre-visit" className="text-crx-600 dark:text-crx-400 underline">
              Pre-visit
            </Link>{' '}
            (separate from post-visit recovery).
          </li>
          <li>
            <strong className="text-gray-900 dark:text-gray-100">Voice agents call carriers.</strong>{' '}
            CollectRx schedules outbound calls to Sun Life, Canada Life, Manulife, and other carriers to check claim
            status, push adjudication, and trace payments.
          </li>
          <li>
            <strong className="text-gray-900 dark:text-gray-100">Calls produce results.</strong>{' '}
            Outcomes are recorded on each claim timeline. Recovery is confirmed when your PMS sync clears the balance —
            not when the call ends.
          </li>
          <li>
            <strong className="text-gray-900 dark:text-gray-100">You clear gates.</strong>{' '}
            When a claim needs resubmit, missing x-rays, or human verify, it appears under{' '}
            <Link to="/insurance?tab=blocked" className="text-crx-600 dark:text-crx-400 underline">
              Blocked gates
            </Link>{' '}
            and on the Dashboard &ldquo;Needs you&rdquo; list.
          </li>
        </ol>
      </Card>

      <Card>
        <CardHeader
          title="Who can do what"
          subtitle="Two axes: see the call loop vs. dial carriers vs. clear gates."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-700 dark:text-gray-300">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-xs uppercase text-gray-500">
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Practice owner</th>
                <th className="py-2 pr-4">Office manager / coordinator</th>
                <th className="py-2">Front desk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              <tr>
                <td className="py-2 pr-4 font-medium">See live calls &amp; outcomes</td>
                <td className="py-2 pr-4">Yes (read-only)</td>
                <td className="py-2 pr-4">Yes</td>
                <td className="py-2">Live console</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-medium">Initiate carrier calls</td>
                <td className="py-2 pr-4">No</td>
                <td className="py-2 pr-4">Yes</td>
                <td className="py-2">Console controls</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-medium">Clear blocked gates</td>
                <td className="py-2 pr-4">Yes</td>
                <td className="py-2 pr-4">Yes</td>
                <td className="py-2">Escalations</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-medium">Change carrier / integration settings</td>
                <td className="py-2 pr-4">No</td>
                <td className="py-2 pr-4">Yes</td>
                <td className="py-2">No</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-medium">Pre-visit verification</td>
                <td className="py-2 pr-4">View</td>
                <td className="py-2 pr-4">View + import</td>
                <td className="py-2">No</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Demo walkthrough (Maple Grove Dental)"
          subtitle="Run npm run demo:seed — login demo@maplegrovedental.ca / CollectRx2026!"
        />
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Four story claims teach the call-to-resolution loop. Calls prefixed with <code className="text-xs">demo-</code>{' '}
          show a &ldquo;Simulated call&rdquo; badge — connect VAPI for live carrier lines.
        </p>
        <table className="w-full text-sm text-left text-gray-700 dark:text-gray-300">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-xs uppercase text-gray-500">
              <th className="py-2 pr-3">Claim ref</th>
              <th className="py-2 pr-3">Teaches</th>
              <th className="py-2">Open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            <tr>
              <td className="py-2 pr-3 font-mono text-xs">SL-2025-002341</td>
              <td className="py-2 pr-3">Live call in progress (Dashboard strip)</td>
              <td className="py-2">
                <Link to="/insurance" className="text-crx-600 underline">
                  Claims
                </Link>
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-3 font-mono text-xs">CL-2025-007712</td>
              <td className="py-2 pr-3">Practice gate — attach perio chart</td>
              <td className="py-2">
                <Link to="/insurance?tab=blocked" className="text-crx-600 underline">
                  Blocked gates
                </Link>
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-3 font-mono text-xs">GS-2025-009984</td>
              <td className="py-2 pr-3">72h processing recall due now</td>
              <td className="py-2">
                <Link to="/insurance?tab=queue" className="text-crx-600 underline">
                  Priority queue
                </Link>
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-3 font-mono text-xs">MAN-2025-004401</td>
              <td className="py-2 pr-3">High-value aging ($3,180 / 67d) — top rank</td>
              <td className="py-2">
                <Link to="/insurance?tab=queue" className="text-crx-600 underline">
                  Priority queue
                </Link>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card>
        <CardHeader
          title="When something goes wrong"
          subtitle="What your team actually sees — and what to do first."
        />
        <div className="space-y-5 text-sm text-gray-700 dark:text-gray-300">
          <section>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">PMS sync (claims stale)</h3>
            <p className="mb-2">
              <strong>What you see:</strong> Dashboard or Claims does not match your practice management software;
              new claims never appear.
            </p>
            <p className="mb-2">
              <strong>What to do:</strong> Open{' '}
              <Link to="/admin/sync" className="text-crx-600 dark:text-crx-400 underline">
                Admin → Sync ops
              </Link>{' '}
              for import history and drift flags.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Carrier block (automated calls paused)</h3>
            <p className="mb-2">
              <strong>What you see:</strong> A banner on the{' '}
              <Link to="/dashboard" className="text-crx-600 dark:text-crx-400 underline">
                Dashboard
              </Link>{' '}
              naming one or more carriers as blocked.
            </p>
            <p className="mb-2">
              <strong>What to do:</strong> Finish outstanding claims manually if required; contact your CollectRx
              administrator to review the block.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Practice gates (claims stuck)</h3>
            <p>
              <strong>What you see:</strong> Dashboard &ldquo;Needs you&rdquo; list, or{' '}
              <Link to="/insurance?tab=blocked" className="text-crx-600 dark:text-crx-400 underline">
                Blocked gates
              </Link>{' '}
              on Claims.
            </p>
            <p className="mt-2">
              <strong>What to do:</strong> Open the claim, complete the gate (resubmit, attach docs), then mark it
              complete so the next carrier call batch can run.
            </p>
          </section>
        </div>
      </Card>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        CollectRx runs as a secure web app — same screens in browser or{' '}
        <Link to="/download" className="underline text-crx-600 dark:text-crx-400">
          desktop app
        </Link>
        . Your login and data are tied to your practice.
      </p>
    </div>
  )
}
