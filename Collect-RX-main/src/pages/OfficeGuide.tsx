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
          For your front desk and office manager: how insurance follow-up runs and what to do when something breaks.
        </p>
      </div>

      <Card>
        <CardHeader
          title="The flow in one minute"
          subtitle="CollectRx calls insurance carriers on your behalf — not patients."
        />
        <ol className="list-decimal list-inside space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <li>
            <strong className="text-gray-900 dark:text-gray-100">Claims show up after PMS sync.</strong>{' '}
            Open insurance A/R appears in <strong>Insurance AR</strong> and the ranked{' '}
            <strong>Work queue</strong> after data sync from your practice software. Aging summaries are on the{' '}
            <strong>Dashboard</strong>.
          </li>
          <li>
            <strong className="text-gray-900 dark:text-gray-100">Voice agents call carriers.</strong>{' '}
            CollectRx schedules outbound calls to Sun Life, Canada Life, Manulife, and other carriers to check claim
            status, push adjudication, and trace payments. Carrier order can be adjusted in{' '}
            <strong>Settings</strong> and <strong>Admin</strong>.
          </li>
          <li>
            <strong className="text-gray-900 dark:text-gray-100">Calls produce results.</strong>{' '}
            Outcomes (approved, pending, denied, need docs, etc.) are recorded on each claim. When a carrier approves
            payment, recovery is confirmed when your PMS sync clears the balance — not when the call ends.
          </li>
          <li>
            <strong className="text-gray-900 dark:text-gray-100">You clear gates and escalations.</strong>{' '}
            When a claim needs resubmit, missing x-rays, or a human verify step, it lands in the{' '}
            <strong>Gate inbox</strong> or <strong>Escalations</strong>. Clear those so agents can call again.
          </li>
        </ol>
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
              <strong>What you see:</strong> Dashboard or Insurance AR does not match your practice management software;
              new claims never appear.
            </p>
            <p className="mb-2">
              <strong>What to do:</strong> Open{' '}
              <Link to="/admin/sync" className="text-crx-600 dark:text-crx-400 underline">
                Admin → Sync ops
              </Link>{' '}
              for import history and drift flags. If you use the CollectRx desktop helper, check the system tray icon for
              sync status. Trigger a manual sync from the tray menu if available.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Carrier block (automated calls paused)</h3>
            <p className="mb-2">
              <strong>What you see:</strong> A banner on the{' '}
              <Link to="/" className="text-crx-600 dark:text-crx-400 underline">
                Dashboard
              </Link>{' '}
              naming one or more carriers as blocked. Outbound calls to that carrier stop until the block is cleared.
            </p>
            <p className="mb-2">
              <strong>What to do:</strong> Note the carrier name and time, finish outstanding claims for that carrier by
              phone manually if required, and contact your CollectRx administrator to review the block.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Practice gates (claims stuck)</h3>
            <p>
              <strong>What you see:</strong> Claims in the work queue with a gate badge, or items in{' '}
              <Link to="/insurance/gates" className="text-crx-600 dark:text-crx-400 underline">
                Gate inbox
              </Link>
              .
            </p>
            <p className="mt-2">
              <strong>What to do:</strong> Open the claim, complete the gate (resubmit, attach docs, or verify), then
              mark it complete so the next carrier call batch can run.
            </p>
          </section>
        </div>
      </Card>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        CollectRx runs as a secure web app you open in the browser or through the desktop shortcut — both show the same
        screens. Your login and data are tied to your practice, not to which window you used.
      </p>
    </div>
  )
}
