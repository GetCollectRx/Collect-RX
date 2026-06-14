import { useState } from 'react'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { usePractice } from '../context/PracticeContext'
import { ROLE_LABELS } from '../lib/authTypes'

interface LookupResult {
  id: string
  name: string
  balance: number
  claim_status: string
  last_reminder_sent: string | null
}

export default function PatientLookup() {
  const { sessionUser, logout } = usePractice()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LookupResult[]>([])
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSearch(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim().length < 2) {
      setError('Enter at least 2 characters')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(
        resolveApiUrl(`/api/patients/lookup?name=${encodeURIComponent(query.trim())}`),
        { credentials: 'include' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Lookup failed')
        return
      }
      const data = await res.json() as { results: LookupResult[] }
      setResults(data.results ?? [])
      setSearched(true)
    } catch {
      setError('Network error, please try again')
    } finally {
      setLoading(false)
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return 'N/A'
    return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function statusColor(status: string) {
    switch (status) {
      case 'paid': return 'text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/20'
      case 'outstanding': return 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20'
      case 'write_off': return 'text-gray-500 bg-gray-100 dark:text-gray-400 dark:bg-gray-800'
      default: return 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-800'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-[6px] bg-crx-500 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944z" />
            </svg>
          </div>
          <span className="font-semibold text-sm text-gray-900 dark:text-white">
            Collect<span className="text-crx-500">Rx</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          {sessionUser && (
            <div className="text-right">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{sessionUser.displayName}</p>
              <p className="text-2xs text-gray-400 dark:text-gray-600">
                {ROLE_LABELS[sessionUser.role] ?? sessionUser.role}
              </p>
            </div>
          )}
          <button
            onClick={() => void logout()}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center px-4 pt-16 pb-12">
        <div className="w-full max-w-lg">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Patient Lookup</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
            Search by patient name to see their balance and claim status.
          </p>

          <form onSubmit={onSearch} className="flex gap-2 mb-6">
            <input
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setSearched(false) }}
              placeholder="Patient first or last name…"
              className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-crx-500/30 focus:border-crx-500 transition-colors"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2.5 text-sm font-semibold rounded-lg bg-crx-500 hover:bg-crx-600 text-white disabled:opacity-50 transition-colors"
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
          )}

          {searched && results.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
              No patients found for "{query}"
            </p>
          )}

          {results.length > 0 && (
            <div className="space-y-2">
              {results.map(r => (
                <div
                  key={r.id}
                  className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{r.name}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        Last reminder: {formatDate(r.last_reminder_sent)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">
                        ${r.balance.toFixed(2)}
                      </p>
                      <span className={`inline-block mt-0.5 text-2xs font-medium px-1.5 py-0.5 rounded-full ${statusColor(r.claim_status)}`}>
                        {r.claim_status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
