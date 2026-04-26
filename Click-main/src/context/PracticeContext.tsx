import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

interface Practice {
  id: string
  name: string
  timezone: string
}

interface PracticeContextValue {
  practices: Practice[]
  practiceId: string
  practice: Practice | null
  setPracticeId: (id: string) => void
  loading: boolean
}

const PracticeContext = createContext<PracticeContextValue>({
  practices: [],
  practiceId: '',
  practice: null,
  setPracticeId: () => {},
  loading: true,
})

export function PracticeProvider({ children }: { children: ReactNode }) {
  const [practices, setPractices] = useState<Practice[]>([])
  const [practiceId, setPracticeId] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/practices')
      .then(r => r.ok ? r.json() : Promise.reject('API error'))
      .then((data) => {
        if (Array.isArray(data)) {
          setPractices(data)
          if (data.length > 0) setPracticeId(data[0].id)
        }
      })
      .catch(err => console.error('Failed to load practices:', err))
      .finally(() => setLoading(false))
  }, [])

  const practice = practices.find(p => p.id === practiceId) ?? null

  return (
    <PracticeContext.Provider value={{ practices, practiceId, practice, setPracticeId, loading }}>
      {children}
    </PracticeContext.Provider>
  )
}

export function usePractice() {
  return useContext(PracticeContext)
}
