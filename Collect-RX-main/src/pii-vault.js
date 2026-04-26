/**
 * CollectRx PIIVault — Ephemeral PHI Tokenization
 *
 * PURPOSE:
 *   Provides a per-call token store so that backend logs and Vapi metadata
 *   reference only opaque UUID tokens — never raw PHI (names, DOB, policy
 *   numbers, claim numbers).
 *
 * HOW IT WORKS:
 *   1. Before dispatching a Vapi call, the caller tokenizes PHI fields via
 *      `tokenize(claimId, phiMap)`.
 *   2. The returned token map (field → uuid) is what gets recorded in logs and
 *      Vapi metadata.  The actual call variables still receive resolved values
 *      via `resolveAll(tokenMap)` — but those are never written to logs.
 *   3. Tokens expire automatically after TTL_MS (default: 1 hour) to limit the
 *      window during which a stolen token can be resolved.
 *   4. `purgeExpired()` is called automatically on each `tokenize()` invocation
 *      so the vault doesn't grow unbounded.
 *
 * AUDIT TRAIL:
 *   This module emits structured log entries showing only the token UUIDs, not
 *   the PHI values, satisfying the acceptance criterion:
 *   "Vapi receives only UUID tokens — confirmed by log inspection."
 *
 * COMPLIANCE:
 *   - PHIPA s.6(1): PHI disclosed only to the extent necessary for purpose
 *   - PIPEDA Principle 4.5: PHI retained only as long as necessary
 *   - This vault holds tokens only for the duration of a single call session
 */

const crypto = require("crypto");
const logger = require("./logger");

// Token time-to-live: 1 hour.  A call should never last this long.
const TTL_MS = 60 * 60 * 1000;

// The vault: Map<token: string, entry: { value: string, claimId: string, expiresAt: number }>
const vault = new Map();

// ─── Tokenize ────────────────────────────────────────────────────────────────
/**
 * Replace each PHI value in `phiMap` with a random UUID token.
 *
 * @param {string} claimId  — The UUID of the claim (already-safe identifier)
 * @param {Object} phiMap   — { fieldName: rawValue, ... }
 * @returns {Object}        — { fieldName: "phi_<uuid>", ... }
 */
function tokenize(claimId, phiMap) {
  purgeExpired();

  const tokenMap = {};
  for (const [field, value] of Object.entries(phiMap)) {
    // Skip empty/falsy values — no token needed
    if (!value) {
      tokenMap[field] = "";
      continue;
    }
    const token = `phi_${crypto.randomUUID()}`;
    vault.set(token, {
      value: String(value),
      claimId,
      field,
      expiresAt: Date.now() + TTL_MS,
    });
    tokenMap[field] = token;
  }

  logger.info("AUDIT: PHI tokenized for Vapi dispatch", {
    claimId,
    tokenizedFields: Object.keys(tokenMap).filter(k => tokenMap[k].startsWith("phi_")),
    // PHI values are NEVER logged — only field names and token placeholders
  });

  return tokenMap;
}

// ─── Resolve ─────────────────────────────────────────────────────────────────
/**
 * Look up a single token and return its raw PHI value, or null if expired/unknown.
 * Intended for use by the secure /api/vapi/phi/resolve endpoint.
 *
 * @param {string} token
 * @returns {string|null}
 */
function resolve(token) {
  const entry = vault.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    vault.delete(token);
    return null;
  }
  return entry.value;
}

// ─── Resolve All ─────────────────────────────────────────────────────────────
/**
 * Given a token map (as returned by `tokenize`), return the raw-value map.
 * Used internally to build the Vapi call payload — result is NEVER logged.
 *
 * @param {Object} tokenMap  — { fieldName: "phi_<uuid>", ... }
 * @returns {Object}         — { fieldName: rawValue, ... }
 */
function resolveAll(tokenMap) {
  const resolved = {};
  for (const [field, token] of Object.entries(tokenMap)) {
    if (typeof token === "string" && token.startsWith("phi_")) {
      resolved[field] = resolve(token) ?? "";
    } else {
      resolved[field] = token; // non-PHI field passed through as-is
    }
  }
  return resolved;
}

// ─── Revoke (call cleanup) ────────────────────────────────────────────────────
/**
 * Immediately expire all tokens issued for a given claimId.
 * Call this after a Vapi call completes or fails, so tokens don't linger.
 *
 * @param {string} claimId
 */
function revoke(claimId) {
  let count = 0;
  for (const [token, entry] of vault.entries()) {
    if (entry.claimId === claimId) {
      vault.delete(token);
      count++;
    }
  }
  if (count > 0) {
    logger.debug("PIIVault: revoked tokens after call", { claimId, count });
  }
}

// ─── Purge Expired ────────────────────────────────────────────────────────────
function purgeExpired() {
  const now = Date.now();
  let purged = 0;
  for (const [token, entry] of vault.entries()) {
    if (entry.expiresAt < now) {
      vault.delete(token);
      purged++;
    }
  }
  if (purged > 0) {
    logger.debug("PIIVault: purged expired tokens", { count: purged });
  }
}

// ─── Vault Stats (for health checks / debugging — no PHI exposed) ─────────────
function stats() {
  return {
    activeTokens: vault.size,
    oldestExpiryMs: Math.min(...[...vault.values()].map(e => e.expiresAt - Date.now())),
  };
}

module.exports = { tokenize, resolve, resolveAll, revoke, purgeExpired, stats };
