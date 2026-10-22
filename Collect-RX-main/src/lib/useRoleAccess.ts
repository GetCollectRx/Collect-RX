import { usePractice } from '../context/PracticeContext'
import type { AuthRole } from './authTypes'

export interface RoleAccess {
  // Nav visibility
  canViewDashboard: boolean
  canViewWorkQueue: boolean
  canViewInsurance: boolean
  canViewAnalytics: boolean
  canViewCdcp: boolean
  canViewAdmin: boolean
  canViewGuide: boolean
  canViewBilling: boolean
  canViewGroupDashboard: boolean
  // Action capabilities
  canInitiateCalls: boolean
  canEscalateCalls: boolean
  canEditCarrierConfig: boolean
  canManageUsers: boolean
  canEditAdmin: boolean
  canPauseClaims: boolean
  canResolveEscalations: boolean
  canTakeOverCall: boolean
  /** Mark practice gates complete (owner/manager/coordinator; not accountant). */
  canClearGates: boolean
  /** See live call strip + queue stats on dashboard (read-only loop). */
  canViewLiveLoop: boolean
  /** Approve/skip claims at the pre-dispatch human checkpoint (RDC-SO / PHIPA). */
  canApproveDispatchBatch: boolean
  // Special modes
  isReadOnly: boolean // practice_owner, accountant — blocks settings edits & manual dials
  // Default landing route after login
  homeRoute: string
}

const deskOperator = {
  canPauseClaims: true,
  canResolveEscalations: true,
  canTakeOverCall: true,
} as const

const noDeskOps = {
  canPauseClaims: false,
  canResolveEscalations: false,
  canTakeOverCall: false,
} as const

const gateOperator = {
  canClearGates: true,
  canViewLiveLoop: true,
} as const

const noGateOps = {
  canClearGates: false,
  canViewLiveLoop: false,
} as const

function accessForRole(role: AuthRole | null): RoleAccess {
  switch (role) {
    case 'platform_dev':
      return {
        canViewDashboard: true, canViewWorkQueue: true, canViewInsurance: true,
        canViewAnalytics: true, canViewCdcp: false,
        canViewAdmin: true, canViewGuide: true, canViewBilling: false, canViewGroupDashboard: true,
        canInitiateCalls: true, canEscalateCalls: true,
        canEditCarrierConfig: true, canManageUsers: false, canEditAdmin: true,
        ...noDeskOps,
        ...gateOperator,
        canApproveDispatchBatch: false,
        isReadOnly: false,
        homeRoute: '/admin',
      }

    case 'practice_owner':
      return {
        canViewDashboard: true, canViewWorkQueue: true, canViewInsurance: true,
        canViewAnalytics: true, canViewCdcp: true,
        canViewAdmin: true, canViewGuide: true, canViewBilling: true, canViewGroupDashboard: false,
        canInitiateCalls: false, canEscalateCalls: false,
        canEditCarrierConfig: false, canManageUsers: true, canEditAdmin: false,
        ...noDeskOps,
        canResolveEscalations: true,
        ...gateOperator,
        canApproveDispatchBatch: true,
        isReadOnly: true,
        homeRoute: '/dashboard',
      }

    case 'office_manager':
      return {
        canViewDashboard: true, canViewWorkQueue: true, canViewInsurance: true,
        canViewAnalytics: true, canViewCdcp: true,
        canViewAdmin: true, canViewGuide: true, canViewBilling: true, canViewGroupDashboard: false,
        canInitiateCalls: true, canEscalateCalls: true,
        canEditCarrierConfig: true, canManageUsers: true, canEditAdmin: true,
        ...noDeskOps,
        canResolveEscalations: true,
        ...gateOperator,
        canApproveDispatchBatch: true,
        isReadOnly: false,
        homeRoute: '/dashboard',
      }

    case 'billing_coordinator':
      return {
        canViewDashboard: true, canViewWorkQueue: true, canViewInsurance: true,
        canViewAnalytics: true, canViewCdcp: true,
        canViewAdmin: false, canViewGuide: true, canViewBilling: false, canViewGroupDashboard: false,
        canInitiateCalls: true, canEscalateCalls: true,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        ...noDeskOps,
        canResolveEscalations: true,
        ...gateOperator,
        canApproveDispatchBatch: true,
        isReadOnly: false,
        homeRoute: '/dashboard',
      }

    case 'associate_dentist':
      return {
        canViewDashboard: true, canViewWorkQueue: true, canViewInsurance: true,
        canViewAnalytics: true, canViewCdcp: false,
        canViewAdmin: false, canViewGuide: true, canViewBilling: false, canViewGroupDashboard: false,
        canInitiateCalls: false, canEscalateCalls: false,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        ...noDeskOps,
        canClearGates: false,
        canViewLiveLoop: true,
        canApproveDispatchBatch: false,
        isReadOnly: true,
        homeRoute: '/dashboard',
      }

    case 'accountant':
      return {
        canViewDashboard: true, canViewWorkQueue: false, canViewInsurance: false,
        canViewAnalytics: true, canViewCdcp: false,
        canViewAdmin: false, canViewGuide: false, canViewBilling: true, canViewGroupDashboard: true,
        canInitiateCalls: false, canEscalateCalls: false,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        ...noDeskOps,
        ...noGateOps,
        canApproveDispatchBatch: false,
        isReadOnly: true,
        homeRoute: '/reports/aging',
      }

    case 'front_desk':
      return {
        canViewDashboard: false, canViewWorkQueue: false, canViewInsurance: false,
        canViewAnalytics: false, canViewCdcp: false,
        canViewAdmin: false, canViewGuide: false, canViewBilling: false, canViewGroupDashboard: false,
        canInitiateCalls: false, canEscalateCalls: true,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        ...deskOperator,
        ...gateOperator,
        canApproveDispatchBatch: true,
        isReadOnly: false,
        homeRoute: '/console',
      }

    case 'group_admin':
      return {
        canViewDashboard: true, canViewWorkQueue: false, canViewInsurance: false,
        canViewAnalytics: true, canViewCdcp: false,
        canViewAdmin: false, canViewGuide: false, canViewBilling: true, canViewGroupDashboard: true,
        canInitiateCalls: false, canEscalateCalls: false,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        ...noDeskOps,
        canResolveEscalations: true,
        ...noGateOps,
        canApproveDispatchBatch: false,
        isReadOnly: true,
        homeRoute: '/group-dashboard',
      }

    default:
      return {
        canViewDashboard: false, canViewWorkQueue: false, canViewInsurance: false,
        canViewAnalytics: false, canViewCdcp: false,
        canViewAdmin: false, canViewGuide: false, canViewBilling: false, canViewGroupDashboard: false,
        canInitiateCalls: false, canEscalateCalls: false,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        ...noDeskOps,
        ...noGateOps,
        canApproveDispatchBatch: false,
        isReadOnly: true,
        homeRoute: '/login',
      }
  }
}

export function useRoleAccess(): RoleAccess {
  const { role } = usePractice()
  return accessForRole(role)
}
