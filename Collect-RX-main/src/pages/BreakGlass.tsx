import { useState } from 'react'
import { apiFetchJson } from '../lib/apiFetch'
import { Card, CardHeader, Button } from '../components/ui'

export default function BreakGlass() {
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'build' | 'run' | null>(null)

  async function submit(action: 'build' | 'run') {
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('A reason is required for break-glass actions')
      return
    }
    setBusy(action)
    setError(null)
    setMessage(null)
    try {
      const res = await apiFetchJson<{ success: boolean; message?: string }>(
        `/api/admin/queue/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: trimmed }),
        },
      )
      setMessage(res.message ?? `Queue ${action} logged successfully`)
      setReason('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page-enter p-6 space-y-6 max-w-[720px]">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Break Glass</h1>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
          Emergency queue operations, all actions are audited
        </p>
      </div>

      <Card>
        <CardHeader
          title="Queue override"
          subtitle="Records an audited break-glass request. This does not build, run, or dispatch the AR queue — dispatch runs automatically on its own schedule — and practice owners are not notified."
        />
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Reason (required)
            </span>
            <textarea
              className="mt-1.5 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-crx-500 focus:border-crx-500"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe why this break-glass action is needed…"
            />
          </label>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
          )}
          {message && (
            <p className="text-sm text-crx-600 dark:text-crx-400" role="status">{message}</p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void submit('build')}
            >
              {busy === 'build' ? 'Logging…' : 'Build queue'}
            </Button>
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() => void submit('run')}
            >
              {busy === 'run' ? 'Logging…' : 'Run queue'}
            </Button>
          </div>
        </div>
      </Card>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        These actions POST to <code className="font-mono">/api/admin/queue/build</code> and{' '}
        <code className="font-mono">/api/admin/queue/run</code>. Each request is recorded in the break-glass audit log.
      </p>
    </div>
  )
}
