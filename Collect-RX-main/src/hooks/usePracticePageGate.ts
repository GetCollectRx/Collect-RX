import { usePractice } from '../context/PracticeContext'

/**
 * Avoids infinite "Loading…" when auth is ready but practiceId is still empty.
 * Use with DataState: loading={pageBusy(fetching)} error={pageError(fetchError)}
 */
export function usePracticePageGate() {
  const { practiceId, loading: practiceLoading, authState } = usePractice()
  const authLoading = practiceLoading || authState === 'loading'
  const missingPractice = authState === 'ready' && !practiceId

  function pageBusy(fetching: boolean): boolean {
    if (authLoading) return true
    if (missingPractice) return false
    return fetching
  }

  function pageError(fetchError: string | null): string | null {
    if (missingPractice) {
      return 'This account is not linked to a practice. Sign out and sign in again, or contact support.'
    }
    return fetchError
  }

  return {
    practiceId,
    authLoading,
    missingPractice,
    canFetch: Boolean(practiceId) && !authLoading,
    pageBusy,
    pageError,
  }
}
