/**
 * Raises the "rep is on the line" nudge outside the page itself. The desktop
 * app asks its shell for a notification that stays until clicked, flashes the
 * taskbar and brings the window forward. A plain browser falls back to a web
 * notification when the person has allowed them.
 *
 * The text is fixed and generic: a notification can show on a locked screen or
 * a shared monitor, so claim and carrier details stay inside the app.
 */

export const HANDOFF_NOTIFICATION_TITLE = 'CollectRx'
export const HANDOFF_NOTIFICATION_BODY = 'A carrier rep is on the line. Open CollectRx to take the call.'

/** One notification at a time: a newer rep replaces the older one. */
const BROWSER_NOTIFICATION_TAG = 'crx-handoff'

interface BrowserNotificationLike {
  close: () => void
  onclick: (() => void) | null
}

interface BrowserNotificationApi {
  permission: NotificationPermission
  requestPermission: () => Promise<NotificationPermission>
  new (title: string, options: NotificationOptions): BrowserNotificationLike
}

export interface HandoffNotifyEnv {
  desktop: Pick<NonNullable<Window['collectrx']>, 'showHandoffAlert' | 'clearHandoffAlert'> | undefined
  notification: BrowserNotificationApi | undefined
  focusWindow: () => void
}

export function readHandoffNotifyEnv(): HandoffNotifyEnv {
  const hasWindow = typeof window !== 'undefined'
  return {
    desktop: hasWindow ? window.collectrx : undefined,
    notification: typeof Notification === 'undefined' ? undefined : (Notification as unknown as BrowserNotificationApi),
    focusWindow: () => {
      if (hasWindow) window.focus()
    },
  }
}

/** Swallows a rejected bridge call: the banner and tone must never depend on the nudge succeeding. */
function ignoreFailure(result: Promise<unknown> | undefined): void {
  if (result) result.catch(() => undefined)
}

/** Returns a function that takes the nudge down again. Never throws. */
export function raiseHandoffNudge(env: HandoffNotifyEnv = readHandoffNotifyEnv()): () => void {
  try {
    if (env.desktop?.showHandoffAlert) {
      ignoreFailure(env.desktop.showHandoffAlert())
      return () => ignoreFailure(env.desktop?.clearHandoffAlert?.())
    }
    const Api = env.notification
    if (Api && Api.permission === 'granted') {
      const shown = new Api(HANDOFF_NOTIFICATION_TITLE, {
        body: HANDOFF_NOTIFICATION_BODY,
        tag: BROWSER_NOTIFICATION_TAG,
        requireInteraction: true,
      })
      shown.onclick = () => {
        env.focusWindow()
        shown.close()
      }
      return () => shown.close()
    }
  } catch {
    // The page alert still shows; losing the nudge is not worth an error screen.
  }
  return () => undefined
}

/**
 * Asks the browser for notification permission. Called only once the server
 * has admitted this person to the desk feed, so people who never receive
 * handoffs are not prompted. The desktop app needs no permission.
 */
export function requestHandoffNotifyPermission(env: HandoffNotifyEnv = readHandoffNotifyEnv()): void {
  if (env.desktop?.showHandoffAlert) return
  const Api = env.notification
  if (!Api || Api.permission !== 'default') return
  try {
    Api.requestPermission().catch(() => undefined)
  } catch {
    // Some browsers refuse a request that is not tied to a click; the page alert still works.
  }
}
