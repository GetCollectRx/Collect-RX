#!/usr/bin/env node
/** Block until local API /api/health responds (avoids Vite proxy ECONNREFUSED on boot). */
import { readPortFromEnvFile } from './free-dev-ports.mjs';

const port = readPortFromEnvFile('PORT', 3000);
const url = `http://127.0.0.1:${port}/api/health`;
const maxAttempts = 60;

for (let i = 1; i <= maxAttempts; i++) {
  try {
    const res = await fetch(url);
    if (res.ok) process.exit(0);
  } catch {
    /* API still starting */
  }
  await new Promise((r) => setTimeout(r, 500));
}

console.error(`[wait-for-api] API not ready at ${url} after ${maxAttempts * 0.5}s`);
process.exit(1);
