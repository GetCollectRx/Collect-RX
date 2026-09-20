/**
 * Phase 4 FR-1-6 (specs/phase-4-enterprise-it-compliance.md): per-organization
 * SAML 2.0 SP configuration. IdP SSO URL + signing certificate are stored as
 * one authenticated-encrypted blob (@node-saml/node-saml v5,
 * https://github.com/node-saml/node-saml — the actively-maintained,
 * framework-agnostic successor to passport-saml's core) — reusing the
 * TriageCredential/phiAtRest AES-256-GCM pattern per the PRD's own
 * recommendation, for tamper-detection rather than confidentiality (an IdP's
 * signing cert is public by design).
 *
 * v1 scope only (see PRD Non-Goals): SAML 2.0 only, no JIT provisioning — a
 * SAML assertion authenticates an existing User (matched by email), it never
 * creates one. IdP config is platform_dev-managed only; org_admin can only
 * flip ssoEnforced.
 */
import type { PrismaClient } from '@prisma/client';
import { SAML, generateServiceProviderMetadata, type Profile } from '@node-saml/node-saml';
import { decryptPhiAtRest, encryptPhiAtRest } from '../crypto/phiAtRest.js';
import { readServerUrl } from '../envAliases.js';

export interface OrganizationSsoConnection {
  organizationId: string;
  orgSlug: string;
  entryPoint: string;
  idpCert: string;
  ssoEnforced: boolean;
  enforcedDomains: string[];
}

export function serverBaseUrl(): string {
  const fromEnv = readServerUrl();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') return 'https://www.collectrx.ca';
  return 'http://localhost:3000';
}

function ssoBasePath(orgSlug: string): string {
  return `${serverBaseUrl()}/api/auth/sso/${encodeURIComponent(orgSlug)}`;
}

/**
 * issuer/callbackUrl are CollectRx-side identifiers, derived at runtime — never stored per-org.
 *
 * wantAuthnResponseSigned defaults to true in @node-saml/node-saml — requiring
 * the whole <Response> to be signed, on top of the assertion. Most IdPs
 * (Okta, Azure AD/Entra, OneLogin, ADFS) sign only the assertion by default,
 * not the outer response — leaving the library default in place would
 * silently reject a real customer's IdP the first time this connects to one.
 * wantAssertionsSigned: true is the actual security requirement here; set
 * explicitly rather than left to change if the library's default ever shifts.
 */
export function buildSamlClient(entryPoint: string, idpCert: string, orgSlug: string): SAML {
  return new SAML({
    entryPoint,
    idpCert,
    issuer: `${serverBaseUrl()}/api/auth/sso/${encodeURIComponent(orgSlug)}/metadata`,
    callbackUrl: `${ssoBasePath(orgSlug)}/acs`,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
  });
}

export function buildSpMetadataXml(orgSlug: string): string {
  return generateServiceProviderMetadata({
    issuer: `${serverBaseUrl()}/api/auth/sso/${encodeURIComponent(orgSlug)}/metadata`,
    callbackUrl: `${ssoBasePath(orgSlug)}/acs`,
    wantAssertionsSigned: true,
  });
}

export async function saveOrganizationSsoConfig(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    orgSlug: string;
    entryPoint: string;
    idpCert: string;
    enforcedDomains: string[];
    actor: string;
  },
): Promise<void> {
  const encrypted = encryptPhiAtRest(
    JSON.stringify({ entryPoint: input.entryPoint, idpCert: input.idpCert }),
    { recordId: input.organizationId, fieldKey: 'organizationSsoConfig', actor: input.actor },
  );
  await prisma.organizationSsoConfig.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      orgSlug: input.orgSlug,
      ciphertext: encrypted.encryptedText,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      enforcedDomains: input.enforcedDomains.map((d) => d.toLowerCase().trim()),
    },
    update: {
      orgSlug: input.orgSlug,
      ciphertext: encrypted.encryptedText,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      enforcedDomains: input.enforcedDomains.map((d) => d.toLowerCase().trim()),
    },
  });
}

export async function getOrganizationSsoConnectionBySlug(
  prisma: PrismaClient,
  orgSlug: string,
): Promise<OrganizationSsoConnection | null> {
  const record = await prisma.organizationSsoConfig.findUnique({ where: { orgSlug } });
  if (!record) return null;
  return decryptConnection(record);
}

export async function getOrganizationSsoConnectionByOrgId(
  prisma: PrismaClient,
  organizationId: string,
): Promise<OrganizationSsoConnection | null> {
  const record = await prisma.organizationSsoConfig.findUnique({ where: { organizationId } });
  if (!record) return null;
  return decryptConnection(record);
}

function decryptConnection(record: {
  organizationId: string;
  orgSlug: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  ssoEnforced: boolean;
  enforcedDomains: string[];
}): OrganizationSsoConnection {
  const decrypted = decryptPhiAtRest(
    { encryptedText: record.ciphertext, iv: record.iv, authTag: record.authTag },
    { recordId: record.organizationId, fieldKey: 'organizationSsoConfig' },
  );
  const { entryPoint, idpCert } = JSON.parse(decrypted) as { entryPoint: string; idpCert: string };
  return {
    organizationId: record.organizationId,
    orgSlug: record.orgSlug,
    entryPoint,
    idpCert,
    ssoEnforced: record.ssoEnforced,
    enforcedDomains: record.enforcedDomains,
  };
}

export async function setSsoEnforced(prisma: PrismaClient, organizationId: string, enforced: boolean): Promise<void> {
  await prisma.organizationSsoConfig.update({ where: { organizationId }, data: { ssoEnforced: enforced } });
}

/**
 * FR-5: password login is disabled for any User whose email domain matches a
 * configured, currently-enforced SSO domain. Domain-based, checked at login
 * time — not stored per-user, so a config change takes effect immediately.
 */
export async function findEnforcingSsoOrgForEmail(
  prisma: PrismaClient,
  email: string,
): Promise<{ orgSlug: string } | null> {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;
  const config = await prisma.organizationSsoConfig.findFirst({
    where: { ssoEnforced: true, enforcedDomains: { has: domain } },
    select: { orgSlug: true },
  });
  return config ? { orgSlug: config.orgSlug } : null;
}

/** Best-effort email extraction from a validated SAML profile — IdPs vary in whether NameID is email-formatted. */
export function assertedEmailFromProfile(profile: Profile): string | null {
  const candidate = profile.email || profile.mail || profile.nameID;
  if (!candidate) return null;
  const trimmed = String(candidate).toLowerCase().trim();
  return trimmed.includes('@') ? trimmed : null;
}
