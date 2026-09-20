/**
 * Minimal mock SAML 2.0 IdP for testing the ACS acceptance path — signs a
 * real assertion with a throwaway self-signed cert (openssl) using
 * xml-crypto (the same signing/verification library @node-saml/node-saml
 * uses internally), so the SP-side validatePostResponseAsync exercises its
 * real cryptographic verification path rather than a mocked one.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SignedXml } from 'xml-crypto';

export function generateSelfSignedIdpCert(): { privateKeyPem: string; certPem: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sso-fixture-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=fixture-idp"`,
      { stdio: 'pipe' },
    );
    return { privateKeyPem: readFileSync(keyPath, 'utf8'), certPem: readFileSync(certPath, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function buildSignedSamlResponse(opts: {
  privateKeyPem: string;
  /** IdP's own issuer string — arbitrary, node-saml doesn't validate the IdP's issuer against config in this flow. */
  issuer: string;
  /** Must match the SP's configured issuer (buildSamlClient's issuer) — this is what checkAudienceValidityError validates against. */
  audience: string;
  /** ACS URL — Recipient/Destination. */
  destination: string;
  /** Asserted identity — CollectRx matches this to User.email. */
  nameId: string;
}): string {
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000).toISOString();
  const notOnOrAfter = new Date(now.getTime() + 5 * 60_000).toISOString();
  const assertionId = `_${randomUUID()}`;
  const responseId = `_${randomUUID()}`;
  const issueInstant = now.toISOString();

  const assertionXml =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${issueInstant}">` +
    `<saml:Issuer>${opts.issuer}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${opts.nameId}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${opts.destination}"/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">` +
    `<saml:AudienceRestriction><saml:Audience>${opts.audience}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${issueInstant}">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    `</saml:Assertion>`;

  const sig = new SignedXml({
    privateKey: opts.privateKeyPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(assertionXml, {
    location: { reference: "//*[local-name(.)='Issuer']", action: 'after' },
  });
  const signedAssertionXml = sig.getSignedXml();

  const responseXml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
    `ID="${responseId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${opts.destination}">` +
    `<saml:Issuer>${opts.issuer}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    signedAssertionXml +
    `</samlp:Response>`;

  return Buffer.from(responseXml).toString('base64');
}
