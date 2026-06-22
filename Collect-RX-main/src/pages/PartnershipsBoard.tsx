import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import {
  Badge, Button, Card, CardHeader, DataState, Input, Select,
  Table, TableContainer, Tbody, Td, Th, Thead, Tr, TableEmpty,
} from '../components/ui'
import { STAGE_LABELS, KANBAN_ACTIVE_STAGES, KANBAN_CLOSED_STAGES, type ProspectListItem, type PipelineColumn } from '../types/partnerships'

type Stats = { total: number; byStage: Record<string, number> }

const STAGES = Object.keys(STAGE_LABELS) as (keyof typeof STAGE_LABELS)[]

const emptyManual = {
  practiceName: '',
  contactName: '',
  email: '',
  phone: '',
  city: '',
  province: 'ON',
}

export default function PartnershipsBoard() {
  const [prospects, setProspects] = useState<ProspectListItem[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [stageFilter, setStageFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [harvestQuery, setHarvestQuery] = useState('dental practice')
  const [harvestCity, setHarvestCity] = useState('')
  const [harvestBusy, setHarvestBusy] = useState(false)
  const [harvestMsg, setHarvestMsg] = useState<string | null>(null)
  const [manual, setManual] = useState(emptyManual)
  const [manualBusy, setManualBusy] = useState(false)
  const [manualMsg, setManualMsg] = useState<string | null>(null)
  const [tickBusy, setTickBusy] = useState(false)
  const [tickMsg, setTickMsg] = useState<string | null>(null)
  const [view, setView] = useState<'table' | 'kanban'>('kanban')
  const [pipeline, setPipeline] = useState<PipelineColumn[]>([])
  const [learningMsg, setLearningMsg] = useState<string | null>(null)
  const [learningBusy, setLearningBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const q = stageFilter ? `?stage=${stageFilter}` : ''
    const loads: Promise<void>[] = [
      apiFetchJson<{ success: boolean; data: ProspectListItem[] }>(`/api/admin/partnerships/prospects${q}`)
        .then((list) => setProspects(list.data)),
      apiFetchJson<{ success: boolean; data: Stats }>('/api/admin/partnerships/stats')
        .then((st) => setStats(st.data)),
    ]
    if (view === 'kanban') {
      loads.push(
        apiFetchJson<{ success: boolean; data: { pipeline: PipelineColumn[] } }>('/api/admin/partnerships/pipeline')
          .then((p) => setPipeline(p.data.pipeline)),
      )
    }
    Promise.all(loads)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [stageFilter, view])

  useEffect(() => { load() }, [load])

  const runHarvest = async () => {
    setHarvestBusy(true)
    setHarvestMsg(null)
    try {
      const res = await apiFetch('/api/admin/partnerships/prospects/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: harvestQuery,
          city: harvestCity.trim() || undefined,
          limit: 20,
        }),
      })
      const body = await res.json() as { data?: { imported: number; skipped: number; errors?: string[] }; error?: string }
      if (!res.ok) throw new Error(body.error || 'Harvest failed')
      setHarvestMsg(
        `Imported ${body.data?.imported ?? 0}, skipped ${body.data?.skipped ?? 0}` +
          (body.data?.errors?.length ? `. ${body.data.errors[0]}` : ''),
      )
      load()
    } catch (e) {
      setHarvestMsg((e as Error).message)
    } finally {
      setHarvestBusy(false)
    }
  }

  const addManual = async () => {
    if (!manual.practiceName.trim()) {
      setManualMsg('Practice name is required')
      return
    }
    setManualBusy(true)
    setManualMsg(null)
    try {
      const res = await apiFetch('/api/admin/partnerships/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practiceName: manual.practiceName.trim(),
          contactName: manual.contactName.trim() || undefined,
          email: manual.email.trim() || undefined,
          phone: manual.phone.trim() || undefined,
          city: manual.city.trim() || undefined,
          province: manual.province.trim() || undefined,
        }),
      })
      const body = await res.json() as { error?: string; data?: { id: string } }
      if (!res.ok) throw new Error(body.error || 'Add failed')
      setManual(emptyManual)
      setManualMsg(`Added ${manual.practiceName.trim()}`)
      load()
    } catch (e) {
      setManualMsg((e as Error).message)
    } finally {
      setManualBusy(false)
    }
  }

  const runSequenceTick = async () => {
    setTickBusy(true)
    setTickMsg(null)
    try {
      const res = await apiFetch('/api/admin/partnerships/sequence/tick', { method: 'POST' })
      const body = await res.json() as { data?: { coldEmailsSent: number; referralEmailsSent: number }; error?: string }
      if (!res.ok) throw new Error(body.error || 'Tick failed')
      setTickMsg(
        `Sent ${body.data?.coldEmailsSent ?? 0} cadence emails, ${body.data?.referralEmailsSent ?? 0} referral emails`,
      )
      load()
    } catch (e) {
      setTickMsg((e as Error).message)
    } finally {
      setTickBusy(false)
    }
  }

  const runLearning = async () => {
    setLearningBusy(true)
    setLearningMsg(null)
    try {
      const res = await apiFetch('/api/admin/partnerships/learning/run', { method: 'POST' })
      const body = await res.json() as {
        data?: { skipped?: boolean; reason?: string; prospectsRescored?: number; adjustments?: unknown[] }
        error?: string
      }
      if (!res.ok) throw new Error(body.error || 'Learning run failed')
      if (body.data?.skipped) {
        setLearningMsg(body.data.reason || 'Skipped (not enough closed outcomes yet)')
      } else {
        setLearningMsg(
          `Rescored ${body.data?.prospectsRescored ?? 0} prospects · ${body.data?.adjustments?.length ?? 0} weight tweaks`,
        )
      }
      load()
    } catch (e) {
      setLearningMsg((e as Error).message)
    } finally {
      setLearningBusy(false)
    }
  }

  const pipelineByStage = Object.fromEntries(pipeline.map((col) => [col.stage, col])) as Record<string, PipelineColumn>

  return (
    <DataState loading={loading} error={error}>
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="page-title">Practice partnerships</h1>
            <p className="page-subtitle">
              Outbound pipeline: harvest, email cadence, calls, and referrals
              {stats ? ` · ${stats.total} prospects` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={view === 'kanban' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setView('kanban')}
            >
              Kanban
            </Button>
            <Button
              variant={view === 'table' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setView('table')}
            >
              Table
            </Button>
            <Button variant="ghost" size="sm" disabled={learningBusy} onClick={() => void runLearning()}>
              {learningBusy ? 'Learning…' : 'Run score learning'}
            </Button>
            <Button variant="ghost" size="sm" disabled={tickBusy} onClick={() => void runSequenceTick()}>
              {tickBusy ? 'Running…' : 'Run cadence tick'}
            </Button>
            <Link to="/admin"><Button variant="ghost" size="sm">← Platform admin</Button></Link>
          </div>
        </div>
        {tickMsg && <p className="text-sm text-gray-600 dark:text-gray-400">{tickMsg}</p>}
        {learningMsg && <p className="text-sm text-gray-600 dark:text-gray-400">{learningMsg}</p>}

        <Card>
          <CardHeader title="Add prospect manually" subtitle="For referrals, inbound leads, or one-off targets" />
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Practice name *" value={manual.practiceName} onChange={(e) => setManual({ ...manual, practiceName: e.target.value })} />
            <Input label="Contact name" value={manual.contactName} onChange={(e) => setManual({ ...manual, contactName: e.target.value })} />
            <Input label="Email" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} />
            <Input label="Phone" value={manual.phone} onChange={(e) => setManual({ ...manual, phone: e.target.value })} />
            <Input label="City" value={manual.city} onChange={(e) => setManual({ ...manual, city: e.target.value })} />
            <Input label="Province" value={manual.province} onChange={(e) => setManual({ ...manual, province: e.target.value })} />
          </div>
          <div className="px-4 pb-4 flex flex-wrap gap-3 items-center">
            <Button onClick={() => void addManual()} disabled={manualBusy}>
              {manualBusy ? 'Adding…' : 'Add prospect'}
            </Button>
            {manualMsg && <p className="text-sm text-gray-600 dark:text-gray-400">{manualMsg}</p>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Prospect harvester" subtitle="Google Places · requires GOOGLE_PLACES_API_KEY" />
          <div className="flex flex-wrap gap-3 items-end px-4 pb-4">
            <Input label="Search" value={harvestQuery} onChange={(e) => setHarvestQuery(e.target.value)} />
            <Input label="City (optional)" value={harvestCity} onChange={(e) => setHarvestCity(e.target.value)} placeholder="e.g. Calgary" />
            <Button onClick={() => void runHarvest()} disabled={harvestBusy}>
              {harvestBusy ? 'Harvesting…' : 'Harvest leads'}
            </Button>
          </div>
          {harvestMsg && <p className="px-4 pb-4 text-sm text-gray-600 dark:text-gray-400">{harvestMsg}</p>}
        </Card>

        <div className="flex flex-wrap gap-3 items-center">
          <Select label="Stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </Select>
          <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
        </div>

        {view === 'kanban' ? (
          <div className="space-y-6">
            <div className="overflow-x-auto pb-2">
              <div className="flex gap-3 min-w-max">
                {KANBAN_ACTIVE_STAGES.map((stage) => {
                  const col = pipelineByStage[stage]
                  return (
                    <div
                      key={stage}
                      className="w-64 shrink-0 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700"
                    >
                      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          {STAGE_LABELS[stage]}
                        </span>
                        <Badge>{col?.count ?? 0}</Badge>
                      </div>
                      <div className="p-2 space-y-2 max-h-[480px] overflow-y-auto">
                        {(col?.prospects ?? []).map((p) => (
                          <Link
                            key={p.id}
                            to={`/admin/partnerships/${p.id}`}
                            className="block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:border-crx-400 dark:hover:border-crx-500 transition-colors"
                          >
                            <div className="flex justify-between gap-2">
                              <span className="text-sm font-medium line-clamp-2">{p.practiceName}</span>
                              <span className="text-xs text-gray-500 shrink-0">{p.score}</span>
                            </div>
                            {(p.city || p.province) && (
                              <p className="text-xs text-gray-500 mt-1">
                                {[p.city, p.province].filter(Boolean).join(', ')}
                              </p>
                            )}
                          </Link>
                        ))}
                        {!col?.prospects?.length && (
                          <p className="text-xs text-gray-400 text-center py-4">Empty</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {KANBAN_CLOSED_STAGES.map((stage) => {
                const col = pipelineByStage[stage]
                return (
                  <div
                    key={stage}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                  >
                    <span className="text-gray-600 dark:text-gray-400">{STAGE_LABELS[stage]}</span>
                    <Badge>{col?.count ?? 0}</Badge>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
        <TableContainer>
          <Table>
            <Thead>
              <Tr>
                <Th>Practice</Th>
                <Th>Contact</Th>
                <Th>Score</Th>
                <Th>Stage</Th>
                <Th>Last activity</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {prospects.length === 0 ? (
                <TableEmpty colSpan={6} message="No prospects yet. Harvest or add manually." />
              ) : (
                prospects.map((p) => (
                  <Tr key={p.id}>
                    <Td bold>
                      <div>{p.practiceName}</div>
                      {p.city && <div className="text-xs text-gray-500">{p.city}</div>}
                    </Td>
                    <Td>
                      <div className="text-sm">{p.email || 'none'}</div>
                      <div className="text-xs text-gray-500">{p.phone || ''}</div>
                    </Td>
                    <Td>{p.score}</Td>
                    <Td><Badge>{STAGE_LABELS[p.stage]}</Badge></Td>
                    <Td muted className="text-xs">
                      {p.lastEngagedAt
                        ? new Date(p.lastEngagedAt).toLocaleString('en-CA')
                        : p.lastEmailSentAt
                          ? `Emailed ${new Date(p.lastEmailSentAt).toLocaleDateString('en-CA')}`
                          : 'none'}
                    </Td>
                    <Td>
                      <Link to={`/admin/partnerships/${p.id}`} className="text-crx-600 text-xs underline dark:text-crx-400">
                        Open
                      </Link>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </TableContainer>
        )}
      </div>
    </DataState>
  )
}
