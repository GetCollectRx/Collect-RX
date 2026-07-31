/// <reference types="vite/client" />

declare global {
  interface Window {
    collectrx?: {
      apiOrigin?: string
      getSyncStatus: () => Promise<unknown>
      onSyncStatusChange: (cb: (data: unknown) => void) => () => void
      triggerManualSync: () => Promise<unknown>
      getAppVersion: () => Promise<unknown>
      onUpdateAvailable?: (cb: (data: unknown) => void) => () => void
      onUpdateDownloaded?: (cb: (data: unknown) => void) => () => void
      restartToUpdate?: () => Promise<unknown>
      retryDashboardLoad?: () => Promise<unknown>
    }
  }
}

interface ImportMetaEnv {
  /** Optional absolute origin for /api (no trailing slash); dev desktop → remote API */
  readonly VITE_API_ORIGIN?: string
  readonly VITE_APP_SURFACE?: 'full' | 'marketing' | 'app' | 'desktop'
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '*.png' {
  const content: string;
  export default content;
}

declare module '*.jpg' {
  const content: string;
  export default content;
}

export {}
