import { useState, useEffect, useCallback } from 'react'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { ROLE_LABELS } from '../lib/authTypes'
import type { PracticeRole } from '../lib/authTypes'
import { usePractice } from '../context/PracticeContext'

interface StaffUser {
  id: string
  email: string
  displayName: string
  role: PracticeRole
  isActive: boolean
  tokenExpiresAt?: string | null
  createdAt: string
}

const MANAGEABLE_ROLES: PracticeRole[] = [
  'office_manager', 'billing_coordinator', 'front_desk', 'associate_dentist', 'accountant',
]

export default function UsersAdmin() {
  const { sessionUser } = usePractice()
  const [users, setUsers] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ email: '', displayName: '', role: 'billing_coordinator' as PracticeRole, password: '', providerId: '' })

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await apiFetchJson<{ users: StaffUser[] }>('/api/auth/users')
      setUsers(data.users)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleDeactivate(id: string, name: string) {
    if (!window.confirm(`Deactivate ${name}? They will not be able to log in.`)) return
    setBusy(id)
    try {
      const res = await apiFetch(`/api/auth/users/${id}`, { method: 'DELETE' })
      if (!res.ok) { const b = await res.json() as { error?: string }; throw new Error(b.error ?? 'Failed') }
      await load()
    } catch (e) { alert((e as Error).message) }
    finally { setBusy(null) }
  }

  async function handleRenewAccountant(id: string) {
    setBusy(id)
    const newExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    try {
      const res = await apiFetch(`/api/auth/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenExpiresAt: newExpiry }),
      })
      if (!res.ok) { const b = await res.json() as { error?: string }; throw new Error(b.error ?? 'Failed') }
      await load()
    } catch (e) { alert((e as Error).message) }
    finally { setBusy(null) }
  }

  async function handleReactivate(id: string) {
    setBusy(id)
    try {
      const res = await apiFetch(`/api/auth/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      })
      if (!res.ok) { const b = await res.json() as { error?: string }; throw new Error(b.error ?? 'Failed') }
      await load()
    } catch (e) { alert((e as Error).message) }
    finally { setBusy(null) }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (form.password.length < 8) { setFormError('Password must be at least 8 characters'); return }
    setBusy('new')
    try {
      const res = await apiFetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          providerId: form.role === 'associate_dentist' ? form.providerId : undefined,
        }),
      })
      const body = await res.json() as { error?: string }
      if (!res.ok) { setFormError(body.error ?? 'Failed to create user'); return }
      setShowAdd(false)
      setForm({ email: '', displayName: '', role: 'billing_coordinator', password: '' })
      await load()
    } catch (e) { setFormError((e as Error).message) }
    finally { setBusy(null) }
  }

  const activeUsers  = users.filter(u => u.isActive)
  const inactiveUsers = users.filter(u => !u.isActive)

  return (
    <div className="page-enter p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Staff accounts</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Manage who can access CollectRx at this practice.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-crx-500 hover:bg-crx-600 text-white transition-colors"
        >
          + Add staff
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <>
          <div className="space-y-2">
            {activeUsers.map(u => (
              <div key={u.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {u.displayName}
                    {u.id === sessionUser?.id && (
                      <span className="ml-2 text-2xs text-crx-500 font-normal">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{u.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                    {ROLE_LABELS[u.role] ?? u.role}
                  </span>
                  {u.role === 'accountant' && u.tokenExpiresAt && (
                    <span className={`text-2xs px-1.5 py-0.5 rounded-full font-medium ${new Date(u.tokenExpiresAt) < new Date() ? 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-900/20' : new Date(u.tokenExpiresAt) < new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) ? 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20' : 'text-gray-400 bg-gray-100 dark:bg-gray-800'}`}>
                      {new Date(u.tokenExpiresAt) < new Date() ? 'Expired' : `Expires ${new Date(u.tokenExpiresAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`}
                    </span>
                  )}
                  {u.role === 'accountant' && (
                    <button
                      onClick={() => void handleRenewAccountant(u.id)}
                      disabled={busy === u.id}
                      className="text-xs text-crx-500 hover:text-crx-600 dark:hover:text-crx-400 disabled:opacity-50 transition-colors"
                    >
                      {busy === u.id ? '…' : 'Renew 90d'}
                    </button>
                  )}
                  {u.id !== sessionUser?.id && (
                    <button
                      onClick={() => void handleDeactivate(u.id, u.displayName)}
                      disabled={busy === u.id}
                      className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
                    >
                      {busy === u.id ? '…' : 'Deactivate'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {inactiveUsers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-600 uppercase tracking-wider">Inactive</p>
              {inactiveUsers.map(u => (
                <div key={u.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-800 px-4 py-3 opacity-60">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-400">{u.displayName}</p>
                    <p className="text-xs text-gray-400">{u.email}</p>
                  </div>
                  <button
                    onClick={() => void handleReactivate(u.id)}
                    disabled={busy === u.id}
                    className="text-xs text-crx-500 hover:text-crx-600 disabled:opacity-50 transition-colors"
                  >
                    {busy === u.id ? '…' : 'Reactivate'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Add staff modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Add staff member</h2>
              <button onClick={() => { setShowAdd(false); setFormError(null) }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <form onSubmit={handleAddUser} className="space-y-4">
              {[
                { id: 'au-name',  label: 'Display name', value: form.displayName, key: 'displayName' as const, type: 'text' },
                { id: 'au-email', label: 'Email (login)', value: form.email,       key: 'email'       as const, type: 'email' },
                { id: 'au-pw',    label: 'Temporary password', value: form.password, key: 'password' as const, type: 'password' },
              ].map(f => (
                <div key={f.id}>
                  <label htmlFor={f.id} className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{f.label}</label>
                  <input
                    id={f.id} type={f.type} required value={f.value}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-crx-500/30 focus:border-crx-500 transition-colors"
                  />
                </div>
              ))}
              <div>
                <label htmlFor="au-role" className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Role</label>
                <select
                  id="au-role"
                  value={form.role}
                  onChange={e => setForm(p => ({ ...p, role: e.target.value as PracticeRole }))}
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-crx-500/30 focus:border-crx-500 transition-colors"
                >
                  {MANAGEABLE_ROLES.map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              {form.role === 'associate_dentist' && (
                <div>
                  <label htmlFor="au-provider" className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                    Provider ID <span className="text-gray-400 font-normal normal-case">(from AbelDent)</span>
                  </label>
                  <input
                    id="au-provider" type="text" required value={form.providerId}
                    onChange={e => setForm(p => ({ ...p, providerId: e.target.value }))}
                    placeholder="e.g. DR001"
                    className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-crx-500/30 focus:border-crx-500 transition-colors"
                  />
                </div>
              )}
              {formError && (
                <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">{formError}</p>
              )}
              <button
                type="submit" disabled={busy === 'new'}
                className="w-full py-2.5 text-sm font-semibold rounded-lg bg-crx-500 hover:bg-crx-600 text-white disabled:opacity-50 transition-colors"
              >
                {busy === 'new' ? 'Creating…' : 'Create account'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
