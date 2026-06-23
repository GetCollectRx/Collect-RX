import type { ReactNode } from 'react'
import { usePractice } from '../context/PracticeContext'
import { AnalyticsProvider } from './AnalyticsProvider'
import { TelemetryRouteTracker } from './TelemetryRouteTracker'

/** Wires JWT session into the product telemetry SDK after login. */
export function AnalyticsSessionBridge({ children }: { children: ReactNode }) {
  const { authState, sessionUser, userRole, practiceId, role } = usePractice()

  const analyticsUser =
    authState === 'ready' && sessionUser
      ? {
          userId: sessionUser.id,
          role: String(userRole ?? role ?? 'unknown'),
          practiceId,
        }
      : null

  return (
    <AnalyticsProvider user={analyticsUser}>
      {authState === 'ready' ? <TelemetryRouteTracker /> : null}
      {children}
    </AnalyticsProvider>
  )
}
