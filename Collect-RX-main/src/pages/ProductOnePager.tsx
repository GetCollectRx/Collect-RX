import { Link } from 'react-router-dom'

/**
 * P9-04 — sales/support one-pager: what CollectRx does / does not; handoff to CS.
 */
export default function ProductOnePager() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-200">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-sm text-crx-600 dark:text-crx-400">
            ← Sign in
          </Link>
          <span className="text-sm font-medium">CollectRx</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6 text-sm leading-relaxed">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Product overview</h1>
        <p className="text-gray-500 dark:text-gray-400">For sales, support, and onboarding — one page.</p>

        <section>
          <h2 className="text-base font-semibold text-crx-600 dark:text-crx-400 mb-2">What CollectRx does</h2>
          <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
            <li>Helps practices run insurance A/R after adjudication: balances, stages, and reminders.</li>
            <li>Connects to email and SMS (when configured) for patient-friendly payment nudges with opt-out.</li>
            <li>Uses Stripe Connect so patients can pay the practice; card data stays with Stripe.</li>
            <li>Provides admin and audit tools for settings, imports, and compliance-oriented logging where implemented.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-amber-700 dark:text-amber-400 mb-2">What it does not do (v1)</h2>
          <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
            <li>Not a full practice management system — Dentrix (or your PMS) remains the system of record.</li>
            <li>Not legal or clinical advice; your team sets policies and consents for communications.</li>
            <li>Not a guarantee of collection outcomes — it automates workflows you configure.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Support handoff</h2>
          <p className="text-gray-700 dark:text-gray-300">
            For implementation: Admin → Integrations, CSV import, and Stripe Connect. For escalations: route to
            your internal owner for the CollectRx deployment; include practice ID, screenshot, and steps to reproduce.
          </p>
        </section>

        <p>
          <Link to="/changelog" className="text-crx-600 dark:text-crx-400 underline">
            Customer changelog
          </Link>
        </p>
      </main>
    </div>
  )
}
