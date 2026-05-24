import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { parseApiJson } from '../lib/parseApiJson'
import type { AuthRole, PracticeRole } from '../lib/authTypes'
import { isPracticeRole } from '../lib/authTypes'
import { authRoleToBriefPersona } from '../lib/personaRole'
import type { UserRole } from '../types/userRole'
import { isReadOnlyRole } from '../types/userRole'
import { configureApiSession } from '../lib/practiceScopedApi'

interface Practice {
  id: string
  name: string
  timezone: string
}

export interface SessionUser {
  id: string
  email: string
  displayName: string
  role: PracticeRole
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
  role: AuthRole | null
  userRole: UserRole | null
  deskRole: 'owner' | 'front_desk' | null
  isReadOnly: boolean
  phiAccess: boolean
  isPlatformDev: boolean
  isFrontDesk: boolean
  isPracticeOwner: boolean
  subscription: SubscriptionGate
  sessionUser: SessionUser | null
  login: (email: string, password: string) => Promise<void>
  loginPlatformDev: (password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

const PracticeContext = createContext<PracticeContextValue | null>(null)

type MeResponse = {
  role?: AuthRole
  userRole?: UserRole
  deskRole?: 'owner' | 'front_desk'
  phiAccess?: boolean
  practice?: Practice
  practices?: Practice[]
  subscription?: SubscriptionGate
  user?: SessionUser
}

function applySessionConfig(role: AuthRole | null, practiceId: string) {
  configureApiSession(role, practiceId)
}

function clearState(
  setters: {
    setPractices: (v: Practice[]) => void
    setPracticeId: (v: string) => void
    setRole: (v: AuthRole | null) => void
    setPhiAccess: (v: boolean) => void
    setSessionUser: (v: SessionUser | null) => void
    setSubscription: (v: SubscriptionGate) => void
    setAuthState: (v: AuthState) => void
  },
  authState: AuthState = 'anon',
) {
  setters.setPractices([])
  setters.setPracticeId('')
  setters.setRole(null)
  setters.setPhiAccess(false)
  setters.setSessionUser(null)
  applySessionConfig(null, '')
  setters.setSubscription(defaultSubscription)
  setters.setAuthState(authState)
}

export function PracticeProvider({ children }: { children: ReactNode }) {
  const [practices, setPractices] = useState<Practice[]>([])
  const [practiceId, setPracticeId] = useState('')
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [role, setRole] = useState<AuthRole | null>(null)
  const [phiAccess, setPhiAccess] = useState(false)
  const [subscription, setSubscription] = useState<SubscriptionGate>(defaultSubscription)
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)

  const loading = authState === 'loading'
  const userRole = authRoleToBriefPersona(role)
  const isPlatformDevFlag = role === 'platform_dev'
  const isFrontDesk = userRole === 'front_desk'
  const isPracticeOwner = userRole === 'practice_owner'
  const isReadOnly = userRole ? isReadOnlyRole(userRole) || role === 'practice_owner' || role === 'associate_dentist' || role === 'accountant' : false
  const deskRole: 'owner' | 'front_desk' | null = userRole === 'front_desk' ? 'front_desk' : userRole === 'practice_owner' ? 'owner' : null

  const stateSetters = { setPractices, setPracticeId, setRole, setPhiAccess, setSessionUser, setSubscription, setAuthState }

  const logout = useCallback(async () => {
    await fetch(resolveApiUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' })
    clearState(stateSetters)
  }, [])

  useEffect(() => {
    const onExpired = () => { void logout() }
    window.addEventListener('crx:session-expired', onExpired)
    return () => window.removeEventListener('crx:session-expired', onExpired)
  }, [logout])

  const refreshSession = useCallback(async () => {
    const r = await fetch(resolveApiUrl('/api/auth/me'), { credentials: 'include' })
    if (r.status === 401) { clearState(stateSetters); return }
    let data: MeResponse
    try {
      data = await parseApiJson<MeResponse>(r)
    } catch {
      clearState(stateSetters); return
    }
    if (!r.ok) { clearState(stateSetters); return }

    const sessionRole = data.role ?? (data.userRole === 'platform_admin' ? 'platform_dev' : null)
    setRole(sessionRole)
    setPhiAccess(data.phiAccess === true)
    setSubscription({ ...defaultSubscription, ...(data.subscription ?? {}) })

    if (sessionRole === 'platform_dev') {
      const list = data.practices ?? []
      setPractices(list)
      let pid = ''
      try { pid = localStorage.getItem('crx_dev_practice_id') ?? '' } catch { /* ignore */ }
      if (!pid || !list.some((p) => p.id === pid)) pid = list[0]?.id ?? ''
      setPracticeId(pid)
      if (pid) { try { localStorage.setItem('crx_dev_practice_id', pid) } catch { /* ignore */ } }
      applySessionConfig('platform_dev', pid)
      setSessionUser(null)
      setAuthState('ready')
      return
    }

    if (!data.practice?.id) { setAuthState('anon'); return }
    try { localStorage.setItem('crx_last_practice_id', data.practice.id) } catch { /* ignore */ }
    setPractices(data.practices?.length ? data.practices : [data.practice])
    setPracticeId(data.practice.id)
    applySessionConfig(sessionRole, data.practice.id)
    setSessionUser(data.user ?? null)
    setAuthState('ready')
  }, [])

  useEffect(() => {
    void refreshSession().catch(() => { setAuthState('anon') })
  }, [refreshSession])

  useEffect(() => {
    if (role === 'platform_dev' && practiceId) {
      try { localStorage.setItem('crx_dev_practice_id', practiceId) } catch { /* ignore */ }
      applySessionConfig('platform_dev', practiceId)
    }
  }, [role, practiceId])

  async function login(email: string, password: string) {
    const r = await fetch(resolveApiUrl('/api/auth/login'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!r.ok) {
      let message = 'Login failed'
      try {
        const errBody = await parseApiJson<{ error?: string }>(r)
        if (typeof errBody === 'object' && errBody !== null && typeof errBody.error === 'string') {
          message = errBody.error
        }
      } catch {
        message = 'Server returned a non-JSON response — check COLLECTRX_API_ORIGIN / Vite proxy / PORT.'
      }
      throw new Error(message)
    }
    let data: MeResponse
    try {
      data = await parseApiJson<MeResponse>(r)
    } catch {
      throw new Error('Server returned a non-JSON response — check COLLECTRX_API_ORIGIN / Vite proxy / PORT.'
      )
    }
    if (!data?.practice?.id) throw new Error('Invalid login response')

    const sessionRole: AuthRole = isPracticeRole(data.role ?? null) ? (data.role as PracticeRole) : 'practice_owner'
    try { localStorage.setItem('crx_last_practice_id', data.practice.id) } catch { /* ignore */ }
    setRole(sessionRole)
    setPhiAccess(data.phiAccess === true)
    setPractices([data.practice])
    setPracticeId(data.practice.id)
    setSessionUser(data.user ?? null)
    applySessionConfig(sessionRole, data.practice.id)
    setSubscription({ ...defaultSubscription, ...(data.subscription ?? {}) })
    setAuthState('ready')
  }

  async function loginPlatformDev(password: string) {
    const r = await fetch(resolveApiUrl('/api/auth/login/platform-dev'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!r.ok) {
      let message = 'Invalid platform developer password'
      try {
        const errBody = await parseApiJson<{ error?: string }>(r)
        if (typeof errBody === 'object' && errBody !== null && typeof errBody.error === 'string') {
          message = errBody.error
        }
      } catch {
        message = 'Server returned a non-JSON response — check COLLECTRX_API_ORIGIN / Vite proxy / PORT.'
      }
      throw new Error(message)
    }
    let data: MeResponse
    try {
      data = await parseApiJson<MeResponse>(r)
    } catch {
      throw new Error('Server returned a non-JSON response — check COLLECTRX_API_ORIGIN / Vite proxy / PORT.')
    }
    const list = data.practices ?? []
    if (list.length === 0) throw new Error('No practices in database — seed a practice first')
    const pid = list[0]!.id
    setRole('platform_dev')
    setPhiAccess(false)
    setPractices(list)
    setPracticeId(pid)
    setSessionUser(null)
    try { localStorage.setItem('crx_dev_practice_id', pid) } catch { /* ignore */ }
    applySessionConfig('platform_dev', pid)
    setSubscription({ ...defaultSubscription, ...(data.subscription ?? {}) })
    setAuthState('ready')
  }

  const practice = practices.find((p) => p.id === practiceId) ?? null

  const value = useMemo(
    () => ({
      practices,
      practiceId,
      practice,
      setPracticeId,
      loading,
      authState,
      role,
      userRole,
      deskRole,
      isReadOnly,
      phiAccess,
      isPlatformDev: isPlatformDevFlag,
      isFrontDesk,
      isPracticeOwner,
      subscription,
      sessionUser,
      login,
      loginPlatformDev,
      logout,
      refreshSession,
    }),
    [
      practices, practiceId, practice, loading, authState, role, userRole, deskRole,
      isReadOnly, phiAccess, isPlatformDevFlag, isFrontDesk, isPracticeOwner,
      subscription, sessionUser, logout, refreshSession,
    ],
  )

  return (
    <PracticeContext.Provider value={value}>
      {children}
    </PracticeContext.Provider>
  )
}

export function usePractice() {
  const v = useContext(PracticeContext)
  if (!v) throw new Error('usePractice must be used within PracticeProvider')
  return v
}
