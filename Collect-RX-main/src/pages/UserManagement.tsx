import { useEffect, useState } from 'react'
import { apiFetchJson } from '../lib/apiFetch'
import {
  Card, CardHeader, DataState, Button, Input, Select,
  TableContainer, Table, Thead, Tbody, Tr, Th, Td, Badge,
} from '../components/ui'
import { USER_ROLE_LABELS, type UserRole } from '../types/userRole'

type PlatformUser = {
  id: string
  email: string
  userRole: UserRole
  practiceId: string | null
  active: boolean
  createdAt: string
}

const ROLE_OPTIONS: UserRole[] = [
  'front_desk',
  'practice_owner',
  'auditor',
  'billing_ops_manager',
  'platform_admin',
]

export default function UserManagement() {
  const [users, setUsers] = useState<PlatformUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [userRole, setUserRole] = useState<UserRole>('practice_owner')
  const [practiceId, setPracticeIdField] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetchJson<{ success: boolean; data: PlatformUser[] }>('/api/admin/users')
      setUsers(res.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      await apiFetchJson('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          userRole,
          practiceId: practiceId.trim() || undefined,
        }),
      })
      setEmail('')
      setPassword('')
      setPracticeIdField('')
      setMessage('User created')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function deactivate(id: string) {
    if (!confirm('Deactivate this user?')) return
    setBusy(true)
    setError(null)
    try {
      await apiFetchJson(`/api/admin/users/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DataState loading={loading && users.length === 0} error={error}>
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">User Management</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            Platform user accounts and roles
          </p>
        </div>

        {message && <p className="text-xs text-crx-600 dark:text-crx-400" role="status">{message}</p>}

        <Card>
          <CardHeader title="Create user" />
          <form onSubmit={(e) => void createUser(e)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Select
              label="Role"
              value={userRole}
              onChange={(e) => setUserRole(e.target.value as UserRole)}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{USER_ROLE_LABELS[r]}</option>
              ))}
            </Select>
            <Input
              label="Practice ID (optional)"
              value={practiceId}
              onChange={(e) => setPracticeIdField(e.target.value)}
              placeholder="Required for practice-scoped roles"
            />
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" variant="primary" size="sm" disabled={busy}>
                {busy ? 'Creating…' : 'Create user'}
              </Button>
            </div>
          </form>
        </Card>

        <Card padding="none">
          <div className="p-5 pb-0">
            <CardHeader title="Users" subtitle={`${users.length} accounts`} />
          </div>
          <TableContainer className="border-0 shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Practice</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {users.map((u) => (
                  <Tr key={u.id}>
                    <Td bold>{u.email}</Td>
                    <Td>{USER_ROLE_LABELS[u.userRole]}</Td>
                    <Td muted>{u.practiceId ?? '—'}</Td>
                    <Td>
                      <Badge color={u.active ? 'green' : 'gray'}>
                        {u.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                    <Td muted>{new Date(u.createdAt).toLocaleDateString('en-CA')}</Td>
                    <Td>
                      {u.active && (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void deactivate(u.id)}>
                          Deactivate
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
        </Card>
      </div>
    </DataState>
  )
}
