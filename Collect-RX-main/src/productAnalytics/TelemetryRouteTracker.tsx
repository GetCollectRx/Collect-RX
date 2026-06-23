import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { analytics } from './analytics'

/** Records SPA navigations for time-on-page telemetry. */
export function TelemetryRouteTracker() {
  const location = useLocation()

  useEffect(() => {
    analytics.trackPageChange(location.pathname)
  }, [location.pathname])

  return null
}
