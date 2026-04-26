import { Link } from 'react-router-dom'
import { CUSTOMER_CHANGELOG } from '../data/customerChangelog'

export default function Changelog() {
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
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">What&apos;s new</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          High-level changes suitable for staff and customers. For engineering detail, use your internal release process
          and git history.
        </p>
        <ul className="space-y-8">
          {CUSTOMER_CHANGELOG.map((entry) => (
            <li key={entry.version} className="border-b border-gray-200 dark:border-gray-800 pb-8 last:border-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{entry.version}</h2>
                <time className="text-2xs text-gray-500" dateTime={entry.date}>
                  {entry.date}
                </time>
              </div>
              <ul className="mt-2 list-disc list-inside text-sm text-gray-600 dark:text-gray-300 space-y-1">
                {entry.items.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
