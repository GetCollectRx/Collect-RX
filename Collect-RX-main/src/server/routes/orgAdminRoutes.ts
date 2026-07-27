import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeRole } from '../middleware/authorizeRole.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { createOrganizationBodySchema, formatZodError } from '../validation/zodSchemas.js';
import { sendInviteEmail } from '../email/inviteEmail.js';
import { unusedLegacyPasswordHash, createOrgPractice } from '../organizations/practiceProvisioning.js';

/**
 * Admin-assisted DSO/multi-location onboarding — platform_dev only.
 * Creates an Organization plus N Practice rows in one transaction, then
 * invites the DSO's primary contact as group_admin on the first practice.
 * Self-serve org creation is a later phase; every location's own staff still
 * gets invited through the existing per-practice invite flow afterward.
 */
export function createOrgAdminRouter(prisma: PrismaClient): Router {
  const r = Router();
  r.use(authenticate);
  r.use(authorizeRole('platform_dev'));

  r.post('/organizations', authLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = createOrganizationBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });
      const { organizationName, practices, primaryContact } = parsed.data;

      const existingUser = await prisma.user.findUnique({ where: { email: primaryContact.email } });
      if (existingUser) return res.status(409).json({ error: 'An account with this email already exists' });

      // Hash outside the transaction — bcrypt at 12 rounds per practice would
      // otherwise hold the DB transaction open for a noticeable stretch on a
      // large batch (up to 50 practices per createOrganizationBodySchema).
      const legacyPasswordHashes = await Promise.all(practices.map(() => unusedLegacyPasswordHash()));

      const { organization, createdPractices } = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({ data: { name: organizationName } });

        const createdPractices = [];
        for (let i = 0; i < practices.length; i += 1) {
          const p = practices[i];
          const practice = await createOrgPractice(tx, organization.id, {
            practiceName: p.practiceName,
            timezone: p.timezone,
            passwordHash: legacyPasswordHashes[i],
          });
          createdPractices.push(practice);
        }

        return { organization, createdPractices };
      });

      const homePractice = createdPractices[0];
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
      const invite = await prisma.inviteToken.create({
        data: {
          practiceId: homePractice.id,
          organizationId: organization.id,
          email: primaryContact.email,
          role: 'group_admin',
          expiresAt,
        },
        select: { token: true },
      });

      // The org, its practices, and the invite token are already durably
      // created at this point — an email delivery failure must not report
      // total failure, since the invite is still valid and usable via its link.
      let emailSent = true;
      try {
        await sendInviteEmail({
          toEmail: primaryContact.email,
          practiceName: organizationName,
          role: 'group_admin',
          token: invite.token,
        });
      } catch (emailErr) {
        console.error('org admin invite email send failed (token still created):', emailErr);
        emailSent = false;
      }

      return res.status(201).json({
        organizationId: organization.id,
        practices: createdPractices.map((p) => ({ id: p.id, name: p.name })),
        primaryContactInvite: { emailSent, ...(emailSent ? {} : { token: invite.token }) },
      });
    } catch (e) {
      console.error('org admin create-organization error:', e);
      return res.status(500).json({ error: 'Failed to create organization' });
    }
  });

  return r;
}
