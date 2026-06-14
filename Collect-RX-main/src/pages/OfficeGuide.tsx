import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../components/ui'

/**
 * Plain-language guide for office managers, no Electron/Railway jargon.
 */
export default function OfficeGuide() {
  return (
    <div className="page-enter p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">How CollectRx works</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          For your front desk and office manager, what happens day to day, and what to do when something breaks.
        </p>
      </div>

      <Card>
        <CardHeader
          title="The flow in one minute"
          subtitle="You do not need to know where the app is hosted or how the desktop icon works."
        />
        <ol className="list-decimal list-inside space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <li>
            <strong className="text-gray-900 dark:text-gray-100">Aging and balances show up.</strong>{' '}
            Insurance and patient balances appear in <strong>Insurance AR</strong>, <strong>Outreach AR</strong>, and{' '}
            <strong>Patient AR</strong> after data sync (from your practice software or import). Staff should use the{' '}
            <strong>Work queue</strong> for ranked follow-up across all AR types. Aging summaries are on the{' '}
            <strong>Dashboard</strong>.
          </li>
          <li>
            <strong className="text-gray-900 dark:text-gray-100">The queue runs.</strong>{' '}
            CollectRx schedules follow-up work: automated messages to patients (reminders cadence), and, when
            configured, outbound calls to insurance carriers for claim status. Carrier order can be adjusted in{' '}
            <strong>Admin</strong> (carrier priority).
          </li>
          <li>
            <strong className="text-gray-900 dark:text-gray-100">Calls produce results.</strong>{' '}
            When voice follow-up runs, outcomes (paid, pending, denied, need info, etc.) are recorded and tied back to
            claims. Summaries and next steps surface in the app; detailed transcripts depend on your telephony setup.
          </li>
          <li>
            <strong className="text-gray-900 dark:text-gray-100">You take action in plain language.</strong>{' '}
            Use <strong>Patient AR</strong> for payment links and reminders, <strong>Outbox</strong> for message
            history, and <strong>Admin</strong> for imports and integration health. <strong>Estimate</strong> supports
            pre-treatment estimates when benefits data is available.
          </li>
        </ol>
      </Card>

      <Card>
        <CardHeader
          title="When something goes wrong"
          subtitle="What your team actually sees: and what to do first."
        />
        <div className="space-y-5 text-sm text-gray-700 dark:text-gray-300">
          <section>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Patient payments (Stripe)</h3>
            <p className="mb-2">
              <strong>What you see:</strong> Payment links missing, patients report errors at checkout, or balances do
              not update after a successful card payment.
            </p>
            <p className="mb-2">
              <strong>What to do:</strong> Open <Link to="/admin" className="text-crx-600 dark:text-crx-400 underline">Admin</Link>
              {' → '}Integrations. Confirm Stripe and Connect show as complete in test or live mode (as appropriate).
              If something is red or incomplete, finish Connect onboarding or contact your CollectRx administrator.
              Staff cannot fix missing bank keys from this screen.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Engineering checks webhook delivery and logs; your first step is always confirming Connect and mode
              (test vs live) in Admin.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Abeldent / sync (balances stale)</h3>
            <p className="mb-2">
              <strong>What you see:</strong> Dashboard or Patient AR does not match your practice management software;
              new procedures never appear.
            </p>
            <p className="mb-2">
              <strong>What to do:</strong> Open <Link to="/admin/sync" className="text-crx-600 dark:text-crx-400 underline">Admin → Sync ops</Link>
              {' '}for import history and drift flags. If you use the CollectRx desktop helper, check the system tray icon: it
              normally shows sync status. Trigger a manual sync from the tray menu if available. If sync shows an
              error, note the message and contact support, the office does not need to open SQL or Railway.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              You can still use CSV import in Admin as a fallback when your rollout plan allows it.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Carrier block (automated calls paused)</h3>
            <p className="mb-2">
              <strong>What you see:</strong> A banner on the <Link to="/" className="text-crx-600 dark:text-crx-400 underline">Dashboard</Link>{' '}
              naming one or more carriers as blocked, or Admin shows a carrier marked blocked. Outbound calls to that
              carrier stop for the practice until the block is cleared.
            </p>
            <p className="mb-2">
              <strong>Why:</strong> A carrier may flag or reject automated calling. CollectRx stops calling that carrier
              for everyone in the practice to reduce risk, this is intentional, not a random bug.
            </p>
            <p className="mb-2">
              <strong>What to do:</strong> Do not retry blindly. Note the carrier name and time, finish outstanding
              claims for that carrier by phone manually if required, and contact your CollectRx administrator or
              support to review the block and next steps.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Email or text reminders</h3>
            <p>
              <strong>What you see:</strong> Patients report no reminder; Outbox shows failures or bounces.
            </p>
            <p className="mt-2">
              <strong>What to do:</strong> Admin → Integrations, SendGrid and Twilio must be configured on the host
              environment. If those show missing, reminders cannot send until your administrator completes setup.
            </p>
          </section>
        </div>
      </Card>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        CollectRx runs as a secure web app you open in the browser or through the desktop shortcut, both show the same
        screens. Your login and data are tied to your practice, not to which window you used.
      </p>
    </div>
  )
}
