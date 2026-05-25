import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { resolveWsUrl } from '../lib/resolveWsUrl'
import { parseApiJson } from '../lib/parseApiJson'
import type { DeskActiveCall, DeskCarrierBlock, DeskQueueEntry, DeskTranscriptLine } from '../types/frontDesk'
import type { WsEvent } from '../types/ws'
import { CarrierBlockModal } from '../components/CarrierBlockModal'

const AGENTS = ['IVR_Navigator', 'Claims_Agent', 'Escalation_Closer', 'Resolution_Closer'] as const

const CARRIER_LABELS: Record<string, string> = {
  sun_life: 'Sun Life',
  canada_life: 'Canada Life',
  manulife: 'Manulife',
  green_shield: 'Green Shield',
  rbc: 'RBC',
  telus_adjudicare: 'TELUS AdjudiCare',
}

type CarrierRow = {
  carrierId: string
  displayName: string
  status: 'open' | 'on_call' | 'blocked'
  block: { id: string; blockedAt: string; reason: string | null } | null
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}

function formatDuration(startedAt: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function LiveConsole() {
  const { practiceId, isFrontDesk } = usePractice()
  const [carriers, setCarriers] = useState<CarrierRow[]>([])
  const [queue, setQueue] = useState<DeskQueueEntry[]>([])
  const [queuePaused, setQueuePaused] = useState(false)
  const [activeCall, setActiveCall] = useState<DeskActiveCall | null>(null)
  const [transcript, setTranscript] = useState<DeskTranscriptLine[]>([])
  const [blockAlert, setBlockAlert] = useState<DeskCarrierBlock | null>(null)
  const [modalBlock, setModalBlock] = useState<DeskCarrierBlock | null>(null)
  const [takeoverOpen, setTakeoverOpen] = useState(false)
  const [takeoverPhone, setTakeoverPhone] = useState('')
  const [timer, setTimer] = useState('0:00')
  const [error, setError] = useState<string | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const wsBackoff = useRef(500)

  const deskBase = `/api/desk/${practiceId}`

  const loadSnapshot = useCallback(async () => {
    if (!practiceId) return
    const [activeRes, queueRes, carriersRes] = await Promise.all([
      fetch(resolveApiUrl(`${deskBase}/active`), { credentials: 'include' }),
      fetch(resolveApiUrl(`${deskBase}/queue`), { credentials: 'include' }),
      fetch(resolveApiUrl(`${deskBase}/carriers/status`), { credentials: 'include' }),
    ])
    const activeJson = await parseApiJson<{ data: { call: DeskActiveCall | null; transcript: DeskTranscriptLine[] } }>(activeRes)
    const queueJson = await parseApiJson<{ data: { queue: DeskQueueEntry[]; paused: boolean } }>(queueRes)
    const carriersJson = await parseApiJson<{ data: CarrierRow[] }>(carriersRes)
    setActiveCall(activeJson.data.call)
    setTranscript(activeJson.data.transcript)
    setQueue(queueJson.data.queue)
    setQueuePaused(queueJson.data.paused)
    setCarriers(carriersJson.data)
    const blocked = carriersJson.data.find((c) => c.status === 'blocked')
    if (blocked?.block) {
      setBlockAlert({
        id: blocked.block.id,
        carrierId: blocked.carrierId as DeskCarrierBlock['carrierId'],
        blockedAt: blocked.block.blockedAt,
        blockedByCallId: null,
        reason: blocked.block.reason ?? 'Carrier automation detected',
        heldQueueCount: queueJson.data.queue.filter((q) => q.heldForCarrierBlock).length,
      })
    }
  }, [practiceId, deskBase])

  useEffect(() => {
    void loadSnapshot().catch((e) => setError((e as Error).message))
  }, [loadSnapshot])

  useEffect(() => {
    if (!activeCall?.startedAt) return
    const id = setInterval(() => setTimer(formatDuration(activeCall.startedAt)), 1000)
    return () => clearInterval(id)
  }, [activeCall?.startedAt])

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  useEffect(() => {
    if (!practiceId) return
    let ws: WebSocket | null = null
    let closed = false

    function connect() {
      ws = new WebSocket(resolveWsUrl('/ws/desk'))
      ws.onopen = () => {
        wsBackoff.current = 500
      }
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as WsEvent | { type: 'connected' }
        if (msg.type === 'call.started') {
          setActiveCall(msg.data.call)
          setTranscript([])
        } else if (msg.type === 'call.state_changed') {
          setActiveCall((c) =>
            c && c.id === msg.data.callId
              ? { ...c, state: msg.data.state, activeAgent: msg.data.activeAgent }
              : c,
          )
        } else if (msg.type === 'transcript.line') {
          setTranscript((t) => [...t, msg.data])
        } else if (msg.type === 'call.ended') {
          setTimeout(() => {
            setActiveCall(null)
            setTranscript([])
            void loadSnapshot()
          }, 3000)
        } else if (msg.type === 'queue.updated') {
          setQueue(msg.data.queue)
        } else if (msg.type === 'carrier.blocked') {
          setBlockAlert(msg.data.block)
        } else if (msg.type === 'carrier.unblocked') {
          setBlockAlert(null)
          void loadSnapshot()
        }
      }
      ws.onclose = () => {
        if (closed) return
        const delay = Math.min(wsBackoff.current, 30_000)
        wsBackoff.current = Math.min(wsBackoff.current * 2, 30_000)
        setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      closed = true
      ws?.close()
    }
  }, [practiceId, loadSnapshot])

  async function post(path: string, body?: unknown) {
    const res = await fetch(resolveApiUrl(`${deskBase}${path}`), {
      method: 'POST',
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error((j as { error?: string }).error ?? res.statusText)
    }
  }

  async function toggleQueue() {
    await post(queuePaused ? '/queue/resume' : '/queue/pause')
    setQueuePaused(!queuePaused)
  }

  async function bumpPriority(entry: DeskQueueEntry, delta: number) {
    await post(`/queue/${entry.id}/priority`, { priority: entry.priority + delta })
    await loadSnapshot()
  }

  async function setQueuePriority(entry: DeskQueueEntry, priority: number) {
    await post(`/queue/${entry.id}/priority`, { priority })
  }

  async function reorderQueue(draggedId: string, targetId: string) {
    const from = queue.findIndex((q) => q.id === draggedId)
    const to = queue.findIndex((q) => q.id === targetId)
    if (from < 0 || to < 0 || from === to) return
    const next = [...queue]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setQueue(next)
    await Promise.all(
      next.map((e, i) => setQueuePriority(e, Math.max(10, (next.length - i) * 10))),
    )
    await loadSnapshot()
  }

  async function removeFromQueue(id: string) {
    const res = await fetch(resolveApiUrl(`${deskBase}/queue/${id}`), {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error((j as { error?: string }).error ?? 'Remove failed')
    }
    await loadSnapshot()
  }

  const activeAgentIndex = activeCall?.activeAgent
    ? AGENTS.indexOf(activeCall.activeAgent as (typeof AGENTS)[number])
    : 0

  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-52px)]">
      {blockAlert && (
        <div
          className="px-4 py-3 flex items-center justify-between gap-4"
          style={{ background: 'var(--crx-red)', color: 'var(--crx-t0)' }}
        >
          <div>
            <p className="font-semibold text-sm">
              {CARRIER_LABELS[blockAlert.carrierId] ?? blockAlert.carrierId} — all calls suspended
            </p>
            <p className="text-xs opacity-90">
              {blockAlert.heldQueueCount} claim(s) on hold until you review and clear.
            </p>
          </div>
          <button
            type="button"
            className="text-sm font-medium bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded"
            onClick={() => setModalBlock(blockAlert)}
          >
            Review &amp; Clear
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 px-4 py-2" role="alert">{error}</p>
      )}

      <div className="flex flex-1 min-h-0">
        <aside className="crx-console-aside w-[240px] border-r p-3 flex flex-col gap-4 overflow-y-auto">
          <section>
            <h2 className="crx-section-label mb-2">Carriers</h2>
            <ul className="space-y-1">
              {carriers.map((c) => (
                <li key={c.carrierId}>
                  <button
                    type="button"
                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:opacity-90"
                    style={{ color: 'var(--crx-t1)' }}
                    onClick={() => c.status === 'blocked' && c.block && setModalBlock({
                      id: c.block.id,
                      carrierId: c.carrierId as DeskCarrierBlock['carrierId'],
                      blockedAt: c.block.blockedAt,
                      blockedByCallId: null,
                      reason: c.block.reason ?? '',
                      heldQueueCount: queue.filter((q) => q.carrierId === c.carrierId && q.heldForCarrierBlock).length,
                    })}
                  >
                    <span className="font-medium">{c.displayName}</span>
                    <span className="block text-2xs text-gray-500">
                      {c.status === 'blocked' ? '⛔ Blocked' : c.status === 'on_call' ? 'On call' : 'Open'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h2 className="crx-section-label">Queue</h2>
              {queuePaused && <span className="crx-badge crx-badge-amber">Paused</span>}
            </div>
            <button
              type="button"
              className="crx-btn-ghost text-xs mb-2 w-full"
              onClick={() => void toggleQueue().catch((e) => setError((e as Error).message))}
            >
              {queuePaused ? 'Resume queue' : 'Pause queue'}
            </button>
            <p className="text-2xs mb-2" style={{ color: 'var(--crx-t3)' }}>
              Drag to reorder priority
            </p>
            <ul className="space-y-1.5 overflow-y-auto flex-1">
              {queue.map((e) => (
                <li
                  key={e.id}
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData('text/plain', e.id)
                    ev.currentTarget.classList.add('dragging')
                  }}
                  onDragEnd={(ev) => ev.currentTarget.classList.remove('dragging')}
                  onDragOver={(ev) => ev.preventDefault()}
                  onDrop={(ev) => {
                    ev.preventDefault()
                    const draggedId = ev.dataTransfer.getData('text/plain')
                    if (draggedId && draggedId !== e.id) {
                      void reorderQueue(draggedId, e.id).catch((err) => setError((err as Error).message))
                    }
                  }}
                  className="crx-queue-item text-xs p-2 cursor-grab active:cursor-grabbing"
                >
                  <p className="font-medium" style={{ color: 'var(--crx-t0)' }}>{e.claimRef}</p>
                  <p style={{ color: 'var(--crx-t3)' }}>{CARRIER_LABELS[e.carrierId] ?? e.carrierId}</p>
                  <p style={{ color: 'var(--crx-t2)' }}>{formatMoney(e.amountClaimedCents)}</p>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    <button
                      type="button"
                      className="crx-btn-ghost text-2xs py-0.5 px-1"
                      onClick={() => void bumpPriority(e, -10).catch((err) => setError((err as Error).message))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="crx-btn-ghost text-2xs py-0.5 px-1"
                      onClick={() => void bumpPriority(e, 10).catch((err) => setError((err as Error).message))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="crx-btn-ghost text-2xs py-0.5 px-1"
                      style={{ color: 'var(--crx-red)' }}
                      onClick={() => void removeFromQueue(e.id).catch((err) => setError((err as Error).message))}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <div className="flex-1 p-4 overflow-y-auto">
          {activeCall ? (
            <div className="max-w-3xl mx-auto space-y-4">
              <header className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-medium bg-crx-100 text-crx-800 dark:bg-crx-900/40 px-2 py-1 rounded">
                  {CARRIER_LABELS[activeCall.carrierId] ?? activeCall.carrierId}
                </span>
                <span className="font-semibold">{activeCall.claimRef}</span>
                <span>{formatMoney(activeCall.amountClaimedCents)}</span>
                <span className="text-sm text-gray-500">
                  Attempt {activeCall.attemptNumber} of 3 · {timer}
                </span>
              </header>

              <ol className="flex gap-2 text-2xs">
                {AGENTS.map((a, i) => (
                  <li
                    key={a}
                    className={`flex-1 text-center py-1 rounded ${
                      i < activeAgentIndex
                        ? 'bg-crx-500 text-white'
                        : i === activeAgentIndex
                          ? 'ring-2 ring-crx-500'
                          : 'bg-gray-100 dark:bg-gray-800'
                    }`}
                  >
                    {i < activeAgentIndex ? '✓ ' : ''}
                    {a.replace(/_/g, ' ')}
                  </li>
                ))}
              </ol>

              <div className="border border-gray-200 dark:border-gray-800 rounded-lg h-64 overflow-y-auto p-3 bg-gray-50/50 dark:bg-gray-900/30">
                {transcript.map((line) => (
                  <p
                    key={line.id}
                    className={`text-sm mb-2 ${
                      line.speaker === 'agent'
                        ? 'text-blue-700 dark:text-blue-300'
                        : line.speaker === 'carrier'
                          ? 'text-purple-700 dark:text-purple-300'
                          : 'text-gray-500 italic'
                    }`}
                  >
                    {line.text}
                  </p>
                ))}
                <div ref={transcriptEndRef} />
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => void post('/active/pause-agent')}>⏸ Pause Agent</button>
                <button type="button" className="btn-secondary text-xs" onClick={() => void post('/active/end-call')}>📵 End Call</button>
                <button type="button" className="btn-secondary text-xs" onClick={() => setTakeoverOpen(true)}>📞 Take Over Call</button>
                {!isFrontDesk && (
                  <Link to={`/insurance/${activeCall.claimId}`} className="btn-secondary text-xs">📄 View Claim</Link>
                )}
              </div>

              {takeoverOpen && (
                <div className="border border-crx-200 rounded-lg p-3 space-y-2">
                  <label className="text-xs block">
                    Front desk phone
                    <input
                      className="mt-1 w-full border rounded px-2 py-1 text-sm dark:bg-gray-900"
                      value={takeoverPhone}
                      onChange={(ev) => setTakeoverPhone(ev.target.value)}
                      placeholder="+1..."
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-primary text-xs"
                      onClick={() => void post('/active/takeover', { phoneNumber: takeoverPhone }).then(() => setTakeoverOpen(false))}
                    >
                      Transfer Now
                    </button>
                    <button type="button" className="btn-secondary text-xs" onClick={() => setTakeoverOpen(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
              <p className="text-lg font-medium text-gray-700 dark:text-gray-300">No active call</p>
              <p className="text-sm mt-1">{queue.length} claim(s) in queue</p>
              {queue[0] && (
                <p className="text-xs mt-2">
                  Next: {queue[0].claimRef} · {CARRIER_LABELS[queue[0].carrierId]}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {modalBlock && (
        <CarrierBlockModal
          block={modalBlock}
          practiceId={practiceId}
          onClose={() => setModalBlock(null)}
          onCleared={() => {
            setModalBlock(null)
            setBlockAlert(null)
            void loadSnapshot()
          }}
        />
      )}
    </div>
  )
}
