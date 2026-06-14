import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, Button, LoadingSpinner } from '../components/ui'
import { apiFetchJson } from '../lib/apiFetch'
import { resolveApiUrl } from '../lib/resolveApiUrl'

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  )
}

export default function PaymentPage() {
  const { balanceId } = useParams()
  const [balance, setBalance] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [paying,  setPaying]  = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!balanceId) return
    apiFetchJson(`/api/balances/${balanceId}`)
      .then(setBalance)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [balanceId])

  const handlePayment = async () => {
    setPaying(true)
    try {
      const res = await fetch(resolveApiUrl(`/api/pay/${balanceId}`), { method: 'POST', credentials: 'include' })
      if (res.ok) setSuccess(true)
    } catch (err) { console.error('Payment error:', err) }
    finally { setPaying(false) }
  }

  if (loading) return <LoadingSpinner fullPage label="Loading payment details…" />

  if (!balance) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <Card className="text-center max-w-sm w-full">
          <p className="text-gray-500 dark:text-gray-400">Balance not found.</p>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <Card className="text-center max-w-sm w-full py-8">
          <div className="text-5xl mb-4" aria-hidden="true">✅</div>
          <h2 className="text-lg font-bold text-crx-600 dark:text-crx-400">Payment successful!</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Thank you, your payment of{' '}
            <strong className="text-gray-900 dark:text-gray-100">
              ${balance.amount.toFixed(2)}
            </strong>{' '}
            has been received.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Your balance has been paid in full.</p>
        </Card>
      </div>
    )
  }

  if (balance.status === 'PAID') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <Card className="text-center max-w-sm w-full">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Already paid</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">This balance has already been settled.</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5">
        {/* Branding */}
        <div className="text-center">
          <div className="w-10 h-10 rounded-xl bg-crx-500 flex items-center justify-center mx-auto mb-3" aria-hidden="true">
            <span className="text-white text-lg font-bold">Rx</span>
          </div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Collect<span className="text-crx-500">Rx</span> Payment Portal</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Secure patient balance payment</p>
        </div>

        <Card>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3">
            Balance Summary
          </h2>
          <InfoRow label="Patient"          value={balance.patient?.displayName} />
          <InfoRow label="Balance created"  value={new Date(balance.createdAt).toLocaleDateString('en-CA')} />
          <InfoRow label="Days outstanding" value={`${balance.daysOutstanding} days`} />
          <div className="flex items-center justify-between pt-4 mt-2 border-t border-gray-100 dark:border-gray-700">
            <span className="text-base font-semibold text-gray-900 dark:text-gray-100">Amount due</span>
            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">
              ${balance.amount.toFixed(2)}
            </span>
          </div>
        </Card>

        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={handlePayment}
          loading={paying}
        >
          {paying ? 'Processing…' : `Pay $${balance.amount.toFixed(2)}`}
        </Button>

        <p className="text-xs text-center text-gray-400 dark:text-gray-500">
          This is a simulated payment portal for demonstration purposes. No real charges will be made.
        </p>
      </div>
    </div>
  )
}
