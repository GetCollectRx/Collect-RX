import { Card } from '../components/ui'
import { useSearchParams, Link } from 'react-router-dom'

/** P3-23, post-Stripe return (configure `after_completion` in Payment Links to this path). */
export default function PaymentThankYou() {
  const [q] = useSearchParams()
  const session = q.get('session_id')

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
      <Card className="text-center max-w-md w-full py-10 px-6">
        <div className="text-5xl mb-4" aria-hidden="true">✅</div>
        <h1 className="text-lg font-bold text-crx-600 dark:text-crx-400">Thank you</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
          Your payment is processing. You will receive a confirmation by email if your office has one on file.
        </p>
        {session && <p className="text-xs text-gray-400 mt-3 font-mono">Reference: {session.slice(0, 20)}…</p>}
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-6">
          Questions? Contact your dental office.
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
          <Link to="/" className="text-crx-600 dark:text-crx-400 hover:underline">Staff sign in</Link>
        </p>
      </Card>
    </div>
  )
}
