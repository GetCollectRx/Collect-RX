import { Navigate, useLocation } from 'react-router-dom'

/** @deprecated Use /insurance?tab=queue — kept for backwards-compatible imports. */
export default function WorkQueue() {
  const location = useLocation()
  const search = location.search.includes('tab=') ? location.search : '?tab=queue'
  return <Navigate to={`/insurance${search}`} replace />
}
