import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeRole } from '../middleware/authorizeRole.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import {
  createOrganizationBodySchema,
  organizationSsoConfigBodySchema,
  ssoBreakGlassBodySchema,
  formatZodError,
} from '../validation/zodSchemas.js';
import { sendInviteEmail } from '../email/inviteEmail.js';
import { unusedLegacyPasswordHash, createOrgPractice } from '../organizations/practiceProvisioning.js';
import { saveOrganizationSsoConfig, getOrganizationSsoConnectionByOrgId } from '../sso/organizationSsoService.js';

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

  /**
   * POST /api/admin/organizations/:organizationId/sso-config
   * Phase 4 FR-1: configure (or replace) an org's SAML IdP connection.
   * platform_dev only in v1 — see Non-Goals in
   * specs/phase-4-enterprise-it-compliance.md (support-assisted setup, no
   * self-serve config UI).
   */
  r.post('/organizations/:organizationId/sso-config', authLimiter, async (req: Request, res: Response) => {
    try {
      const { organizationId } = req.params;
      const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
      if (!organization) return res.status(404).json({ error: 'Organization not found' });

      const parsed = organizationSsoConfigBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });

      const existingSlug = await prisma.organizationSsoConfig.findUnique({
        where: { orgSlug: parsed.data.orgSlug },
        select: { organizationId: true },
      });
      if (existingSlug && existingSlug.organizationId !== organizationId) {
        return res.status(409).json({ error: 'orgSlug is already in use by another organization' });
      }

      await saveOrganizationSsoConfig(prisma, {
        organizationId,
        orgSlug: parsed.data.orgSlug,
        entryPoint: parsed.data.entryPoint,
        idpCert: parsed.data.idpCert,
        enforcedDomains: parsed.data.enforcedDomains,
        actor: req.auth?.userId ?? 'platform_dev',
      });

      return res.status(201).json({ organizationId, orgSlug: parsed.data.orgSlug });
    } catch (e) {
      console.error('org admin sso-config error:', e);
      return res.status(500).json({ error: 'Failed to save SSO configuration' });
    }
  });

  /** GET status only — never returns the decrypted cert/entryPoint over the wire. */
  r.get('/organizations/:organizationId/sso-config', async (req: Request, res: Response) => {
    try {
      const connection = await getOrganizationSsoConnectionByOrgId(prisma, req.params.organizationId);
      if (!connection) return res.json({ configured: false });
      return res.json({
        configured: true,
        orgSlug: connection.orgSlug,
        ssoEnforced: connection.ssoEnforced,
        enforcedDomains: connection.enforcedDomains,
      });
    } catch (e) {
      console.error('org admin sso-config status error:', e);
      return res.status(500).json({ error: 'Failed to load SSO configuration' });
    }
  });

  /**
   * POST /api/admin/organizations/:organizationId/sso/break-glass
   * Emergency override — force-disables ssoEnforced. Exists because the
   * org_admin's own PATCH /api/group/sso/enforce is unreachable if their IdP
   * is down AND their own email domain requires SSO: nobody inside the org
   * can log in to flip the switch. platform_dev logs in via a completely
   * separate endpoint (unaffected by any org's SSO enforcement), so this is
   * the actual break-glass path. Mandatory reason, always recorded.
   */
  r.post('/organizations/:organizationId/sso/break-glass', authLimiter, async (req: Request, res: Response) => {
    try {
      const { organizationId } = req.params;
      const config = await prisma.organizationSsoConfig.findUnique({ where: { organizationId } });
      if (!config) return res.status(404).json({ error: 'No SSO connection configured for this organization' });

      const parsed = ssoBreakGlassBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });

      const { setSsoEnforced } = await import('../sso/organizationSsoService.js');
      await setSsoEnforced(prisma, organizationId, false);
      await prisma.orgSsoEvent.create({
        data: {
          organizationId,
          eventType: 'break_glass_disabled',
          detail: parsed.data.reason,
          actorUserId: req.auth?.userId ?? null,
        },
      });

      return res.json({ ssoEnforced: false });
    } catch (e) {
      console.error('org admin sso break-glass error:', e);
      return res.status(500).json({ error: 'Failed to disable SSO enforcement' });
    }
  });

  return r;
}
