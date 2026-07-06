import { Navigate } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { HOME_ROUTE, type UserRole } from '../types/userRole'
import type { PracticeRole } from '../lib/authTypes'
import { LoadingSpinner } from './ui'

interface ProtectedRouteProps {
  /**
   * Grants access when it matches EITHER the brief persona (UserRole) or the
   * raw session role (PracticeRole). Raw roles matter because several
   * practice roles collapse to a shared persona (office_manager,
   * billing_coordinator, associate_dentist → practice_owner; accountant →
   * auditor), so persona-only matching can never see them.
   */
  allowedRoles: Array<UserRole | PracticeRole>
  children: React.ReactNode
}

type PracticeCtx = ReturnType<typeof usePractice>

export function resolveUserRole(ctx: PracticeCtx): UserRole | null {
  return ctx.userRole
}

export function resolveIsReadOnly(ctx: PracticeCtx, _userRole: UserRole | null): boolean {
  return ctx.isReadOnly
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { loading, authState, userRole, role } = usePractice()

  if (loading || authState === 'loading') {
    return <LoadingSpinner fullPage label="Checking access…" />
  }

  if (authState === 'anon' || !userRole) {
    return <Navigate to="/login" replace />
  }

  const allowed = allowedRoles.some((r) => r === userRole || r === role)
  if (!allowed) {
    return <Navigate to={HOME_ROUTE[userRole]} replace />
  }

  return <>{children}</>
}
