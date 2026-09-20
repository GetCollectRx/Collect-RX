import { useState, useEffect, useCallback } from 'react'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { PlanPicker } from './PracticeBillingPage'
import { ROLE_LABELS, type PracticeRole } from '../lib/authTypes'

interface PracticeSummary {
  id: string
  name: string
  subscriptionStatus: string | null
  totalClaims: number
  resolvedClaims: number
  resolutionRate: number
  outstandingAR: number
  activeUsers: number
}

interface OrgMember {
  userId: string
  role: 'org_admin' | 'org_member'
  email: string
  displayName: string
  isActive: boolean
  joinedAt: string
}

const INVITABLE_ROLES: PracticeRole[] = [
  'group_admin', 'office_manager', 'billing_coordinator', 'front_desk', 'associate_dentist', 'accountant',
]

interface GroupBillingStatus {
  organization: {
    id: string
    name: string
    billed: boolean
    subscriptionStatus: string | null
    billingTier: string | null
    cogsPoolingEnabled: boolean
    callsPaused: boolean
    callsPausedReason: string | null
    subscriptionCurrentPeriodEnd: string | null
  }
  pooledUsage: {
    practiceCount: number
    minutesConsumed: number
    callsCompleted: number
  }
}

export default function GroupDashboard() {
  const [practices, setPractices] = useState<PracticeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [billing, setBilling] = useState<GroupBillingStatus | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [billingBusy, setBillingBusy] = useState(false)

  const [inviteForm, setInviteForm] = useState({ email: '', role: 'group_admin' as PracticeRole, practiceId: '', providerId: '' })
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSent, setInviteSent] = useState<{ email: string; emailSent: boolean; link?: string } | null>(null)

  const [newLocationName, setNewLocationName] = useState('')
  const [locationBusy, setLocationBusy] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)

  const [members, setMembers] = useState<OrgMember[]>([])
  const [membersError, setMembersError] = useState<string | null>(null)
  const [memberBusy, setMemberBusy] = useState<string | null>(null)

  const loadPractices = useCallback(() => {
    apiFetchJson<{ practices: PracticeSummary[] }>('/api/group/practices-summary')
      .then(d => setPractices(d.practices))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const loadMembers = useCallback(() => {
    apiFetchJson<{ members: OrgMember[] }>('/api/group/members')
      .then(d => setMembers(d.members))
      // 403 here just means the caller isn't an org_admin — same as billing below.
      .catch(() => setMembers([]))
  }, [])

  useEffect(() => {
    loadPractices()
    loadMembers()

    // 403 here just means the caller isn't an org_admin (e.g. a read-only
    // org_member) — not every group_admin session owns the billing relationship.
    apiFetchJson<GroupBillingStatus>('/api/group/billing')
      .then(d => setBilling(d))
      .catch(() => setBilling(null))
  }, [loadPractices, loadMembers])

  async function startOrgCheckout(planId: string) {
    setBillingError(null)
    setBillingBusy(true)
    try {
      const data = await apiFetchJson<{ url: string }>(resolveApiUrl('/api/group/billing/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      })
      window.location.href = data.url
    } catch (e) {
      setBillingError((e as Error).message)
      setBillingBusy(false)
    }
  }

  async function openOrgBillingPortal() {
    setBillingError(null)
    setBillingBusy(true)
    try {
      const data = await apiFetchJson<{ url: string }>(resolveApiUrl('/api/group/billing/portal'), { method: 'POST' })
      window.location.href = data.url
    } catch (e) {
      setBillingError((e as Error).message)
      setBillingBusy(false)
    }
  }

  async function toggleCogsPooling() {
    if (!billing) return
    const nextEnabled = !billing.organization.cogsPoolingEnabled
    setBillingError(null)
    setBillingBusy(true)
    try {
      const data = await apiFetchJson<{ cogsPoolingEnabled: boolean }>(resolveApiUrl('/api/group/billing/cogs-pooling'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      setBilling(prev => prev ? { ...prev, organization: { ...prev.organization, cogsPoolingEnabled: data.cogsPoolingEnabled } } : prev)
    } catch (e) {
      setBillingError((e as Error).message)
    } finally {
      setBillingBusy(false)
    }
  }

  async function confirmOrgOverage() {
    setBillingError(null)
    setBillingBusy(true)
    try {
      await apiFetchJson(resolveApiUrl('/api/group/billing/confirm-overage'), { method: 'POST' })
      const data = await apiFetchJson<GroupBillingStatus>(resolveApiUrl('/api/group/billing'))
      setBilling(data)
    } catch (e) {
      setBillingError((e as Error).message)
    } finally {
      setBillingBusy(false)
    }
  }

  async function inviteTeammate(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)
    setInviteBusy(true)
    try {
      const isCoAdmin = inviteForm.role === 'group_admin'
      if (inviteForm.role === 'associate_dentist' && !inviteForm.providerId.trim()) {
        setInviteError('Provider ID is required for an associate dentist')
        return
      }
      const res = await apiFetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteForm.email,
          role: inviteForm.role,
          ...(isCoAdmin ? {} : { practiceId: inviteForm.practiceId || practices[0]?.id }),
          ...(inviteForm.role === 'associate_dentist' ? { providerId: inviteForm.providerId.trim() } : {}),
        }),
      })
      const body = await res.json() as { error?: string; emailSent?: boolean; token?: string }
      if (!res.ok) { setInviteError(body.error ?? 'Failed to send invite'); return }
      setInviteSent({
        email: inviteForm.email,
        emailSent: Boolean(body.emailSent),
        link: body.token ? `${window.location.origin}/accept-invite?token=${body.token}` : undefined,
      })
      setInviteForm(f => ({ ...f, email: '', providerId: '' }))
    } catch (e) {
      setInviteError((e as Error).message)
    } finally {
      setInviteBusy(false)
    }
  }

  async function addLocation(e: React.FormEvent) {
    e.preventDefault()
    setLocationError(null)
    setLocationBusy(true)
    try {
      const res = await apiFetch('/api/group/practices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ practiceName: newLocationName }),
      })
      const body = await res.json() as { error?: string }
      if (!res.ok) { setLocationError(body.error ?? 'Failed to add location'); return }
      setNewLocationName('')
      loadPractices()
    } catch (e) {
      setLocationError((e as Error).message)
    } finally {
      setLocationBusy(false)
    }
  }

  async function updateMemberRole(userId: string, role: OrgMember['role']) {
    setMembersError(null)
    setMemberBusy(userId)
    try {
      const res = await apiFetch(`/api/group/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const body = await res.json() as { error?: string }
      if (!res.ok) { setMembersError(body.error ?? 'Failed to update member'); return }
      loadMembers()
    } catch (e) {
      setMembersError((e as Error).message)
    } finally {
      setMemberBusy(null)
    }
  }

  async function removeMember(userId: string, displayName: string) {
    if (!window.confirm(`Remove ${displayName} from this organization?`)) return
    setMembersError(null)
    setMemberBusy(userId)
    try {
      const res = await apiFetch(`/api/group/members/${userId}`, { method: 'DELETE' })
      const body = await res.json() as { error?: string }
      if (!res.ok) { setMembersError(body.error ?? 'Failed to remove member'); return }
      loadMembers()
    } catch (e) {
      setMembersError((e as Error).message)
    } finally {
      setMemberBusy(null)
    }
  }

  const totalOutstandingAR = practices.reduce((s, p) => s + p.outstandingAR, 0)
  const totalClaims = practices.reduce((s, p) => s + p.totalClaims, 0)
  const avgResolutionRate = practices.length
    ? Math.round(practices.reduce((s, p) => s + p.resolutionRate, 0) / practices.length)
    : 0

  function statusBadge(status: string | null) {
    if (status === 'active') return 'text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/20'
    if (status === 'trialing') return 'text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20'
    if (status === 'past_due') return 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20'
    return 'text-gray-500 bg-gray-100 dark:bg-gray-800'
  }

  return (
    <div className="page-enter p-6 space-y-6 max-w-[1200px]">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Group overview</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Aggregate performance across all practice locations.</p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {billing && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 px-5 py-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-2xs text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium">Organization billing</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                {billing.organization.billed
                  ? `Billed centrally to ${billing.organization.name} — ${billing.organization.subscriptionStatus ?? 'no active subscription'}${billing.organization.billingTier ? ` (${billing.organization.billingTier})` : ''}`
                  : `${billing.organization.name} is not on consolidated billing yet — each location bills individually.`}
              </p>
              {billing.organization.callsPaused && (
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Calls paused across the organization — {billing.organization.callsPausedReason ?? 'unknown reason'}.
                  </p>
                  {billing.organization.callsPausedReason === 'overage_pending' && (
                    <button
                      type="button"
                      onClick={() => void confirmOrgOverage()}
                      disabled={billingBusy}
                      className="text-2xs font-medium px-2 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      Confirm overage charges and resume calling
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Pooled usage this cycle: {billing.pooledUsage.minutesConsumed.toLocaleString()} min across{' '}
                {billing.pooledUsage.practiceCount} location{billing.pooledUsage.practiceCount === 1 ? '' : 's'} ({billing.pooledUsage.callsCompleted.toLocaleString()} calls)
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {billing.organization.cogsPoolingEnabled
                    ? 'Usage is pooled across all locations.'
                    : 'Pooling is off — each location has its own minute cap.'}
                </span>
                <button
                  type="button"
                  onClick={toggleCogsPooling}
                  disabled={billingBusy}
                  className="text-2xs font-medium px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  {billing.organization.cogsPoolingEnabled ? 'Turn off pooling' : 'Turn on pooling'}
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              {billing.organization.billed && (
                <button
                  type="button"
                  onClick={openOrgBillingPortal}
                  disabled={billingBusy}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  Manage billing
                </button>
              )}
            </div>
          </div>
          {billingError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{billingError}</p>}
          {!billing.organization.billed && (
            <div className="mt-4">
              <PlanPicker currentTier={null} busy={billingBusy} onSelect={(planId) => void startOrgCheckout(planId)} />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 px-5 py-4">
          <p className="text-2xs text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium">Invite a teammate</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Co-admins see every location in this organization; other roles are scoped to one location.
          </p>
          <form onSubmit={inviteTeammate} className="flex flex-col gap-2 mt-3">
            <input
              type="email"
              required
              placeholder="colleague@yourorg.ca"
              value={inviteForm.email}
              onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={inviteForm.role}
                onChange={e => setInviteForm(f => ({ ...f, role: e.target.value as PracticeRole }))}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                {INVITABLE_ROLES.map(r => (
                  <option key={r} value={r}>{r === 'group_admin' ? 'Co-admin (all locations)' : ROLE_LABELS[r]}</option>
                ))}
              </select>
              {inviteForm.role !== 'group_admin' && (
                <select
                  value={inviteForm.practiceId || practices[0]?.id || ''}
                  onChange={e => setInviteForm(f => ({ ...f, practiceId: e.target.value }))}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  {practices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {inviteForm.role === 'associate_dentist' && (
                <input
                  type="text"
                  required
                  placeholder="Provider ID"
                  value={inviteForm.providerId}
                  onChange={e => setInviteForm(f => ({ ...f, providerId: e.target.value }))}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 w-32"
                />
              )}
              <button
                type="submit"
                disabled={inviteBusy}
                className="text-sm font-medium px-3 py-1.5 rounded-lg bg-crx-500 text-white hover:bg-crx-600 disabled:opacity-50"
              >
                {inviteBusy ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          </form>
          {inviteError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{inviteError}</p>}
          {inviteSent && inviteSent.emailSent && (
            <p className="text-sm text-green-700 dark:text-green-400 mt-2">
              Invite sent to <strong>{inviteSent.email}</strong>.
            </p>
          )}
          {inviteSent && !inviteSent.emailSent && (
            <div className="text-sm text-amber-700 dark:text-amber-400 mt-2">
              <p>Invite created for <strong>{inviteSent.email}</strong>, but the email couldn't be sent. Share this link with them directly:</p>
              {inviteSent.link && <p className="mt-1 break-all font-mono text-xs">{inviteSent.link}</p>}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 px-5 py-4">
          <p className="text-2xs text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium">Add a location</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Opening a new location? Add it to this organization.
          </p>
          <form onSubmit={addLocation} className="flex items-center gap-2 mt-3 flex-wrap">
            <input
              type="text"
              required
              placeholder="New location name"
              value={newLocationName}
              onChange={e => setNewLocationName(e.target.value)}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex-1 min-w-[220px]"
            />
            <button
              type="submit"
              disabled={locationBusy}
              className="text-sm font-medium px-3 py-1.5 rounded-lg bg-crx-500 text-white hover:bg-crx-600 disabled:opacity-50"
            >
              {locationBusy ? 'Adding…' : 'Add location'}
            </button>
          </form>
          {locationError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{locationError}</p>}
        </div>
      </div>

      {members.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
            <p className="text-2xs text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium">Organization members</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                {['Name', 'Email', 'Role', ''].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-2xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.userId} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{m.displayName}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{m.email}</td>
                  <td className="px-4 py-2">
                    <select
                      value={m.role}
                      disabled={memberBusy === m.userId}
                      onChange={e => updateMemberRole(m.userId, e.target.value as OrgMember['role'])}
                      className="text-2xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    >
                      <option value="org_admin">Admin</option>
                      <option value="org_member">Member (read-only)</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      disabled={memberBusy === m.userId}
                      onClick={() => removeMember(m.userId, m.displayName)}
                      className="text-2xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {membersError && <p className="text-sm text-red-600 dark:text-red-400 px-4 py-2">{membersError}</p>}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Locations',           value: practices.length.toString() },
              { label: 'Total claims',         value: totalClaims.toLocaleString() },
              { label: 'Avg resolution rate',  value: `${avgResolutionRate}%` },
              { label: 'Outstanding AR',       value: `$${totalOutstandingAR.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
            ].map(t => (
              <div key={t.label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 px-4 py-4">
                <p className="text-2xs text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium">{t.label}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{t.value}</p>
              </div>
            ))}
          </div>

          {/* Per-practice table */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  {['Practice', 'Status', 'Claims', 'Resolution', 'Outstanding AR', 'Active staff'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-2xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {practices.map((p, i) => (
                  <tr key={p.id} className={i < practices.length - 1 ? 'border-b border-gray-50 dark:border-gray-800/50' : ''}>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{p.name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-2xs font-medium px-1.5 py-0.5 rounded-full ${statusBadge(p.subscriptionStatus)}`}>
                        {p.subscriptionStatus ?? 'no plan'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{p.totalClaims.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-crx-500"
                            style={{ width: `${p.resolutionRate}%` }}
                          />
                        </div>
                        <span className="text-gray-700 dark:text-gray-300">{p.resolutionRate}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      ${p.outstandingAR.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{p.activeUsers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {practices.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No practice data available.</p>
            )}
          </div>
        </>
      )}

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
    </div>
  )
}
