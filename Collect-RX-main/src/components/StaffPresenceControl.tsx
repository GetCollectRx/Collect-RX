import { useCallback, useEffect, useState } from 'react'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { parseApiJson } from '../lib/parseApiJson'

type Status = 'AVAILABLE' | 'BUSY' | 'OFF'

interface PresenceData {
  readyCount: number
  mine: { status: Status; fresh: boolean } | null
}

const OPTIONS: Array<{ status: Status; label: string }> = [
  { status: 'AVAILABLE', label: 'Available' },
  { status: 'BUSY', label: 'Busy' },
  { status: 'OFF', label: 'Off' },
]

/**
 * Whether you can take a live carrier rep right now. Calls only start while someone is available,
 * and the setting expires after four hours so a forgotten toggle never leaves the desk marked ready.
 */
export function StaffPresenceControl({ practiceId }: { practiceId: string }) {
  const [data, setData] = useState<PresenceData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/desk/${practiceId}/presence`

  const load = useCallback(async () => {
    const res = await fetch(resolveApiUrl(base), { credentials: 'include' })
    const json = await parseApiJson<{ data: PresenceData }>(res)
    setData(json.data)
  }, [base])

  useEffect(() => {
    void load().catch((e) => setError((e as Error).message))
    const timer = setInterval(() => void load().catch(() => undefined), 60_000)
    return () => clearInterval(timer)
  }, [load])

  async function choose(status: Status) {
    setError(null)
    const res = await fetch(resolveApiUrl(base), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(j.error ?? res.statusText)
    }
    await load()
  }

  const current = data?.mine && data.mine.fresh ? data.mine.status : 'OFF'

  return (
    <div className="mb-3">
      <p className="text-2xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1.5">Your availability</p>
      <div className="flex gap-1" role="group" aria-label="Your availability">
        {OPTIONS.map((o) => (
          <button
            key={o.status}
            type="button"
            aria-pressed={current === o.status}
            className={`flex-1 text-xs py-1 rounded-lg border transition-colors ${
              current === o.status
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 font-semibold'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/40'
            }`}
            onClick={() => void choose(o.status).catch((e) => setError((e as Error).message))}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-2xs text-gray-400 dark:text-gray-600 mt-1.5">
        {data === null ? 'Loading' : data.readyCount === 0 ? 'Nobody is available, so no calls will start.' : `${data.readyCount} available`}
      </p>
      {error && <p className="text-2xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
    </div>
  )
}
