import { readFileSync, existsSync } from 'node:fs';
import type { PrismaClient, Prospect } from '@prisma/client';
import { logProspectActivity } from './prospectActivity.js';
import { logger } from '../observability/logger.js';

let cachedPhoneSet: Set<string> | null = null;
let cachedPhoneSetPath: string | null = null;

function normalizePhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  return digits;
}

function loadLocalDnclSet(): Set<string> | null {
  const path = process.env.DNCL_PHONE_LIST_PATH?.trim();
  if (!path) return null;
  if (cachedPhoneSet && cachedPhoneSetPath === path) return cachedPhoneSet;
  if (!existsSync(path)) {
    logger.warn('[dncl] DNCL_PHONE_LIST_PATH file not found', { detail: path });
    return null;
  }
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  cachedPhoneSet = new Set(
    lines.map((l) => normalizePhoneDigits(l.trim())).filter((d) => d.length >= 10),
  );
  cachedPhoneSetPath = path;
  return cachedPhoneSet;
}

async function checkDnclViaApi(phone: string): Promise<boolean | null> {
  const url = process.env.DNCL_CHECK_URL?.trim();
  if (!url) return null;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = process.env.DNCL_CHECK_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone: normalizePhoneDigits(phone) }),
    });
    if (!res.ok) {
      logger.warn('[dncl] API check failed', { status: res.status });
      return null;
    }
    const data = (await res.json()) as { listed?: boolean; onList?: boolean };
    if (typeof data.listed === 'boolean') return data.listed;
    if (typeof data.onList === 'boolean') return data.onList;
    return null;
  } catch (err) {
    logger.warn('[dncl] API check error', { error: err });
    return null;
  }
}

export interface DnclCheckResult {
  listed: boolean | null;
  source: 'cache' | 'local_file' | 'api' | 'skipped';
}

export async function checkProspectDncl(
  prisma: PrismaClient,
  prospect: Prospect,
): Promise<DnclCheckResult> {
  if (!prospect.phone?.trim()) {
    return { listed: null, source: 'skipped' };
  }

  if (prospect.dnclCheckedAt && prospect.dnclListed !== null) {
    return { listed: prospect.dnclListed, source: 'cache' };
  }

  const digits = normalizePhoneDigits(prospect.phone);
  let listed: boolean | null = null;
  let source: DnclCheckResult['source'] = 'skipped';

  const localSet = loadLocalDnclSet();
  if (localSet) {
    listed = localSet.has(digits);
    source = 'local_file';
  } else {
    listed = await checkDnclViaApi(prospect.phone);
    if (listed !== null) source = 'api';
  }

  await prisma.prospect.update({
    where: { id: prospect.id },
    data: {
      dnclCheckedAt: new Date(),
      dnclListed: listed,
    },
  });

  if (listed === true) {
    await logProspectActivity(
      prisma,
      prospect.id,
      'dncl_listed',
      'Phone appears on DNCL — outbound call blocked',
    );
  } else if (listed === false) {
    await logProspectActivity(prisma, prospect.id, 'dncl_clear', 'DNCL check passed');
  }

  return { listed, source };
}

/** Throws when the number is on DNCL and blocking is enabled (default when listed). */
export async function assertProspectCallable(
  prisma: PrismaClient,
  prospect: Prospect,
): Promise<void> {
  const strict = process.env.DNCL_STRICT !== 'false';
  const hasChecker =
    Boolean(process.env.DNCL_PHONE_LIST_PATH?.trim()) ||
    Boolean(process.env.DNCL_CHECK_URL?.trim());

  if (!hasChecker) {
    if (strict && process.env.NODE_ENV === 'production') {
      throw new Error(
        'DNCL check not configured — set DNCL_PHONE_LIST_PATH or DNCL_CHECK_URL before outbound sales calls',
      );
    }
    return;
  }

  const result = await checkProspectDncl(prisma, prospect);
  if (result.listed === true) {
    throw new Error('Prospect phone is on the National Do Not Call List — call not placed');
  }
}
