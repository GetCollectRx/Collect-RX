import { Link } from 'react-router-dom'

export default function LegalCallListening() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-200">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/signup" className="text-sm text-crx-600 dark:text-crx-400">
            ← Back to sign up
          </Link>
          <span className="text-sm font-medium">CollectRx</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4 text-sm leading-relaxed">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Call-listening consent</h1>
        <p className="text-gray-500 dark:text-gray-400">Draft, wording pending owner approval before the pilot.</p>
        <p>
          CollectRx places calls to insurance carriers on behalf of your practice to follow up on claim status. The
          system listens to these calls while they run so it can navigate phone menus, wait on hold, notice when a
          representative answers, and record the outcome of the call.
        </p>
        <p>
          Audio is not retained. CollectRx stores structured outcome details such as claim status, reference
          numbers and call timing. CollectRx does not contact patients.
        </p>
        <p>
          When a representative answers, a member of your staff may be connected to the call. By accepting, you
          consent on behalf of your practice to this listening and to staff being connected.
        </p>
      </main>
    </div>
  )
}
