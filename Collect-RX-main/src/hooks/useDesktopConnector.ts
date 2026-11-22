import { useCallback, useEffect, useState } from 'react'

export interface DesktopConnectorState {
  isDesktop: boolean
  appVersion: string | null
  updateAvailable: string | null
  updateDownloaded: string | null
}

const INITIAL: DesktopConnectorState = {
  isDesktop: false,
  appVersion: null,
  updateAvailable: null,
  updateDownloaded: null,
}

function readDesktopBridge(): Window['collectrx'] {
  return typeof window !== 'undefined' ? window.collectrx : undefined
}

export function useDesktopConnector(): DesktopConnectorState & {
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
      offUpdate?.()
      offDownloaded?.()
    }
  }, [])

  const restartToUpdate = useCallback(async () => {
    await readDesktopBridge()?.restartToUpdate?.()
  }, [])

  return { ...state, restartToUpdate }
}
