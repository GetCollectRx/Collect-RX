import type { HelmetOptions } from 'helmet';

/**
 * CSP for the CollectRx SPA + API on one origin.
 * Enable with CSP_ENABLED=1 or automatically in production.
 * Stripe Checkout embeds require js.stripe.com; Vite dev HMR needs ws: when CSP_ENABLED in dev.
 */
export function resolveContentSecurityPolicy(): HelmetOptions['contentSecurityPolicy'] {
  const enabled =
    process.env.CSP_ENABLED === '1' ||
    (process.env.NODE_ENV === 'production' && process.env.CSP_DISABLED !== '1');
  if (!enabled) return false;

  const isDev = process.env.NODE_ENV !== 'production';
  const connectSrc = ["'self'", 'https://api.stripe.com', 'https://*.sentry.io'];
  if (isDev) {
    connectSrc.push('ws:', 'wss:', 'http://127.0.0.1:*', 'http://localhost:*');
  }

  return {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      scriptSrc: ["'self'", 'https://js.stripe.com', ...(isDev ? ["'unsafe-inline'"] : [])],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc,
      frameSrc: ['https://js.stripe.com', 'https://hooks.stripe.com'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isDev ? null : [],
    },
  };
}
