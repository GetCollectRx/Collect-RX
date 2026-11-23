import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

interface FakeWindow {
  isMinimized: () => boolean
  restore: () => void
  show: () => void
  focus: () => void
  flashFrame: (flag: boolean) => void
}

interface FakeNotification {
  show: () => void
  close: () => void
  on: (event: string, cb: () => void) => void
}

interface NotificationCtor {
  isSupported: () => boolean
  new (options: object): FakeNotification
}

interface NudgeModule {
  createHandoffNudge: (deps: { Notification: NotificationCtor; getWindow: () => FakeWindow | null }) => {
    show: () => void
    clear: () => void
  }
  NOTIFICATION_TITLE: string
  NOTIFICATION_BODY: string
}

const nudgeModule = createRequire(import.meta.url)('../electron-shell/handoffNudge.cjs') as NudgeModule

function setup(opts: { supported?: boolean; minimized?: boolean; hasWindow?: boolean } = {}) {
  const win = {
    isMinimized: vi.fn(() => opts.minimized === true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    flashFrame: vi.fn(),
  }
  const created: Array<{ options: object; show: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; click: () => void }> = []
  class Notif {
    static isSupported = () => opts.supported !== false
    private clickHandler: () => void = () => undefined
    show = vi.fn()
    close = vi.fn()
    constructor(options: object) {
      created.push({
        options,
        show: this.show,
        close: this.close,
        click: () => this.clickHandler(),
      })
    }
    on(event: string, cb: () => void) {
      if (event === 'click') this.clickHandler = cb
    }
  }
  const nudge = nudgeModule.createHandoffNudge({
    Notification: Notif as unknown as NotificationCtor,
    getWindow: () => (opts.hasWindow === false ? null : win),
  })
  return { nudge, win, created }
}

describe('desktop handoff nudge', () => {
  it('flashes the taskbar, brings the window forward and shows one persistent critical notification', () => {
    const { nudge, win, created } = setup()
    nudge.show()
    expect(win.flashFrame).toHaveBeenCalledWith(true)
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(created).toHaveLength(1)
    expect(created[0].show).toHaveBeenCalledTimes(1)
    expect(created[0].options).toMatchObject({
      title: nudgeModule.NOTIFICATION_TITLE,
      body: nudgeModule.NOTIFICATION_BODY,
      urgency: 'critical',
      timeoutType: 'never',
    })
  })

  it('restores a minimized window', () => {
    const { nudge, win } = setup({ minimized: true })
    nudge.show()
    expect(win.restore).toHaveBeenCalledTimes(1)
  })

  it('clearing closes the notification and stops the taskbar flash', () => {
    const { nudge, win, created } = setup()
    nudge.show()
    nudge.clear()
    expect(created[0].close).toHaveBeenCalledTimes(1)
    expect(win.flashFrame).toHaveBeenLastCalledWith(false)
  })

  it('a newer alert replaces the older notification instead of stacking', () => {
    const { nudge, created } = setup()
    nudge.show()
    nudge.show()
    expect(created).toHaveLength(2)
    expect(created[0].close).toHaveBeenCalledTimes(1)
    expect(created[1].close).not.toHaveBeenCalled()
  })

  it('clicking the notification brings the window forward', () => {
    const { nudge, win, created } = setup()
    nudge.show()
    win.show.mockClear()
    win.focus.mockClear()
    created[0].click()
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('still flashes and focuses when the system cannot show notifications', () => {
    const { nudge, win, created } = setup({ supported: false })
    nudge.show()
    expect(created).toHaveLength(0)
    expect(win.flashFrame).toHaveBeenCalledWith(true)
  })

  it('does not throw when there is no window yet', () => {
    const { nudge } = setup({ hasWindow: false })
    expect(() => nudge.show()).not.toThrow()
    expect(() => nudge.clear()).not.toThrow()
  })

  it('keeps carrier, claim and amount out of the notification text', () => {
    const text = `${nudgeModule.NOTIFICATION_TITLE} ${nudgeModule.NOTIFICATION_BODY}`
    expect(text).not.toMatch(/\$|\d|claim|sun life|manulife|canada life|green shield|telus|rbc/i)
  })
})
