import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { parseApiJson } from '../lib/parseApiJson'
import { SubscriptionUsageCard } from '../components/SubscriptionUsageCard'

export default function PracticeBillingPage() {
  const { practice, logout, refreshSession } = usePractice()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const subscribed = searchParams.get('subscribed') === '1'
  const canceled = searchParams.get('canceled') === '1'

  useEffect(() => {
    if (subscribed) {
      void refreshSession()
    }
  }, [subscribed, refreshSession])

  async function startCheckout() {
    setError(null)
    setBusy(true)
    try {
      const r = await fetch(resolveApiUrl('/api/billing/checkout'), { method: 'POST', credentials: 'include' })
      const data = await parseApiJson<{ url?: string; error?: string }>(r)
      if (!r.ok) {
        throw new Error(data.error || 'Could not start checkout')
      }
      if (data.url) {
        window.location.href = data.url
        return
      }
      throw new Error('No checkout URL returned')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function openPortal() {
    setError(null)
    setBusy(true)
    try {
      const r = await fetch(resolveApiUrl('/api/billing/portal'), { method: 'POST', credentials: 'include' })
      const data = await parseApiJson<{ url?: string; error?: string }>(r)
      if (!r.ok) {
        throw new Error(data.error || 'Could not open billing portal')
      }
      if (data.url) {
        window.location.href = data.url
        return
      }
      throw new Error('No portal URL returned')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-crx-50/50 dark:from-gray-950 dark:via-gray-950 dark:to-crx-950/20 px-4">
      <main className="w-full max-w-xl space-y-6 p-8 rounded-2xl border border-gray-200/90 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm shadow-card">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">CollectRx subscription</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {practice?.name ? (
              <>Billing for <span className="font-medium text-gray-700 dark:text-gray-200">{practice.name}</span>.</>
            ) : (
              <>Your practice needs an active subscription to use CollectRx.</>
            )}
          </p>
        </div>

        {subscribed && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 border border-emerald-200 dark:border-emerald-800">
            Payment received — updating your account…
          </p>
        )}
        {canceled && (
          <p className="text-sm text-amber-700 dark:text-amber-400 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 border border-amber-200 dark:border-amber-800">
            Checkout was canceled. You can try again when you are ready.
          </p>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <SubscriptionUsageCard alwaysShow />

        <div className="space-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void startCheckout()}
            className="w-full py-2.5 text-sm font-medium rounded-lg bg-crx-500 hover:bg-crx-600 text-white disabled:opacity-50"
          >
            {busy ? 'Please wait…' : 'Subscribe with Stripe'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void openPortal()}
            className="w-full py-2.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Manage billing & invoices
          </button>
        </div>

        <button
          type="button"
          onClick={() => void logout()}
          className="text-2xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
        >
          Sign out
        </button>
      </main>
    </div>
  )
}
