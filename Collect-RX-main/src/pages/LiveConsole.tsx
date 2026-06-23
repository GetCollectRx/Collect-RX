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

const AGENT_DISPLAY: Record<string, string> = {
  IVR_Navigator: 'IVR Navigator',
  Claims_Agent: 'Claims Agent',
  Escalation_Closer: 'Escalation',
  Resolution_Closer: 'Resolution',
}

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

function callStateLabel(state: string | undefined): string {
  const map: Record<string, string> = {
    dialing: 'Dialing carrier...',
    ivr: 'Navigating IVR menu',
    on_hold: 'On hold with carrier',
    speaking: 'Speaking with rep',
    resolving: 'Resolving claim',
    ending: 'Wrapping up',
  }
  return state ? (map[state] ?? 'Active call') : 'Active call'
}

// ── Waveform ──────────────────────────────────────────────────────────────
const WAVE_HEIGHTS = [28, 54, 78, 62, 42, 90, 68, 48, 86, 58, 36, 72, 96, 52, 70, 44, 80, 32]

function Waveform({ active }: { active: boolean }) {
  if (!active) {
    return (
      <div className="flex items-center justify-center gap-[4px] h-14">
        {WAVE_HEIGHTS.map((_, i) => (
          <div
            key={i}
            style={{ width: 3, height: 3, borderRadius: 9999, background: '#d1fae5' }}
          />
        ))}
      </div>
    )
  }
  return (
    <div className="flex items-end justify-center gap-[4px] h-14">
      {WAVE_HEIGHTS.map((h, i) => (
        <div
          key={i}
          className="crx-wave-bar"
          style={{
            height: `${h}%`,
            animationDelay: `${(i * 0.065).toFixed(3)}s`,
            animationDuration: `${0.62 + (i % 5) * 0.11}s`,
          }}
        />
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
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
      ws.onopen = () => { wsBackoff.current = 500 }
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

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-52px)]">

      {/* ── Carrier block banner ── */}
      {blockAlert && (
        <div className="px-5 py-3 flex items-center justify-between gap-4 bg-red-600 text-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-base flex-shrink-0">⛔</div>
            <div>
              <p className="font-semibold text-sm">
                {CARRIER_LABELS[blockAlert.carrierId] ?? blockAlert.carrierId}, Automation Detection Alert
              </p>
              <p className="text-xs text-red-100">
                All calls to this carrier suspended · {blockAlert.heldQueueCount} claim{blockAlert.heldQueueCount !== 1 ? 's' : ''} on hold
              </p>
            </div>
          </div>
          <button
            type="button"
            className="text-sm font-semibold bg-white/20 hover:bg-white/30 px-4 py-1.5 rounded-lg transition-colors flex-shrink-0"
            onClick={() => setModalBlock(blockAlert)}
          >
            Review &amp; Clear →
          </button>
        </div>
      )}

      {error && (
        <div className="px-5 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800 flex-shrink-0">
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
        </div>
      )}

      <div className="flex flex-1 min-h-0">

        {/* ── Left sidebar ── */}
        <aside className="w-[240px] flex-shrink-0 border-r border-gray-100 dark:border-gray-800/60 flex flex-col bg-white dark:bg-gray-950/60">

          {/* Carriers */}
          <div className="p-4 border-b border-gray-100 dark:border-gray-800/60">
            <h2 className="text-2xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-3">Carriers</h2>
            <ul className="space-y-0.5">
              {carriers.map((c) => (
                <li key={c.carrierId}>
                  <button
                    type="button"
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors ${
                      c.status === 'blocked'
                        ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 cursor-pointer'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-default'
                    }`}
                    onClick={() => {
                      if (c.status === 'blocked' && c.block) {
                        setModalBlock({
                          id: c.block.id,
                          carrierId: c.carrierId as DeskCarrierBlock['carrierId'],
                          blockedAt: c.block.blockedAt,
                          blockedByCallId: null,
                          reason: c.block.reason ?? '',
                          heldQueueCount: queue.filter((q) => q.carrierId === c.carrierId && q.heldForCarrierBlock).length,
                        })
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        c.status === 'blocked' ? 'bg-red-500' :
                        c.status === 'on_call' ? 'bg-emerald-400 animate-pulse' :
                        'bg-gray-300 dark:bg-gray-700'
                      }`} />
                      <span className={`font-medium ${
                        c.status === 'blocked' ? 'text-red-700 dark:text-red-400' :
                        c.status === 'on_call' ? 'text-emerald-700 dark:text-emerald-400' :
                        'text-gray-700 dark:text-gray-300'
                      }`}>{c.displayName}</span>
                    </div>
                    <p className={`text-2xs mt-0.5 ml-3.5 ${
                      c.status === 'blocked' ? 'text-red-500' :
                      c.status === 'on_call' ? 'text-emerald-600 dark:text-emerald-500' :
                      'text-gray-400 dark:text-gray-600'
                    }`}>
                      {c.status === 'blocked' ? 'Blocked, tap to review' :
                       c.status === 'on_call' ? 'On call now' : 'Open'}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Queue */}
          <div className="flex-1 min-h-0 flex flex-col p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-2xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600">
                Queue
                {queue.length > 0 && (
                  <span className="ml-1.5 text-gray-500 dark:text-gray-500 font-normal normal-case">· {queue.length}</span>
                )}
              </h2>
              {queuePaused && (
                <span className="text-2xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">
                  Paused
                </span>
              )}
            </div>

            <button
              type="button"
              className="w-full mb-3 text-xs py-1.5 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors font-medium"
              onClick={() => void toggleQueue().catch((e) => setError((e as Error).message))}
            >
              {queuePaused ? '▶ Resume queue' : '⏸ Pause queue'}
            </button>

            <p className="text-2xs text-gray-400 dark:text-gray-600 mb-2.5">Drag to reorder</p>

            <div className="space-y-1.5 overflow-y-auto flex-1">
              {queue.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-600 text-center py-6">Queue is empty</p>
              )}
              {queue.map((e, idx) => (
                <div
                  key={e.id}
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData('text/plain', e.id)
                    ev.currentTarget.style.opacity = '0.5'
                  }}
                  onDragEnd={(ev) => { ev.currentTarget.style.opacity = '1' }}
                  onDragOver={(ev) => ev.preventDefault()}
                  onDrop={(ev) => {
                    ev.preventDefault()
                    const draggedId = ev.dataTransfer.getData('text/plain')
                    if (draggedId && draggedId !== e.id) {
                      void reorderQueue(draggedId, e.id).catch((err) => setError((err as Error).message))
                    }
                  }}
                  className="bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-800/40 border border-gray-100 dark:border-gray-800/60 rounded-lg p-2.5 cursor-grab active:cursor-grabbing transition-colors"
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{e.claimRef}</p>
                      <p className="text-2xs text-gray-500 dark:text-gray-500 mt-0.5">{CARRIER_LABELS[e.carrierId] ?? e.carrierId}</p>
                      <p className="text-2xs font-semibold text-emerald-700 dark:text-emerald-400 font-mono mt-0.5">{formatMoney(e.amountClaimedCents)}</p>
                    </div>
                    <span className="text-2xs text-gray-300 dark:text-gray-700 font-mono flex-shrink-0">#{idx + 1}</span>
                  </div>
                  <div className="flex gap-1 mt-2">
                    <button
                      type="button"
                      title="Raise priority"
                      className="flex-1 text-2xs py-0.5 rounded border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-800 text-gray-500 transition-colors"
                      onClick={() => void bumpPriority(e, -10).catch((err) => setError((err as Error).message))}
                    >↑</button>
                    <button
                      type="button"
                      title="Lower priority"
                      className="flex-1 text-2xs py-0.5 rounded border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-800 text-gray-500 transition-colors"
                      onClick={() => void bumpPriority(e, 10).catch((err) => setError((err as Error).message))}
                    >↓</button>
                    <button
                      type="button"
                      title="Remove from queue"
                      className="text-2xs py-0.5 px-1.5 rounded border border-red-200 dark:border-red-800/40 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors"
                      onClick={() => void removeFromQueue(e.id).catch((err) => setError((err as Error).message))}
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── Main area ── */}
        <div className="flex-1 overflow-y-auto bg-gray-50/40 dark:bg-gray-950">
          {activeCall ? (

            // ── Active call ──
            <div className="max-w-2xl mx-auto p-6 space-y-4 page-enter">

              {/* Call identity bar */}
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/60 rounded-xl px-4 py-3 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-2.5 py-1 rounded-full">
                    <span className="crx-live-dot" />
                    LIVE
                  </span>
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    {CARRIER_LABELS[activeCall.carrierId] ?? activeCall.carrierId}
                  </span>
                  <span className="text-gray-300 dark:text-gray-700 select-none">·</span>
                  <span className="text-sm font-mono text-gray-500 dark:text-gray-400">{activeCall.claimRef}</span>
                  <span className="text-gray-300 dark:text-gray-700 select-none">·</span>
                  <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 font-mono">
                    {formatMoney(activeCall.amountClaimedCents)}
                  </span>
                  <span className="ml-auto text-xs text-gray-400 dark:text-gray-600 font-mono tabular-nums">
                    Attempt {activeCall.attemptNumber}/3 · {timer}
                  </span>
                </div>
              </div>

              {/* Waveform hero */}
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/60 rounded-xl px-6 py-6 shadow-card text-center">
                <div className="flex justify-center mb-5">
                  <Waveform active />
                </div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 tracking-tight">
                  {callStateLabel((activeCall as DeskActiveCall & { state?: string }).state)}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-600 mt-1 font-mono tabular-nums">{timer}</p>
              </div>

              {/* Agent pipeline stepper */}
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/60 rounded-xl p-4 shadow-card">
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-3">Agent Pipeline</h3>
                <div className="flex gap-2">
                  {AGENTS.map((a, i) => {
                    const done   = i < activeAgentIndex
                    const active = i === activeAgentIndex
                    return (
                      <div
                        key={a}
                        className={`flex-1 py-2.5 px-1.5 rounded-lg text-center text-2xs leading-tight font-medium transition-all ${
                          done
                            ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                            : active
                              ? 'bg-emerald-500 text-white shadow-sm ring-2 ring-emerald-500/25'
                              : 'bg-gray-50 dark:bg-gray-800/40 text-gray-400 dark:text-gray-600'
                        }`}
                      >
                        <div className="text-sm mb-1">
                          {done ? '✓' : active ? '●' : '○'}
                        </div>
                        {AGENT_DISPLAY[a] ?? a.replace(/_/g, ' ')}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Live transcript */}
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/60 rounded-xl shadow-card overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800/60 flex items-center justify-between">
                  <h3 className="text-2xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600">Live Transcript</h3>
                  <span className="text-2xs text-gray-400 dark:text-gray-600">{transcript.length} line{transcript.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="h-60 overflow-y-auto p-4 space-y-3 bg-gray-50/40 dark:bg-gray-950/50">
                  {transcript.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-600 italic text-center py-6">
                      Transcript will appear here as the call progresses...
                    </p>
                  )}
                  {transcript.map((line) => (
                    <div key={line.id} className="flex gap-2.5 text-xs">
                      <span className={`flex-shrink-0 font-bold text-2xs uppercase tracking-wider pt-0.5 w-7 ${
                        line.speaker === 'agent'
                          ? 'text-emerald-600 dark:text-emerald-500'
                          : line.speaker === 'carrier'
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-gray-400 dark:text-gray-600'
                      }`}>
                        {line.speaker === 'agent' ? 'AI' : line.speaker === 'carrier' ? 'REP' : 'SYS'}
                      </span>
                      <p className={`leading-relaxed ${
                        line.speaker === 'agent'
                          ? 'text-gray-700 dark:text-gray-300'
                          : line.speaker === 'carrier'
                            ? 'text-gray-800 dark:text-gray-200'
                            : 'text-gray-400 dark:text-gray-600 italic'
                      }`}>
                        {line.text}
                      </p>
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300 transition-colors shadow-sm"
                  onClick={() => void post('/active/pause-agent').catch((e) => setError((e as Error).message))}
                >
                  ⏸ Pause Agent
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-900 border border-red-200 dark:border-red-800/40 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors shadow-sm"
                  onClick={() => void post('/active/end-call').catch((e) => setError((e as Error).message))}
                >
                  ✕ End Call
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300 transition-colors shadow-sm"
                  onClick={() => setTakeoverOpen((v) => !v)}
                >
                  📞 Take Over
                </button>
                {!isFrontDesk && (
                  <Link
                    to={`/insurance/${(activeCall as DeskActiveCall & { claimId?: string }).claimId}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300 transition-colors shadow-sm"
                  >
                    📄 View Claim
                  </Link>
                )}
              </div>

              {/* Takeover panel */}
              {takeoverOpen && (
                <div className="bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800/40 rounded-xl p-4 shadow-card space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Take Over Call</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">AI will transfer the live call to your phone number.</p>
                  </div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Your phone number
                    <input
                      type="tel"
                      className="mt-1.5 w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                      value={takeoverPhone}
                      onChange={(ev) => setTakeoverPhone(ev.target.value)}
                      placeholder="+1 416 555 0123"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                      onClick={() =>
                        void post('/active/takeover', { phoneNumber: takeoverPhone })
                          .then(() => setTakeoverOpen(false))
                          .catch((e) => setError((e as Error).message))
                      }
                    >
                      Transfer Now
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/40 text-gray-600 dark:text-gray-400 transition-colors"
                      onClick={() => setTakeoverOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

          ) : (

            // ── Idle / no active call ──
            <div className="flex flex-col items-center justify-center h-full min-h-[420px] text-center p-8 page-enter">
              <div className="mb-5 opacity-60">
                <Waveform active={false} />
              </div>
              <p className="text-base font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                No Active Call
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-600 max-w-xs">
                {queue.length > 0
                  ? `${queue.length} claim${queue.length !== 1 ? 's' : ''} queued, AI will dial when the next window opens`
                  : 'Add claims to the queue to begin automated collection calls.'}
              </p>

              {queue[0] && (
                <div className="mt-8 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/60 rounded-xl p-4 shadow-card text-left w-64">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-2.5">Up next</p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{queue[0].claimRef}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{CARRIER_LABELS[queue[0].carrierId] ?? queue[0].carrierId}</p>
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 font-mono mt-1.5">
                    {formatMoney(queue[0].amountClaimedCents)}
                  </p>
                </div>
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
