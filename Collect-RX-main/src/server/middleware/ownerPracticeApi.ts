import type { Router } from 'express';
import { authenticate } from './authenticate.js';
import { requirePracticeContext } from './requirePracticeSession.js';
import { requirePracticeOwner } from './requirePracticeOwner.js';

/**
 * Standard middleware for practice APIs that front desk must not call.
 * Platform dev and practice owner sessions pass; `deskRole: front_desk` → 403.
 */
export function useOwnerPracticeApi(router: Router): void {
  router.use(authenticate);
  router.use(requirePracticeContext);
  router.use(requirePracticeOwner);
}

/** Owner-only routes that only use `authenticate` (legacy routers). */
export function useOwnerPracticeApiAuthOnly(router: Router): void {
  router.use(authenticate);
  router.use(requirePracticeOwner);
}
