import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveApiUrl } from '../lib/resolveApiUrl'

export type StartupStepId = 'connect' | 'api' | 'services' | 'workspace'

export type StartupStepStatus = 'pending' | 'running' | 'done' | 'error'

export type StartupStep = {
  id: StartupStepId
  label: string
  status: StartupStepStatus
}

const INITIAL_STEPS: StartupStep[] = [
  { id: 'connect', label: 'Connecting to CollectRx', status: 'pending' },
  { id: 'api', label: 'API online', status: 'pending' },
  { id: 'services', label: 'Services ready', status: 'pending' },
  { id: 'workspace', label: 'Loading your workspace', status: 'pending' },
]

async function fetchOk(path: string, timeoutMs = 8000): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(resolveApiUrl(path), { signal: ctrl.signal, credentials: 'include' })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

export function useStartupHealth(authReady: boolean) {
  const [steps, setSteps] = useState<StartupStep[]>(INITIAL_STEPS)
  const [phase, setPhase] = useState<'checking' | 'ready'>('checking')
  const started = useRef(false)

  const patchStep = useCallback((id: StartupStepId, status: StartupStepStatus) => {
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, status } : s)))
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true

    void (async () => {
      patchStep('connect', 'running')
      await new Promise(r => setTimeout(r, 280))
      patchStep('connect', 'done')

      patchStep('api', 'running')
      const apiOk = await fetchOk('/api/health')
      patchStep('api', apiOk ? 'done' : 'error')

      patchStep('services', 'running')
      const readyOk = apiOk ? await fetchOk('/api/health/ready') : false
      patchStep('services', readyOk ? 'done' : 'error')

      patchStep('workspace', 'running')
    })()
  }, [patchStep])

  useEffect(() => {
    if (!authReady) return
    patchStep('workspace', 'done')
  }, [authReady, patchStep])

  useEffect(() => {
    if (phase !== 'checking') return
    const workspace = steps.find(s => s.id === 'workspace')
    const prior = steps.filter(s => s.id !== 'workspace')
    const priorSettled = prior.every(s => s.status === 'done' || s.status === 'error')
    if (priorSettled && workspace?.status === 'done') {
      setPhase('ready')
    }
  }, [steps, phase])

  const progress = steps.reduce((acc, s) => {
    if (s.status === 'done') return acc + 25
    if (s.status === 'running') return acc + 10
    if (s.status === 'error') return acc + 20
    return acc
  }, 0)

  return { steps, phase, progress: Math.min(progress, 100) }
}
