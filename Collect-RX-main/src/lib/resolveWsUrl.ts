import { resolveApiUrl } from './resolveApiUrl.js';

/** WebSocket URL for front desk live console (same host/cookie session as REST API). */
export function resolveWsUrl(path: string): string {
  const rest = resolveApiUrl(path);
  if (rest.startsWith('http://')) return `ws://${rest.slice('http://'.length)}`;
  if (rest.startsWith('https://')) return `wss://${rest.slice('https://'.length)}`;
  if (typeof window === 'undefined') return path;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${proto}//${window.location.host}${p}`;
}
