import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { authorizeRole } from '../middleware/authorizeRole';
import { requirePracticeContext, practiceIdFromSession } from '../middleware/requirePracticeSession';
import { isUserSession, type UserAuthPayload } from '../accessControl/types.js';
import { sendOrganizationInviteEmail } from '../email/organizationInviteEmail.js';
import { appendAuditLog } from '../audit/auditLog.js';
import { formatZodError } from '../validation/zodSchemas.js';
import { setUserAuthCookie } from '../authToken.js';

const INVITE_EXPIRY_MS = 72 * 60 * 60 * 1000;

const createOrgBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
});

const inviteBodySchema = z.object({
  email: z.string().trim().email(),
});

/** True when userId is an org_admin member of organizationId. */
async function isOrgAdminMember(prisma: PrismaClient, organizationId: string, userId: string): Promise<boolean> {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  return membership != null;
}

/**
 * Upgrade a practice_owner to group_admin so they can reach /api/group/* —
 * never downgrades an existing higher role. Reissues the session cookie so
 * the new role takes effect immediately, not only after the next login —
 * authorizeRole() checks the JWT claim, not a live DB read, so a stale
 * cookie would 403 the same request that just earned the upgrade.
 */
async function ensureGroupAdminRole(
  prisma: PrismaClient,
  res: Response,
  userId: string,
  practiceId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user && user.role !== 'group_admin') {
    await prisma.user.update({ where: { id: userId }, data: { role: 'group_admin' } });
    setUserAuthCookie(res, { userId, practiceId, role: 'group_admin' });
  }
}

export function createOrganizationRouter(prisma: PrismaClient): Router {
  const r = Router();
  r.use(authenticate, requirePracticeContext);

  /**
   * POST /api/organizations — create a DSO and attach the caller's own
   * practice. Never attaches any practice the caller doesn't already own.
   */
  r.post('/', authorizeRole('practice_owner'), async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const auth = req.auth!;
      const userId = isUserSession(auth) ? (auth as UserAuthPayload).userId : null;
      if (!userId) return res.status(403).json({ error: 'A practice user session is required' });

      const parsed = createOrgBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });

      const alreadyInOrg = await prisma.organizationPractice.findUnique({ where: { practiceId } });
      if (alreadyInOrg) return res.status(409).json({ error: 'This practice already belongs to a group' });

      const org = await prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({ data: { name: parsed.data.name } });
        await tx.organizationPractice.create({ data: { organizationId: created.id, practiceId } });
        await tx.organizationMember.create({ data: { organizationId: created.id, userId, role: 'org_admin' } });
        return created;
      });
      await ensureGroupAdminRole(prisma, res, userId, practiceId);
      await appendAuditLog(prisma, {
        practiceId,
        userId,
        action: 'organization.create',
        details: { organizationId: org.id, name: org.name },
      });

      return res.status(201).json({ organization: { id: org.id, name: org.name } });
    } catch (e) {
      console.error('organization create error:', e);
      return res.status(500).json({ error: 'Failed to create group' });
    }
  });

  /** GET /api/organizations/mine — groups the caller belongs to, PHI-free. */
  r.get('/mine', async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      const userId = isUserSession(auth) ? (auth as UserAuthPayload).userId : null;
      if (!userId) return res.json({ organizations: [] });

      const memberships = await prisma.organizationMember.findMany({
        where: { userId },
        select: {
          role: true,
          organization: {
            select: {
              id: true,
              name: true,
              practices: { select: { practice: { select: { id: true, name: true } } } },
            },
          },
        },
      });

      const organizations = memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        myRole: m.role,
        practices: m.organization.practices.map((p) => p.practice),
      }));
      return res.json({ organizations });
    } catch (e) {
      console.error('organizations mine error:', e);
      return res.status(500).json({ error: 'Failed to load groups' });
    }
  });

  /**
   * POST /api/organizations/:orgId/invite-practice — invite an existing
   * practice owner by email to attach their own practice. The inviter can
   * never attach a practice on someone else's behalf — only the invited
   * owner's own acceptance creates the OrganizationPractice row.
   */
  r.post('/:orgId/invite-practice', authorizeRole('group_admin'), async (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const auth = req.auth!;
      const userId = isUserSession(auth) ? (auth as UserAuthPayload).userId : null;
      if (!userId) return res.status(403).json({ error: 'A practice user session is required' });
      if (!(await isOrgAdminMember(prisma, orgId, userId))) {
        return res.status(403).json({ error: 'You are not an admin of this group' });
      }

      const parsed = inviteBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });
      const { email } = parsed.data;

      const [org, inviterPractice] = await Promise.all([
        prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
        prisma.practice.findUnique({ where: { id: practiceIdFromSession(req) }, select: { name: true } }),
      ]);
      if (!org) return res.status(404).json({ error: 'Group not found' });

      const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);
      const invite = await prisma.organizationInviteToken.create({
        data: { organizationId: orgId, inviteeEmail: email, createdBy: userId, expiresAt },
        select: { token: true },
      });

      await sendOrganizationInviteEmail({
        toEmail: email,
        organizationName: org.name,
        inviterPracticeName: inviterPractice?.name ?? 'A CollectRx practice',
        token: invite.token,
      });
      await appendAuditLog(prisma, {
        practiceId: practiceIdFromSession(req),
        userId,
        action: 'organization.invite_practice',
        details: { organizationId: orgId, inviteeEmail: email },
      });

      return res.json({ invited: true });
    } catch (e) {
      console.error('organization invite error:', e);
      return res.status(500).json({ error: 'Failed to send invite' });
    }
  });

  return r;
}

/** Public (pre-auth) routes: preview + accept. Mounted separately so unauthenticated GET works. */
export function createOrganizationPublicRouter(prisma: PrismaClient): Router {
  const r = Router();

  /** GET /api/organizations/invite/:token — preview (no auth, no PHI). */
  r.get('/invite/:token', async (req: Request, res: Response) => {
    try {
      const invite = await prisma.organizationInviteToken.findUnique({
        where: { token: req.params.token },
        include: { organization: { select: { name: true } } },
      });
      if (!invite) return res.status(404).json({ error: 'Invite not found' });
      if (invite.usedAt) return res.status(410).json({ error: 'This invite has already been used' });
      if (invite.expiresAt < new Date()) return res.status(410).json({ error: 'This invite has expired' });
      return res.json({ organizationName: invite.organization.name, inviteeEmail: invite.inviteeEmail });
    } catch (e) {
      console.error('organization invite lookup error:', e);
      return res.status(500).json({ error: 'Failed to look up invite' });
    }
  });

  /**
   * POST /api/organizations/invite/:token/accept — the invited owner accepts
   * on their own authenticated session. Only their own practiceId (from the
   * session, never from the request body) is what gets attached.
   */
  r.post(
    '/invite/:token/accept',
    authenticate,
    requirePracticeContext,
    authorizeRole('practice_owner'),
    async (req: Request, res: Response) => {
      try {
        const auth = req.auth!;
        const userId = isUserSession(auth) ? (auth as UserAuthPayload).userId : null;
        if (!userId) return res.status(403).json({ error: 'A practice user session is required' });
        const practiceId = practiceIdFromSession(req);

        const invite = await prisma.organizationInviteToken.findUnique({ where: { token: req.params.token } });
        if (!invite) return res.status(404).json({ error: 'Invite not found' });
        if (invite.usedAt) return res.status(410).json({ error: 'This invite has already been used' });
        if (invite.expiresAt < new Date()) return res.status(410).json({ error: 'This invite has expired' });

        const [user, alreadyInOrg] = await Promise.all([
          prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
          prisma.organizationPractice.findUnique({ where: { practiceId } }),
        ]);
        if (!user || user.email.toLowerCase() !== invite.inviteeEmail.toLowerCase()) {
          return res.status(403).json({ error: 'This invite was not sent to your account' });
        }
        if (alreadyInOrg) return res.status(409).json({ error: 'This practice already belongs to a group' });

        await prisma.$transaction([
          prisma.organizationPractice.create({ data: { organizationId: invite.organizationId, practiceId } }),
          prisma.organizationMember.upsert({
            where: { organizationId_userId: { organizationId: invite.organizationId, userId } },
            create: { organizationId: invite.organizationId, userId, role: 'org_admin' },
            update: {},
          }),
          prisma.organizationInviteToken.update({ where: { token: req.params.token }, data: { usedAt: new Date() } }),
        ]);
        await ensureGroupAdminRole(prisma, res, userId, practiceId);
        await appendAuditLog(prisma, {
          practiceId,
          userId,
          action: 'organization.accept_invite',
          details: { organizationId: invite.organizationId },
        });

        return res.json({ joined: true, organizationId: invite.organizationId });
      } catch (e) {
        // Two accept-invite requests can race past the alreadyInOrg read above —
        // the practiceId unique constraint is the real guard against a double
        // attach, and the loser here should see the same clean 409 the earlier
        // read-based check gives, not a generic 500.
        if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
          return res.status(409).json({ error: 'This practice already belongs to a group' });
        }
        console.error('organization accept-invite error:', e);
        return res.status(500).json({ error: 'Failed to join group' });
      }
    },
  );

  return r;
}
