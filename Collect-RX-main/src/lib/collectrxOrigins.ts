/**
 * Canonical production origins — Fly.io (`collect-rx` app, Toronto `yyz`).
 * Railway is decommissioned; do not add *.railway.app defaults here.
 */
export const COLLECTRX_PROD_API_ORIGIN = 'https://collect-rx.fly.dev';

/** Full app shell (SPA + /api) on Fly. */
export const COLLECTRX_PROD_APP_ORIGIN = 'https://collect-rx.fly.dev';

/** Public marketing funnel (static; /api is not JSON there). */
export const COLLECTRX_MARKETING_ORIGIN = 'https://www.collectrx.ca';
