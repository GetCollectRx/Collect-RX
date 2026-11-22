import { useEffect, useReducer, useRef } from 'react'
import { usePractice } from '../context/PracticeContext'
import { getDesktopSessionToken } from '../lib/desktopAuth'
import { resolveWsUrl } from '../lib/resolveWsUrl'
import { startAlertTone } from '../lib/alertTone'
import {
  HANDOFF_ALERT_TTL_MS,
  HANDOFF_TAB_TITLE,
  describeHandoffAlert,
  handoffAlertReducer,
} from '../lib/handoffAlert'
import type { WsEvent } from '../types/ws'

/** Close codes the server sends when this person is not allowed on the desk feed. Not worth retrying. */
const NOT_ADMITTED_CLOSE_CODES = new Set([4401, 4403])

/**
 * The loud, unmissable "a rep is on the line, pick up" alert. It sits in the
 * app shell so it appears on whichever screen the front desk or the designated
 * individual is working in, and it stays, with a repeating tone and a flashing
 * tab title, until someone acknowledges it.
 *
 * The server only admits front desk users and the practice's designated
 * individual to the feed; anyone else is turned away once and this stays quiet.
 */
export function HandoffAlertBanner() {
  const { practiceId, authState } = usePractice()
  const [alert, dispatch] = useReducer(handoffAlertReducer, null)
  const backoff = useRef(500)

  useEffect(() => {
    if (authState !== 'ready' || !practiceId) return
    let ws: WebSocket | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined

    function connect() {
      const token = getDesktopSessionToken()
      ws = token ? new WebSocket(resolveWsUrl('/ws/desk'), token) : new WebSocket(resolveWsUrl('/ws/desk'))
      ws.onopen = () => {
        backoff.current = 500
      }
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as WsEvent | { type: 'connected' }
        if (msg.type === 'handoff.requested') dispatch({ type: 'requested', alert: msg.data })
      }
      ws.onclose = (ev) => {
        if (closed || NOT_ADMITTED_CLOSE_CODES.has(ev.code)) return
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
  }, [authState, practiceId])

  useEffect(() => {
    if (!alert) return
    const requestedAt = alert.requestedAt
    const expiry = setTimeout(() => dispatch({ type: 'expired', requestedAt }), HANDOFF_ALERT_TTL_MS)
    const stopTone = startAlertTone()
    const originalTitle = document.title
    let flashed = true
    document.title = HANDOFF_TAB_TITLE
    const flash = setInterval(() => {
      document.title = flashed ? originalTitle : HANDOFF_TAB_TITLE
      flashed = !flashed
    }, 1000)
    return () => {
      clearTimeout(expiry)
      stopTone()
      clearInterval(flash)
      document.title = originalTitle
    }
  }, [alert])

  if (!alert) return null
  const text = describeHandoffAlert(alert)
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="handoff-alert"
      className="fixed inset-x-0 top-0 z-[100] bg-red-600 text-white shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <div>
          <p className="text-lg font-bold">{text.headline}</p>
          <p className="text-sm">{text.instruction}</p>
          {text.meta && <p className="text-sm opacity-90">{text.meta}</p>}
        </div>
        <button
          type="button"
          className="shrink-0 rounded bg-white px-4 py-2 font-semibold text-red-700 hover:bg-red-50"
          onClick={() => dispatch({ type: 'acknowledged' })}
        >
          I've got it
        </button>
      </div>
    </div>
  )
}
