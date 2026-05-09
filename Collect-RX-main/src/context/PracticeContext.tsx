import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

interface Practice {
  id: string
  name: string
  timezone: string
}

export type SubscriptionGate = {
  enforce: boolean
  active: boolean
  status: string | null
  currentPeriodEnd: string | null
  priceConfigured: boolean
  skipped: boolean
}

const defaultSubscription: SubscriptionGate = {
  enforce: false,
  active: true,
  status: null,
  currentPeriodEnd: null,
  priceConfigured: false,
  skipped: false,
}

export type AuthState = 'loading' | 'anon' | 'ready'

interface PracticeContextValue {
  practices: Practice[]
  practiceId: string
  practice: Practice | null
  setPracticeId: (id: string) => void
  loading: boolean
  authState: AuthState
  subscription: SubscriptionGate
  login: (practiceId: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

const PracticeContext = createContext<PracticeContextValue | null>(null)

export function PracticeProvider({ children }: { children: ReactNode }) {
  const [practices, setPractices] = useState<Practice[]>([])
  const [practiceId, setPracticeId] = useState('')
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [subscription, setSubscription] = useState<SubscriptionGate>(defaultSubscription)

  const loading = authState === 'loading'

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    setPractices([])
    setPracticeId('')
    setSubscription(defaultSubscription)
    setAuthState('anon')
  }, [])

  useEffect(() => {
    const onExpired = () => { void logout() }
    window.addEventListener('crx:session-expired', onExpired)
    return () => window.removeEventListener('crx:session-expired', onExpired)
  }, [logout])

  const refreshSession = useCallback(async () => {
    const r = await fetch('/api/auth/me', { credentials: 'include' })
    if (r.status === 401) {
      setPractices([])
      setPracticeId('')
      setSubscription(defaultSubscription)
      setAuthState('anon')
      return
    }
    const data = (await r.json()) as { practice: Practice; subscription?: SubscriptionGate }
    try {
      localStorage.setItem('crx_last_practice_id', data.practice.id)
    } catch {
      /* ignore */
    }
    setPractices([data.practice])
    setPracticeId(data.practice.id)
    setSubscription({ ...defaultSubscription, ...(data.subscription ?? {}) })
    setAuthState('ready')
  }, [])

  useEffect(() => {
    void refreshSession().catch(() => {
      setAuthState('anon')
    })
  }, [refreshSession])

  async function login(id: string, password: string) {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ practiceId: id, password }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error((err as { error?: string }).error || 'Login failed')
    }
    const data = (await r.json()) as { practice: Practice; subscription?: SubscriptionGate }
    try {
      localStorage.setItem('crx_last_practice_id', data.practice.id)
    } catch {
      /* ignore */
    }
    setPractices([data.practice])
    setPracticeId(data.practice.id)
    setSubscription({ ...defaultSubscription, ...(data.subscription ?? {}) })
    setAuthState('ready')
  }

  const practice = practices.find(p => p.id === practiceId) ?? null

  return (
    <PracticeContext.Provider
      value={{
        practices,
        practiceId,
        practice,
        setPracticeId,
        loading,
        authState,
        subscription,
        login,
        logout,
        refreshSession,
      }}
    >
      {children}
    </PracticeContext.Provider>
  )
}

export function usePractice() {
  const v = useContext(PracticeContext)
  if (!v) throw new Error('usePractice must be used within PracticeProvider')
  return v
}
