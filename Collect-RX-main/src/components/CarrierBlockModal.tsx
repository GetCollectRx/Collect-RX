import { useState } from 'react'
import type { DeskCarrierBlock } from '../types/frontDesk'
import { resolveApiUrl } from '../lib/resolveApiUrl'

const CARRIER_LABELS: Record<string, string> = {
  sun_life: 'Sun Life',
  canada_life: 'Canada Life',
  manulife: 'Manulife',
  green_shield: 'Green Shield',
  rbc: 'RBC',
  telus_adjudicare: 'TELUS AdjudiCare',
}

type Props = {
  block: DeskCarrierBlock
  practiceId: string
  onClose: () => void
  onCleared: () => void
}

export function CarrierBlockModal({ block, practiceId, onClose, onCleared }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function clearBlock() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        resolveApiUrl(`/api/desk/${practiceId}/carriers/${block.carrierId}/unblock`),
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ staffId: 'front_desk' }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? 'Unblock failed')
      }
      onCleared()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-gray-950 rounded-xl shadow-xl max-w-md w-full p-5 border border-gray-200 dark:border-gray-800">
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">
          Carrier block — {CARRIER_LABELS[block.carrierId] ?? block.carrierId}
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Blocked {new Date(block.blockedAt).toLocaleString()}
        </p>
        <p className="text-sm mt-3 p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-100 dark:border-gray-800">
          {block.reason}
        </p>
        <p className="text-sm mt-2 text-gray-600 dark:text-gray-400">
          {block.heldQueueCount} claim(s) held for this carrier.
        </p>
        {error && <p className="text-sm text-red-600 mt-2" role="alert">{error}</p>}
        <div className="flex gap-2 mt-5 justify-end">
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>Close</button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy}
            onClick={() => void clearBlock()}
          >
            Clear Block &amp; Resume Calls
          </button>
        </div>
      </div>
    </div>
  )
}
