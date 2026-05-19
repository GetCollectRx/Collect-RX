const COLLECTRX_APEX = 'https://collectrx.ca';
const COLLECTRX_WWW = 'https://www.collectrx.ca';

import { readAllowedOriginsRaw as readAllowedOriginsEnv } from './envRailway.js';

/**
 * Raw `ALLOWED_ORIGINS` string. Railway UI sometimes labels the row "Allowed Origins";
 * the canonical key is `ALLOWED_ORIGINS` — we accept a few aliases so CORS still applies.
 */
export function readAllowedOriginsRaw(): string {
  return readAllowedOriginsEnv();
}

/**
 * If only apex or only www is listed for collectrx.ca, add the other. One Railway
 * `ALLOWED_ORIGINS` value often lists a single public URL; browsers still send distinct Origins.
 */
export function expandMirroredCollectRxOrigins(origins: string[]): string[] {
  const set = new Set(origins);
  if (set.has(COLLECTRX_APEX) && !set.has(COLLECTRX_WWW)) set.add(COLLECTRX_WWW);
  if (set.has(COLLECTRX_WWW) && !set.has(COLLECTRX_APEX)) set.add(COLLECTRX_APEX);
  return [...set];
}

const defaultCorsOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  COLLECTRX_APEX,
  COLLECTRX_WWW,
];

/** Parsed allowed origins with collectrx apex/www mirroring, or built-in dev + collectrx defaults. */
export function resolveCorsAllowedOrigins(): string[] {
  const raw = readAllowedOriginsRaw()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (raw.length === 0) return defaultCorsOrigins;
  return expandMirroredCollectRxOrigins(raw);
}
