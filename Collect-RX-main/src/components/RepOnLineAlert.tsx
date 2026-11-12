import { useEffect, useRef, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { describeHandoffAlert, type HandoffAlert, type HandoffEvent } from '../lib/handoffAlert'
import { getDesktopSessionToken } from '../lib/desktopAuth'
import { resolveWsUrl } from '../lib/resolveWsUrl'
import type { WsEvent } from '../types/ws'

const ALERT_ROLES = new Set(['front_desk', 'office_manager', 'practice_owner'])
/** Close codes that mean this person is not allowed on the desk socket. Retrying would only repeat the refusal. */
const REFUSED_CODES = new Set([4401, 4403])

function beep(): void {
  try {
    const Ctx = window.AudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.value = 0.08
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.25)
    osc.onended = () => void ctx.close()
  } catch {
    /* Sound is best effort: browsers block audio until the person has interacted with the page. */
  }
}

/**
 * App-wide banner for the moment that matters most: a live carrier rep just answered. It does not depend on
 * which page is open, so staff see it wherever they are. The phone ringing is still the real signal.
 */
export function RepOnLineAlert() {
  const { practiceId, userRole } = usePractice()
  const [alert, setAlert] = useState<HandoffAlert | null>(null)
  const backoff = useRef(500)
  const originalTitle = useRef<string | null>(null)
  const allowed = Boolean(practiceId) && ALERT_ROLES.has(String(userRole))

  useEffect(() => {
    if (!allowed) return
    let ws: WebSocket | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined

    function connect() {
      const token = getDesktopSessionToken()
      ws = token ? new WebSocket(resolveWsUrl('/ws/desk'), token) : new WebSocket(resolveWsUrl('/ws/desk'))
      ws.onopen = () => { backoff.current = 500 }
      ws.onmessage = (ev) => {
        let msg: WsEvent | { type: 'connected' }
        try {
          msg = JSON.parse(ev.data as string) as WsEvent | { type: 'connected' }
        } catch {
          return
        }
        if (msg.type === 'handoff.requested' || msg.type === 'handoff.missed') {
          setAlert(describeHandoffAlert(msg as HandoffEvent))
          beep()
        }
      }
      ws.onclose = (ev) => {
        if (closed || REFUSED_CODES.has(ev.code)) return
        const delay = Math.min(backoff.current, 30_000)
        backoff.current = Math.min(backoff.current * 2, 30_000)
        retry = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      ws?.close()
    }
  }, [allowed])

  useEffect(() => {
    if (!alert) return
    const timer = setTimeout(() => setAlert(null), alert.autoDismissMs)
    originalTitle.current ??= document.title
    document.title = alert.kind === 'requested' ? 'Rep on the line | CollectRx' : 'Missed rep | CollectRx'
    return () => {
      clearTimeout(timer)
      if (originalTitle.current !== null) document.title = originalTitle.current
      originalTitle.current = null
    }
  }, [alert])

  if (!alert) return null
  const urgent = alert.kind === 'requested'
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`mx-4 mt-3 rounded-lg border p-3 ${
        urgent
          ? 'border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100'
          : 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{alert.title}</p>
          <p className="text-sm mt-0.5">{alert.detail}</p>
        </div>
        <button type="button" className="text-xs underline flex-shrink-0" onClick={() => setAlert(null)}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
