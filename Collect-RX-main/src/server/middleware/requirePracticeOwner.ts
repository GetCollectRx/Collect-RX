import type { Request, Response, NextFunction } from 'express';
import { isFrontDesk } from '../accessControl/types.js';

/**
 * Blocks front_desk sessions from owner-only analytics, settings, and admin
 * APIs. Despite the name, this does NOT require the literal practice_owner
 * role — it allows every non-front-desk PracticeRole through, including
 * practice_owner, office_manager, billing_coordinator, etc. That's correct
 * for read routes (adminRoutes.ts's canViewAdmin is broader than who can
 * edit), but too permissive to also gate writes with — see
 * requireCanEditPracticeAdmin below for that.
 */
export function requirePracticeOwner(req: Request, res: Response, next: NextFunction): void {
  const auth = req.auth ?? req.practiceAuth;
  if (isFrontDesk(auth)) {
    res.status(403).json({ success: false, error: 'This action requires practice owner access' });
    return;
  }
  next();
}

/**
 * Gates admin *write* endpoints (carrier config, practice identity) to the
 * roles src/lib/useRoleAccess.ts's canEditAdmin/canEditCarrierConfig
 * actually grant that to: platform_dev and office_manager. Everyone else —
 * including practice_owner, who useRoleAccess.ts marks isReadOnly: true —
 * was previously able to write here because the router only applied
 * requirePracticeOwner (blocks front_desk only) to every route, GET and
 * write alike. Reproduced live: a practice_owner session's "Save identity"
 * / "Save carrier settings" buttons on /admin/integrations both returned
 * 200 {"ok":true}, silently accepting writes the practice_owner-facing
 * /settings page's own "Read-only view, changes are disabled" banner says
 * are disabled for that exact role. Checks the raw PracticeRole
 * (auth.role), not the brief UserRole persona getUserRole()/isPracticeOwner()
 * return — practiceRoleToBrief() collapses office_manager into the
 * 'practice_owner' brief persona for coarse routing, which would
 * incorrectly block real office managers if used here.
 */
export function requireCanEditPracticeAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.auth ?? req.practiceAuth;
  if (auth?.role === 'platform_dev' || auth?.role === 'office_manager') {
    next();
    return;
  }
  res.status(403).json({ success: false, error: 'This action requires office manager access' });
}
