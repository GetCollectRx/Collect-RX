import { describe, expect, it, vi } from 'vitest'
import {
  HANDOFF_NOTIFICATION_BODY,
  HANDOFF_NOTIFICATION_TITLE,
  raiseHandoffNudge,
  requestHandoffNotifyPermission,
  type HandoffNotifyEnv,
} from './handoffNotify'

type NotificationEnv = NonNullable<HandoffNotifyEnv['notification']>

interface FakeNotificationState {
  created: Array<{ title: string; options: NotificationOptions; close: ReturnType<typeof vi.fn>; onclick: (() => void) | null }>
}

function fakeNotificationApi(
  permission: NotificationPermission,
  requestPermission: () => Promise<NotificationPermission> = () => Promise.resolve(permission),
): { api: NotificationEnv; state: FakeNotificationState } {
  const state: FakeNotificationState = { created: [] }
  class FakeNotification {
    static permission = permission
    static requestPermission = requestPermission
    close = vi.fn()
    onclick: (() => void) | null = null
    constructor(title: string, options: NotificationOptions) {
      state.created.push({ title, options, close: this.close, onclick: null })
      const record = state.created[state.created.length - 1]
      Object.defineProperty(this, 'onclick', {
        get: () => record.onclick,
        set: (fn: (() => void) | null) => {
          record.onclick = fn
        },
      })
    }
  }
  return { api: FakeNotification as unknown as NotificationEnv, state }
}

describe('raiseHandoffNudge', () => {
  it('asks the desktop shell and clears it again when taken down', () => {
    const showHandoffAlert = vi.fn(() => Promise.resolve(true))
    const clearHandoffAlert = vi.fn(() => Promise.resolve(true))
    const stop = raiseHandoffNudge({
      desktop: { showHandoffAlert, clearHandoffAlert },
      notification: undefined,
      focusWindow: vi.fn(),
    })
    expect(showHandoffAlert).toHaveBeenCalledTimes(1)
    expect(clearHandoffAlert).not.toHaveBeenCalled()
    stop()
    expect(clearHandoffAlert).toHaveBeenCalledTimes(1)
  })

  it('prefers the desktop shell over a browser notification', () => {
    const { api, state } = fakeNotificationApi('granted')
    raiseHandoffNudge({
      desktop: { showHandoffAlert: () => Promise.resolve(true), clearHandoffAlert: () => Promise.resolve(true) },
      notification: api,
      focusWindow: vi.fn(),
    })
    expect(state.created).toHaveLength(0)
  })

  it('keeps going when the desktop bridge rejects', async () => {
    const showHandoffAlert = vi.fn(() => Promise.reject(new Error('ipc closed')))
    expect(() =>
      raiseHandoffNudge({ desktop: { showHandoffAlert }, notification: undefined, focusWindow: vi.fn() }),
    ).not.toThrow()
    await Promise.resolve()
  })

  it('shows a persistent generic browser notification when allowed, and closes it when taken down', () => {
    const { api, state } = fakeNotificationApi('granted')
    const stop = raiseHandoffNudge({ desktop: undefined, notification: api, focusWindow: vi.fn() })
    expect(state.created).toHaveLength(1)
    expect(state.created[0].title).toBe(HANDOFF_NOTIFICATION_TITLE)
    expect(state.created[0].options.body).toBe(HANDOFF_NOTIFICATION_BODY)
    expect(state.created[0].options.requireInteraction).toBe(true)
    expect(state.created[0].options.tag).toBe('crx-handoff')
    stop()
    expect(state.created[0].close).toHaveBeenCalledTimes(1)
  })

  it('brings the window forward when the browser notification is clicked', () => {
    const { api, state } = fakeNotificationApi('granted')
    const focusWindow = vi.fn()
    raiseHandoffNudge({ desktop: undefined, notification: api, focusWindow })
    state.created[0].onclick?.()
    expect(focusWindow).toHaveBeenCalledTimes(1)
    expect(state.created[0].close).toHaveBeenCalledTimes(1)
  })

  it('shows nothing when browser notifications are denied or not yet allowed', () => {
    for (const permission of ['denied', 'default'] as const) {
      const { api, state } = fakeNotificationApi(permission)
      raiseHandoffNudge({ desktop: undefined, notification: api, focusWindow: vi.fn() })
      expect(state.created).toHaveLength(0)
    }
  })

  it('does nothing and does not throw where notifications do not exist', () => {
    const stop = raiseHandoffNudge({ desktop: undefined, notification: undefined, focusWindow: vi.fn() })
    expect(() => stop()).not.toThrow()
  })

  it('never puts a carrier, claim or amount in the notification text', () => {
    const text = `${HANDOFF_NOTIFICATION_TITLE} ${HANDOFF_NOTIFICATION_BODY}`
    expect(text).not.toMatch(/\$|\d|claim|sun life|manulife|canada life|green shield|telus|rbc/i)
  })
})

describe('requestHandoffNotifyPermission', () => {
  it('asks once when permission has not been decided', () => {
    const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'))
    const { api } = fakeNotificationApi('default', requestPermission)
    requestHandoffNotifyPermission({ desktop: undefined, notification: api, focusWindow: vi.fn() })
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('does not ask when already decided', () => {
    for (const permission of ['granted', 'denied'] as const) {
      const requestPermission = vi.fn(() => Promise.resolve(permission))
      const { api } = fakeNotificationApi(permission, requestPermission)
      requestHandoffNotifyPermission({ desktop: undefined, notification: api, focusWindow: vi.fn() })
      expect(requestPermission).not.toHaveBeenCalled()
    }
  })

  it('does not ask inside the desktop app, which needs no permission', () => {
    const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'))
    const { api } = fakeNotificationApi('default', requestPermission)
    requestHandoffNotifyPermission({
      desktop: { showHandoffAlert: () => Promise.resolve(true) },
      notification: api,
      focusWindow: vi.fn(),
    })
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('does not throw when the browser refuses the request', () => {
    const { api } = fakeNotificationApi('default', () => {
      throw new Error('needs a user gesture')
    })
    expect(() =>
      requestHandoffNotifyPermission({ desktop: undefined, notification: api, focusWindow: vi.fn() }),
    ).not.toThrow()
  })
})
