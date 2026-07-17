import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetchJson } from '../lib/apiFetch'
import {
  Card, CardHeader, Badge, DataState,
  TableContainer, Table, Thead, Tbody, Tr, Th, Td,
} from '../components/ui'

type AdminPractice = {
  id: string
  name: string
  voiceAgentEnabled: boolean
  openEscalations: number
  lastCallAt: string | null
  billingTier: string
  tierName: string
  subscriptionStatus: string | null
  callsPaused: boolean
  callsPausedReason: string | null
  minutesConsumed: number
  minutesIncluded: number
  minutesRemaining: number
}

export default function AdminPractices() {
  const [practices, setPractices] = useState<AdminPractice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiFetchJson<{ success: boolean; data: AdminPractice[] }>('/api/admin/practices')
      .then((res) => setPractices(res.data))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <DataState loading={loading} error={error} isEmpty={!loading && practices.length === 0} emptyTitle="No practices">
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Platform Admin</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            All practices, voice agent status and activity
          </p>
        </div>

        <Card padding="none">
          <div className="p-5 pb-0">
            <CardHeader title="Practices" subtitle={`${practices.length} registered`} />
          </div>
          <TableContainer className="border-0 shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>Practice</Th>
                  <Th>Voice agent</Th>
                  <Th>Plan</Th>
                  <Th align="right">Minutes used</Th>
                  <Th>Calling</Th>
                  <Th align="right">Open escalations</Th>
                  <Th>Last call</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {practices.map((p) => (
                  <Tr key={p.id}>
                    <Td bold>{p.name}</Td>
                    <Td>
                      <Badge color={p.voiceAgentEnabled ? 'green' : 'gray'}>
                        {p.voiceAgentEnabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="text-sm">{p.tierName}</span>
                      {p.subscriptionStatus && p.subscriptionStatus !== 'active' && (
                        <span className="block text-2xs text-gray-400">{p.subscriptionStatus}</span>
                      )}
                    </Td>
                    <Td align="right">
                      {p.minutesConsumed} / {p.minutesIncluded}
                      <span className="block text-2xs text-gray-400">{p.minutesRemaining} left</span>
                    </Td>
                    <Td>
                      <Badge color={p.callsPaused ? 'red' : 'green'}>
                        {p.callsPaused ? `Paused${p.callsPausedReason ? ` — ${p.callsPausedReason}` : ''}` : 'Active'}
                      </Badge>
                    </Td>
                    <Td align="right">{p.openEscalations}</Td>
                    <Td muted>
                      {p.lastCallAt
                        ? new Date(p.lastCallAt).toLocaleString('en-CA')
                        : 'Never'}
                    </Td>
                    <Td>
                      <Link to={`/admin/health?practice=${p.id}`} className="text-xs text-crx-600 hover:underline dark:text-crx-400">
                        View health
                      </Link>
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
