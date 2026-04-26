/**
 * CarrierPriorityPanel
 *
 * Displays all 6 carriers as a draggable list.
 * Drag rows to reorder — the order is posted to
 * POST /api/queue/carrier-order and persists across Electron restarts.
 *
 * The queue engine picks up this order when scheduling the next call run,
 * so reprioritising never requires a code change.
 */

import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/apiFetch'

const CARRIER_LABELS: Record<string, string> = {
  sun_life         : 'Sun Life',
  canada_life      : 'Canada Life',
  manulife         : 'Manulife',
  green_shield     : 'Green Shield Canada',
  rbc_insurance    : 'RBC Insurance',
  telus_adjudicare : 'TELUS AdjudiCare',
}

const DEFAULT_ORDER = [
  'sun_life', 'canada_life', 'manulife',
  'green_shield', 'rbc_insurance', 'telus_adjudicare',
]

interface Props {
  practiceId: string
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function CarrierPriorityPanel({ practiceId }: Props) {
  const [order, setOrder]       = useState<string[]>(DEFAULT_ORDER)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [loaded, setLoaded]     = useState(false)

  // Drag state (uses ref to avoid stale closures inside event handlers)
  const dragIndex  = useRef<number | null>(null)
  const overIndex  = useRef<number | null>(null)

  // ── Load persisted order on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!practiceId) return
    apiFetch(`/api/queue/carrier-order?practiceId=${practiceId}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.order) && data.order.length > 0) {
          setOrder(data.order)
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [practiceId])

  // ── Persist to backend ────────────────────────────────────────────────────
  async function saveOrder(newOrder: string[]) {
    setSaveState('saving')
    setErrorMsg('')
    try {
      const res = await apiFetch('/api/queue/carrier-order', {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({ order: newOrder }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as any).error || `HTTP ${res.status}`)
      }
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2500)
    } catch (err: any) {
      setErrorMsg(err.message)
      setSaveState('error')
    }
  }

  // ── Drag handlers ─────────────────────────────────────────────────────────
  function handleDragStart(index: number) {
    dragIndex.current = index
  }

  function handleDragEnter(index: number) {
    overIndex.current = index

    if (dragIndex.current === null || dragIndex.current === index) return

    // Reorder locally while dragging (live preview)
    setOrder(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragIndex.current!, 1)
      next.splice(index, 0, moved)
      dragIndex.current = index          // keep reference in sync
      return next
    })
  }

  function handleDragEnd() {
    // Persist the final order after drop
    saveOrder(order)
    dragIndex.current = null
    overIndex.current = null
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()                   // required to allow drop
    e.dataTransfer.dropEffect = 'move'
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!loaded) {
    return (
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
        <span style={{ color: '#7f8c8d', fontSize: '0.875rem' }}>
          Loading carrier order…
        </span>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.25rem' }}>📞</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#2c3e50' }}>
              Carrier Call Priority
            </h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#7f8c8d' }}>
              Drag to reorder — queue calls carriers top-to-bottom
            </p>
          </div>
        </div>

        {/* Save status badge */}
        {saveState === 'saving' && (
          <span style={{ fontSize: '0.8rem', color: '#95a5a6' }}>Saving…</span>
        )}
        {saveState === 'saved' && (
          <span style={{ fontSize: '0.8rem', color: '#27ae60', fontWeight: 600 }}>
            ✓ Saved
          </span>
        )}
        {saveState === 'error' && (
          <span style={{ fontSize: '0.8rem', color: '#e74c3c' }}>
            ⚠ {errorMsg}
          </span>
        )}
      </div>

      {/* Draggable list */}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {order.map((code, index) => (
          <li
            key={code}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragEnter={() => handleDragEnter(index)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            style={{
              display        : 'flex',
              alignItems     : 'center',
              gap            : '0.6rem',
              padding        : '8px 10px',
              marginBottom   : '6px',
              background     : dragIndex.current === index ? '#ebf5fb' : '#f8f9fa',
              border         : `1px solid ${dragIndex.current === index ? '#2980b9' : '#dde1e7'}`,
              borderRadius   : '6px',
              cursor         : 'grab',
              userSelect     : 'none',
              transition     : 'background 0.15s, border-color 0.15s',
            }}
          >
            {/* Position badge */}
            <span style={{
              minWidth: '22px', height: '22px',
              background: index === 0 ? '#2980b9' : '#bdc3c7',
              color: '#fff', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
            }}>
              {index + 1}
            </span>

            {/* Drag handle */}
            <span style={{ color: '#aab', fontSize: '1rem', lineHeight: 1 }}>⠿</span>

            {/* Label */}
            <span style={{
              flex: 1, fontSize: '0.9rem', fontWeight: index === 0 ? 600 : 400,
              color: index === 0 ? '#1a5276' : '#2c3e50',
            }}>
              {CARRIER_LABELS[code] ?? code}
            </span>

            {index === 0 && (
              <span style={{
                fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em',
                color: '#2980b9', textTransform: 'uppercase',
              }}>
                First
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
