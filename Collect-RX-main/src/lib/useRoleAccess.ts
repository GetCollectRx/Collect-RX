import { usePractice } from '../context/PracticeContext'
import type { AuthRole } from './authTypes'

export interface RoleAccess {
  // Nav visibility
  canViewDashboard: boolean
  canViewWorkQueue: boolean
  canViewInsurance: boolean
  canViewBalances: boolean
  canViewPatientAR: boolean
  canViewEstimate: boolean
  canViewAnalytics: boolean
  canViewOutbox: boolean
  canViewCdcp: boolean
  canViewAdmin: boolean
  canViewGuide: boolean
  canViewBilling: boolean
  canViewGroupDashboard: boolean
  // Action capabilities
  canInitiateCalls: boolean
  canEscalateCalls: boolean
  canSendReminders: boolean
  canEditCarrierConfig: boolean
  canManageUsers: boolean
  canEditAdmin: boolean
  // Special modes
  isPatientLookupOnly: boolean  // front_desk
  isReadOnly: boolean           // practice_owner, accountant
  // Default landing route after login
  homeRoute: string
}

function accessForRole(role: AuthRole | null): RoleAccess {
  switch (role) {
    case 'platform_dev':
      return {
        canViewDashboard: true, canViewWorkQueue: true, canViewInsurance: true,
        canViewBalances: false, canViewPatientAR: false, canViewEstimate: false,
        canViewAnalytics: true, canViewOutbox: false, canViewCdcp: false,
        canViewAdmin: true, canViewGuide: true, canViewBilling: false, canViewGroupDashboard: true,
        canInitiateCalls: true, canEscalateCalls: true, canSendReminders: false,
        canEditCarrierConfig: true, canManageUsers: false, canEditAdmin: true,
        isPatientLookupOnly: false, isReadOnly: false,
        homeRoute: '/',
      }

    case 'practice_owner':
      return {
        canViewDashboard: true, canViewWorkQueue: true, canViewInsurance: true,
        canViewBalances: true, canViewPatientAR: true, canViewEstimate: true,
        canViewAnalytics: true, canViewOutbox: true, canViewCdcp: true,
        canViewAdmin: true, canViewGuide: true, canViewBilling: true, canViewGroupDashboard: false,
        canInitiateCalls: false, canEscalateCalls: false, canSendReminders: false,
        canEditCarrierConfig: false, canManageUsers: true, canEditAdmin: false,
        isPatientLookupOnly: false, isReadOnly: true,
        homeRoute: '/',
      }

    case 'office_manager':
      return {
        canViewDashboard: true, canViewWorkQueue: true, canViewInsurance: true,
        canViewBalances: true, canViewPatientAR: true, canViewEstimate: true,
        canViewAnalytics: true, canViewOutbox: true, canViewCdcp: true,
        canViewAdmin: true, canViewGuide: true, canViewBilling: true, canViewGroupDashboard: false,
        canInitiateCalls: true, canEscalateCalls: true, canSendReminders: true,
        canEditCarrierConfig: true, canManageUsers: true, canEditAdmin: true,
        isPatientLookupOnly: false, isReadOnly: false,
        homeRoute: '/',
      }

    case 'billing_coordinator':
      return {
        canViewDashboard: true, canViewWorkQueue: true, canViewInsurance: true,
        canViewBalances: true, canViewPatientAR: true, canViewEstimate: true,
        canViewAnalytics: true, canViewOutbox: true, canViewCdcp: true,
        canViewAdmin: false, canViewGuide: true, canViewBilling: false, canViewGroupDashboard: false,
        canInitiateCalls: true, canEscalateCalls: true, canSendReminders: true,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        isPatientLookupOnly: false, isReadOnly: false,
        homeRoute: '/',
      }

    case 'associate_dentist':
      return {
        canViewDashboard: true, canViewWorkQueue: true, canViewInsurance: true,
        canViewBalances: false, canViewPatientAR: true, canViewEstimate: true,
        canViewAnalytics: true, canViewOutbox: false, canViewCdcp: false,
        canViewAdmin: false, canViewGuide: true, canViewBilling: false, canViewGroupDashboard: false,
        canInitiateCalls: false, canEscalateCalls: false, canSendReminders: false,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        isPatientLookupOnly: false, isReadOnly: true,
        homeRoute: '/',
      }

    case 'accountant':
      return {
        canViewDashboard: true, canViewWorkQueue: false, canViewInsurance: false,
        canViewBalances: false, canViewPatientAR: false, canViewEstimate: false,
        canViewAnalytics: true, canViewOutbox: false, canViewCdcp: false,
        canViewAdmin: false, canViewGuide: false, canViewBilling: true, canViewGroupDashboard: true,
        canInitiateCalls: false, canEscalateCalls: false, canSendReminders: false,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        isPatientLookupOnly: false, isReadOnly: true,
        homeRoute: '/reports/aging',
      }

    case 'front_desk':
      return {
        canViewDashboard: false, canViewWorkQueue: false, canViewInsurance: false,
        canViewBalances: false, canViewPatientAR: false, canViewEstimate: false,
        canViewAnalytics: false, canViewOutbox: false, canViewCdcp: false,
        canViewAdmin: false, canViewGuide: false, canViewBilling: false, canViewGroupDashboard: false,
        canInitiateCalls: false, canEscalateCalls: true, canSendReminders: true,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        isPatientLookupOnly: false, isReadOnly: false,
        homeRoute: '/console',
      }

    case 'group_admin':
      return {
        canViewDashboard: true, canViewWorkQueue: false, canViewInsurance: false,
        canViewBalances: false, canViewPatientAR: false, canViewEstimate: false,
        canViewAnalytics: true, canViewOutbox: false, canViewCdcp: false,
        canViewAdmin: false, canViewGuide: false, canViewBilling: true, canViewGroupDashboard: true,
        canInitiateCalls: false, canEscalateCalls: false, canSendReminders: false,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        isPatientLookupOnly: false, isReadOnly: true,
        homeRoute: '/portfolio',
      }

    default:
      return {
        canViewDashboard: false, canViewWorkQueue: false, canViewInsurance: false,
        canViewBalances: false, canViewPatientAR: false, canViewEstimate: false,
        canViewAnalytics: false, canViewOutbox: false, canViewCdcp: false,
        canViewAdmin: false, canViewGuide: false, canViewBilling: false, canViewGroupDashboard: false,
        canInitiateCalls: false, canEscalateCalls: false, canSendReminders: false,
        canEditCarrierConfig: false, canManageUsers: false, canEditAdmin: false,
        isPatientLookupOnly: false, isReadOnly: true,
        homeRoute: '/login',
      }
  }
}

export function useRoleAccess(): RoleAccess {
  const { role } = usePractice()
  return accessForRole(role)
}
