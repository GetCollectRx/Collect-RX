import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, LoadingSpinner } from '../components/ui'

/**
 * P3-22 — staff shares /pay/p/:token; no practice login required.
 * Token is issued when a Stripe Payment Link is created (see setPaymentLink).
 */
export default function PublicPatientPay() {
  const { publicToken } = useParams()
  const [data, setData] = useState<{
    paid: boolean; amountDue: number; currency: string; stripeUrl: string | null; firstName: string
  } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!publicToken) { setErr('Invalid link'); setLoading(false); return }
    fetch(`/api/public/pay/${encodeURIComponent(publicToken)}`)
      .then(async (r) => {
        const j = await r.json()
        if (r.status === 410) { setExpired(true); setErr(j.message || 'Link expired'); return }
        if (!r.ok) { setErr(j.error || 'Not found'); return }
        setData(j)
      })
      .catch(() => setErr('Network error'))
      .finally(() => setLoading(false))
  }, [publicToken])

  if (loading) return <LoadingSpinner fullPage label="Loading payment…" />

  if (err && !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <Card className="text-center max-w-md w-full">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {expired ? 'Link expired' : 'Unable to load payment'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{err}</p>
        </Card>
      </div>
    )
  }

  if (data?.paid) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <Card className="text-center max-w-md w-full py-8">
          <div className="text-5xl mb-4" aria-hidden="true">✅</div>
          <h2 className="text-lg font-bold text-crx-600 dark:text-crx-400">No balance due</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">This account is paid up. Thank you.</p>
        </Card>
      </div>
    )
  }

  if (!data?.stripeUrl) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <Card className="text-center max-w-md w-full">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            A payment link is not ready yet. Please contact your dental office.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center">
          <div className="w-10 h-10 rounded-xl bg-crx-500 flex items-center justify-center mx-auto mb-3" aria-hidden="true">
            <span className="text-white text-lg font-bold">Rx</span>
          </div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Collect<span className="text-crx-500">Rx</span></h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Hi {data.firstName} — you have a balance to pay</p>
        </div>
        <Card>
          <div className="flex items-center justify-between pt-1">
            <span className="text-base font-semibold text-gray-900 dark:text-gray-100">Amount due</span>
            <span className="text-2xl font-bold tabular-nums">
              {data.currency} ${data.amountDue.toFixed(2)}
            </span>
          </div>
        </Card>
        <a
          href={data.stripeUrl!}
          className="block w-full py-3 px-4 text-center text-sm font-medium rounded-lg bg-crx-500 hover:bg-crx-600 text-white transition-colors"
        >
          Pay securely with card
        </a>
        <p className="text-xs text-center text-gray-400 dark:text-gray-500">
          You will complete payment on Stripe. CollectRx does not store your card number.
        </p>
      </div>
    </div>
  )
}
