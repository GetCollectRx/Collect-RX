/**
 * PHI egress boundary (CI gate).
 *
 * Decision (Phase 2 review): raw PHI/PII may leave the backend only as ephemeral
 * Vapi `variableValues`, purged after the call. It must never appear in Vapi
 * metadata or any other request field, persistent logs, or LLM system prompts.
 * Database storage uses vault tokens only.
 *
 * Runs in the normal `npm test` / CI job. No database required.
 *
 *  1. Vapi request body, outside variableValues, carries no sentinel PHI.
 *  2. Voice prompt templates contain placeholders only, from a fixed allowlist.
 *  3. Logger redaction covers the PHI field names used by the import and call paths.
 *  4. Every piiVault.detokenize() call site is on a reviewed allowlist, so a new
 *     site cannot appear without someone updating this file in the same PR.
 *  5. Modules that call an LLM provider must not import the PHI vault.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CarrierId } from '@prisma/client';
import { initiateCall, CARRIER_PHONE_MAP, type VapiCallParams } from '../src/vapi/client.js';
import { safeMeta } from '../src/server/observability/logger.js';
import { buildVoicePrompt } from '../src/config/prompts.js';
import { INDUSTRY_TYPES } from '../src/types/industry-claims.js';

const SENTINELS = {
  patientName: 'Zelda Sentinelname',
  patientDob: '1911-11-11',
  policyNumber: 'POLSENTINEL777',
  subscriberName: 'Sentinel Subscriber',
  subscriberDob: '1922-02-02',
  groupNumber: 'GRPSENTINEL9',
};

interface VapiBody {
  assistantOverrides: { variableValues?: unknown } & Record<string, unknown>;
  [key: string]: unknown;
}

function params(): VapiCallParams {
  return {
    claimId: 'claim-egress-1',
    carrierId: 'sun_life' as CarrierId,
    practiceId: 'practice-egress-1',
    patientToken: '3b241101-e2bb-4255-8caf-4136c566a962',
    ...SENTINELS,
    relationship: 'spouse',
    carrierPhone: CARRIER_PHONE_MAP.sun_life,
    claimNumber: 'CLM-EGRESS-1',
    treatmentDate: '2026-02-15',
    claimSubmittedDate: '2026-02-20',
    daysOutstanding: 45,
    billedAmount: 450,
    outstandingAmount: 450,
    treatmentCodes: 'D1110',
    practiceName: 'Fixture Dental',
    providerNumber: 'PN-1',
    practicePhone: '+15551234567',
  } as VapiCallParams;
}

describe('PHI egress: Vapi request body', () => {
  const ENV_BACKUP = { ...process.env };
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ENV_BACKUP };
  });

  it('carries sentinel PHI only inside assistantOverrides.variableValues', async () => {
    process.env.VAPI_API_KEY = 'test-key';
    process.env.VAPI_SQUAD_ID = 'squad-test';
    process.env.VAPI_PHONE_NUMBER_ID = 'phone-test';
    const captured: VapiBody[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        captured.push(JSON.parse(String(init.body)) as VapiBody);
        return { ok: true, json: async () => ({ id: 'call-1', status: 'queued', createdAt: new Date().toISOString() }) } as Response;
      }),
    );
    await initiateCall(params());
    const [body] = captured;
    if (!body) throw new Error('Vapi request was not captured');

    const { variableValues, ...restOfOverrides } = body.assistantOverrides;
    const outside = JSON.stringify({ ...body, assistantOverrides: restOfOverrides });
    for (const [field, value] of Object.entries(SENTINELS)) {
      expect(outside, `${field} leaked outside variableValues`).not.toContain(value);
    }
    // The ephemeral channel does carry them (otherwise the call cannot work).
    expect(JSON.stringify(variableValues)).toContain(SENTINELS.patientName);
  });
});

describe('PHI egress: voice prompt templates', () => {
  // Placeholders filled at dispatch time from ephemeral call variables.
  const ALLOWED_VARIABLES = new Set([
    'practice_name', 'practice_phone', 'days_outstanding', 'preferred_language',
    'claim_number', 'primary_reference', 'secondary_reference',
    'supplement_label', 'estimate_id', 'provider_number',
  ]);

  it.each(INDUSTRY_TYPES)('%s prompt uses only allowlisted {{variables}} and no literal PHI', (industryType) => {
    for (const language of ['en', 'fr'] as const) {
      const prompt = buildVoicePrompt({ industryType, language });
      const used = [...prompt.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!);
      for (const v of used) expect(ALLOWED_VARIABLES.has(v), `unlisted variable {{${v}}}`).toBe(true);
      for (const value of Object.values(SENTINELS)) expect(prompt).not.toContain(value);
      expect(prompt).not.toMatch(/\b[A-HJ-NPR-Z0-9]{17}\b/); // VIN-shaped literal
      expect(prompt).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/); // literal dates
    }
  });
});

describe('PHI egress: log redaction', () => {
  it('redacts the PHI field names used by import and call paths', () => {
    const meta = {
      insuredName: 'Zelda Sentinelname',
      insured_name: 'Zelda Sentinelname',
      vin: '1HGCM82633A004352',
      subscriberId: 'SUB-123',
      healthCardNumber: '1234-567-890',
      patientId: 'P-1',
      primaryReferenceId: 'RO-9',
      secondaryReferenceId: 'POL-9',
      policyNumber: 'POLSENTINEL777',
      patientName: 'Zelda Sentinelname',
      nested: { vin: '1HGCM82633A004352', note: 'ok' },
    };
    const out = JSON.stringify(safeMeta(meta));
    for (const raw of ['Zelda', '1HGCM82633A004352', 'SUB-123', '1234-567-890', 'P-1', 'RO-9', 'POL-9', 'POLSENTINEL777']) {
      expect(out).not.toContain(raw);
    }
    expect(out).toContain('"note":"ok"');
  });
});

// ── Static source guards ─────────────────────────────────────────────────────

const SRC = resolve(__dirname, '../src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !/ \d\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Drop comments so prose mentioning PIIVault does not count as a code dependency. */
const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const rel = (f: string) => relative(SRC, f).split('\\').join('/');

/** Reviewed call sites of piiVault.detokenize(). Adding one requires editing this list in the same PR. */
const DETOKENIZE_ALLOWLIST = new Set([
  'pii-vault.ts',
  'services/pii-vault.ts',
  'services/arEngine/tokenizer.ts',
  'services/guardrails/transcriptPersist.ts',
  'vapi/client.ts',
  'webhooks/vapi.ts',
  'routes/insurance.ts',
  'server/compliance/auditAgent.ts',
  'server/frontDesk/queueEngine.ts',
  'server/preVisit/electronicPreVisit.ts',
  'server/preVisit/preVisitDispatch.ts',
  'server/services/priorityEngine.ts',
]);

describe('PHI egress: static source guards', () => {
  const files = sourceFiles(SRC);

  it('every detokenize() call site is on the reviewed allowlist', () => {
    const sites = files.filter((f) => /\bdetokenize\s*\(/.test(code(f))).map(rel);
    const unreviewed = sites.filter((s) => !DETOKENIZE_ALLOWLIST.has(s));
    expect(unreviewed, `New detokenize() call sites need PHI review and an allowlist entry: ${unreviewed.join(', ')}`).toEqual([]);
  });

  it('modules that call an LLM provider never import the PHI vault', () => {
    const LLM = /@google\/generative-ai|generativelanguage\.googleapis\.com|@anthropic-ai\/sdk|api\.anthropic\.com|api\.openai\.com|openai\/|GoogleGenerativeAI/;
    // Importing LLM_RESIDENCY_HEADERS (a constant) is fine; touching the vault object or detokenizing is not.
    const VAULT = /\bdetokenize\s*\(|\bpiiVault\b|\bPIIVault\b/;
    const offenders = files
      .filter((f) => {
        const text = code(f);
        return LLM.test(text) && VAULT.test(text);
      })
      .map(rel);
    expect(offenders, `LLM-calling modules must not touch the PHI vault: ${offenders.join(', ')}`).toEqual([]);
  });
});
