import express, { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  getOrganizationSsoConnectionBySlug,
  buildSamlClient,
  buildSpMetadataXml,
  assertedEmailFromProfile,
} from '../sso/organizationSsoService.js';
import { setUserAuthCookie } from '../authToken.js';
import type { UserAuthPayload } from '../accessControl/types.js';
import { appendAuditLog } from '../audit/auditLog.js';
import { frontendBaseUrl } from '../stripe/billing.js';
import { authLimiter } from '../middleware/rateLimiter.js';

/**
 * Phase 4 FR-1-6: per-org SAML 2.0 SSO front door. Authenticates onto the
 * SAME session token respondPracticeLogin already issues — SSO is a new way
 * in, not a new session shape. Public routes (no `authenticate` middleware):
 * the caller isn't authenticated yet, that's the point of this router.
 * Successful logins go to AuditLog; failures go to OrgSsoEvent (AuditLog's
 * practiceId is NOT NULL and an unmatched-email failure has no practice).
 */
export function createSsoRouter(prisma: PrismaClient): Router {
  const r = Router();
  r.use(express.urlencoded({ extended: false }));

  r.get('/:orgSlug/metadata', async (req: Request, res: Response) => {
    try {
      const orgSlug = req.params.orgSlug;
      const connection = await getOrganizationSsoConnectionBySlug(prisma, orgSlug);
      if (!connection) return res.status(404).json({ error: 'SSO not configured for this organization' });
      res.setHeader('Content-Type', 'application/xml');
      return res.send(buildSpMetadataXml(orgSlug));
    } catch (e) {
      console.error('sso metadata error:', e);
      return res.status(500).json({ error: 'Failed to generate SP metadata' });
    }
  });

  /** SP-initiated login — redirects the browser to the configured IdP. */
  r.post('/:orgSlug/login', authLimiter, async (req: Request, res: Response) => {
    try {
      const orgSlug = req.params.orgSlug;
      const connection = await getOrganizationSsoConnectionBySlug(prisma, orgSlug);
      if (!connection) return res.status(404).json({ error: 'SSO not configured for this organization' });
      const saml = buildSamlClient(connection.entryPoint, connection.idpCert, orgSlug);
      const relayState = typeof req.body?.relayState === 'string' ? req.body.relayState : '';
      const url = await saml.getAuthorizeUrlAsync(relayState, req.hostname, {});
      return res.redirect(302, url);
    } catch (e) {
      console.error('sso login init error:', e);
      return res.status(500).json({ error: 'Failed to start SSO login' });
    }
  });

  /**
   * Assertion Consumer Service — the IdP POSTs the SAML assertion here.
   * FR-4: an unmatched email never creates an account. FR-6: successful and
   * failed logins are audited. AuditLog.practiceId is NOT nullable, so a
   * failure with no matched user (no practiceId) can't live there — it goes
   * to the org-scoped OrgSsoEvent table instead (organizationId is always
   * known by this point, resolved before any failure branch runs). Successes
   * go to AuditLog with the matched user's practiceId, as FR-6 specifies.
   */
  r.post('/:orgSlug/acs', authLimiter, async (req: Request, res: Response) => {
    const orgSlug = req.params.orgSlug;
    let organizationId: string | undefined;
    try {
      const connection = await getOrganizationSsoConnectionBySlug(prisma, orgSlug);
      if (!connection) return res.status(404).json({ error: 'SSO not configured for this organization' });
      organizationId = connection.organizationId;
      const saml = buildSamlClient(connection.entryPoint, connection.idpCert, orgSlug);

      const body = req.body as Record<string, string>;
      const { profile } = await saml.validatePostResponseAsync(body);
      if (!profile) {
        return await loginFailed(prisma, res, organizationId, 'invalid_response', 'no profile in validated response (logout or malformed)');
      }

      const email = assertedEmailFromProfile(profile);
      if (!email) {
        return await loginFailed(prisma, res, organizationId, 'no_email', 'assertion carried no usable email');
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) {
        // FR-4: never create an account here — "contact your administrator" instead.
        return await loginFailed(prisma, res, organizationId, 'unmatched_email', `no matching active CollectRx user for ${email}`);
      }

      setUserAuthCookie(res, {
        userId: user.id,
        practiceId: user.practiceId,
        role: user.role as UserAuthPayload['role'],
      });
      await appendAuditLog(prisma, {
        practiceId: user.practiceId,
        userId: user.id,
        action: 'auth.sso.login',
        subjectType: 'Organization',
        subjectId: organizationId,
      });
      return res.redirect(302, frontendBaseUrl());
    } catch (e) {
      if (organizationId) {
        return await loginFailed(prisma, res, organizationId, 'assertion_failed', String(e instanceof Error ? e.message : e));
      }
      console.error(`[sso] org slug=${orgSlug} acs error before org resolved:`, e);
      return res.redirect(302, `${frontendBaseUrl()}/login?ssoError=assertion_failed`);
    }
  });

  return r;
}

async function loginFailed(
  prisma: PrismaClient,
  res: Response,
  organizationId: string,
  reason: string,
  detail: string,
): Promise<void> {
  console.error(`[sso] org=${organizationId} acs failed: ${reason} — ${detail}`);
  await prisma.orgSsoEvent
    .create({ data: { organizationId, eventType: 'login_failed', detail: `${reason}: ${detail}` } })
    .catch((e: unknown) => console.error('[sso] failed to record OrgSsoEvent (non-fatal):', e));
  res.redirect(302, `${frontendBaseUrl()}/login?ssoError=${reason}`);
}
