import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, LoadingSpinner } from '../components/ui'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { parseApiJson } from '../lib/parseApiJson'

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

/** Treat null, empty, or whitespace-only as missing (API may return ""). */
function stripeCheckoutUrl(url: string | null | undefined): string | null {
  if (url == null) return null
  const t = String(url).trim()
  return t.length > 0 ? t : null
}

/**
 * P3-22, staff shares /pay/p/:token; no practice login required.
 * Token is issued when a Stripe Payment Link is created (see setPaymentLink).
 */
type PublicPayData = {
  paid: boolean
  amountDue: number
  currency: string
  stripeUrl: string | null
  firstName: string
}

/** Coerce API JSON into safe `PublicPayData` (avoids render crashes on partial/malformed bodies). */
function normalizePublicPayJson(j: Record<string, unknown>): PublicPayData {
  const paid = Boolean(j.paid)
  const rawDue = j.amountDue
  let amountDue = 0
  if (typeof rawDue === 'number' && Number.isFinite(rawDue)) {
    amountDue = rawDue
  } else if (typeof rawDue === 'string' && rawDue.trim() !== '') {
    const n = Number(rawDue)
    if (Number.isFinite(n)) amountDue = n
  }
  const currency =
    typeof j.currency === 'string' && j.currency.trim().length > 0 ? j.currency.trim() : 'CAD'
  const firstName = typeof j.firstName === 'string' ? j.firstName : ''
  return {
    paid,
    amountDue,
    currency,
    firstName,
    stripeUrl: stripeCheckoutUrl(j.stripeUrl as string | null | undefined),
  }
}

export default function PublicPatientPay() {
  const { publicToken } = useParams()
  const [data, setData] = useState<PublicPayData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [loading, setLoading] = useState(true)
  /** Bumps when `publicToken` changes so stale fetches cannot clear loading or overwrite state. */
  const loadGen = useRef(0)

  useEffect(() => {
    if (!publicToken) {
      loadGen.current += 1
      setErr('Invalid link')
      setExpired(false)
      setData(null)
      setLoading(false)
      return
    }
    const ac = new AbortController()
    const g = ++loadGen.current
    setErr(null)
    setExpired(false)
    setData(null)
    setLoading(true)
    const url = resolveApiUrl(`/api/public/pay/${encodeURIComponent(publicToken)}`)
    fetch(url, { signal: ac.signal })
      .then(async (r) => {
        if (g !== loadGen.current) return
        const j = await parseApiJson<{
          paid?: boolean
          amountDue?: number
          currency?: string
          stripeUrl?: string | null
          firstName?: string
          message?: string
          error?: string
        }>(r)
        if (g !== loadGen.current) return
        if (r.status === 410) {
          setExpired(true)
          setErr(j.message || 'Link expired')
          return
        }
        if (!r.ok) {
          setErr(j.error || 'Not found')
          return
        }
        const normalized = normalizePublicPayJson(j as Record<string, unknown>)
        setData(normalized)
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return
        if (g !== loadGen.current) return
        setErr(e instanceof Error ? e.message : 'Network error')
      })
      .finally(() => {
        if (g === loadGen.current) setLoading(false)
      })
    return () => {
      ac.abort()
    }
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

  if (data && !stripeCheckoutUrl(data.stripeUrl)) {
    const who = (data.firstName || '').trim() || 'there'
    const showAmount = !data.paid && data.amountDue > 0
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <Card className="text-center max-w-md w-full space-y-3 py-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Payment link not ready
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Hi {who}, we could not open a secure card checkout for this balance yet.
            Please contact your dental office; they can resend your pay link or take payment another way.
          </p>
          {showAmount && (
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 tabular-nums">
              Amount due: {data.currency} ${data.amountDue.toFixed(2)}
            </p>
          )}
        </Card>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
        <Card className="text-center max-w-md w-full">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            This payment page could not be loaded. Try refreshing, or contact your dental office for a new link.
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
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Hi {(data.firstName || '').trim() || 'there'}, you have a balance to pay
          </p>
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
          href={stripeCheckoutUrl(data.stripeUrl)!}
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
