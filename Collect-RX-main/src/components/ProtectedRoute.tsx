import { Navigate } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { HOME_ROUTE, isReadOnlyRole, type UserRole } from '../types/userRole'
import { LoadingSpinner } from './ui'

interface ProtectedRouteProps {
  allowedRoles: UserRole[]
  children: React.ReactNode
}

type PracticeCtx = ReturnType<typeof usePractice>

export function resolveUserRole(ctx: PracticeCtx): UserRole | null {
  return ctx.userRole
}

export function resolveIsReadOnly(ctx: PracticeCtx, userRole: UserRole | null): boolean {
  if (ctx.isReadOnly) return true
  return userRole ? isReadOnlyRole(userRole) : false
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
