import { useCallback, useEffect, useState } from 'react'

export type DesktopSyncStatus = 'starting' | 'healthy' | 'error' | 'offline' | string

export interface DesktopSyncState {
  status: DesktopSyncStatus
  message: string
}

export interface DesktopConnectorState {
  isDesktop: boolean
  appVersion: string | null
  sync: DesktopSyncState | null
  updateAvailable: string | null
  updateDownloaded: string | null
}

const INITIAL: DesktopConnectorState = {
  isDesktop: false,
  appVersion: null,
  sync: null,
  updateAvailable: null,
  updateDownloaded: null,
}

function readDesktopBridge(): Window['collectrx'] {
  return typeof window !== 'undefined' ? window.collectrx : undefined
}

export function useDesktopConnector(): DesktopConnectorState & {
  triggerManualSync: () => Promise<void>
  restartToUpdate: () => Promise<void>
} {
  const [state, setState] = useState<DesktopConnectorState>(INITIAL)

  useEffect(() => {
    const crx = readDesktopBridge()
    if (!crx) return

    let cancelled = false
    setState((s) => ({ ...s, isDesktop: true }))

    void crx.getAppVersion?.().then((v: unknown) => {
      if (!cancelled && typeof v === 'string') {
        setState((s) => ({ ...s, appVersion: v }))
      }
    })

    void crx.getSyncStatus?.().then((raw: unknown) => {
      if (cancelled || !raw || typeof raw !== 'object') return
      const data = raw as { status?: string; message?: string }
      setState((s) => ({
        ...s,
        sync: {
          status: data.status ?? 'starting',
          message: data.message ?? '',
        },
      }))
    })

    const offSync = crx.onSyncStatusChange?.((data: unknown) => {
      const payload = data as { status?: string; message?: string }
      setState((s) => ({
        ...s,
        sync: {
          status: payload.status ?? 'starting',
          message: payload.message ?? '',
        },
      }))
    })

    const offUpdate = crx.onUpdateAvailable?.((data: unknown) => {
      const payload = data as { version?: string }
      if (payload.version) {
        setState((s) => ({ ...s, updateAvailable: payload.version ?? null }))
      }
    })

    const offDownloaded = crx.onUpdateDownloaded?.((data: unknown) => {
      const payload = data as { version?: string }
      if (payload.version) {
        setState((s) => ({ ...s, updateDownloaded: payload.version ?? null }))
      }
    })

    return () => {
      cancelled = true
      offSync?.()
      offUpdate?.()
      offDownloaded?.()
    }
  }, [])

  const triggerManualSync = useCallback(async () => {
    await readDesktopBridge()?.triggerManualSync?.()
  }, [])

  const restartToUpdate = useCallback(async () => {
    await readDesktopBridge()?.restartToUpdate?.()
  }, [])

  return { ...state, triggerManualSync, restartToUpdate }
}
