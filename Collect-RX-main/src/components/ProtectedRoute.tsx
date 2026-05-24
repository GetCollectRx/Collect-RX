import { Navigate } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { HOME_ROUTE, type UserRole } from '../types/userRole'
import { LoadingSpinner } from './ui'

interface ProtectedRouteProps {
  allowedRoles: UserRole[]
  children: React.ReactNode
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { loading, authState, userRole } = usePractice()

  if (loading || authState === 'loading') {
    return <LoadingSpinner fullPage label="Checking access…" />
  }

  if (authState === 'anon' || !userRole) {
    return <Navigate to="/login" replace />
  }

  if (!allowedRoles.includes(userRole)) {
    return <Navigate to={HOME_ROUTE[userRole]} replace />
  }

  return <>{children}</>
}
