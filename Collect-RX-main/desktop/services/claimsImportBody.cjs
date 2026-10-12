'use strict';

/**
 * Body for POST /api/connector/claims/import.
 *
 * The server needs a payer program for every NEW claim. AbelDent rows carry no
 * program field, so the practice declares one for this connector with
 * COLLECTRX_DEFAULT_PAYER_TYPE (PRIVATE, CDCP or PROVINCIAL). There is no
 * built-in default: without it new claims are rejected by the server and the
 * heartbeat says why. Rows whose plan name says CDCP are classified CDCP by the
 * server regardless of this setting.
 */
const ALLOWED = new Set(['PRIVATE', 'CDCP', 'PROVINCIAL']);

function readDefaultPayerType(env) {
  const raw = (env.COLLECTRX_DEFAULT_PAYER_TYPE || '').trim().toUpperCase();
  if (!raw) return undefined;
  if (!ALLOWED.has(raw)) {
    throw new Error(
      `COLLECTRX_DEFAULT_PAYER_TYPE must be PRIVATE, CDCP or PROVINCIAL (got "${env.COLLECTRX_DEFAULT_PAYER_TYPE}")`,
    );
  }
  return raw;
}

function buildClaimsImportBody(rows, env) {
  const defaultPayerType = readDefaultPayerType(env);
  return {
    records: rows,
    pmsVendor: 'abeldent',
    pmsSource: 'abeldent',
    ...(defaultPayerType ? { defaultPayerType } : {}),
  };
}

module.exports = { buildClaimsImportBody, readDefaultPayerType };
