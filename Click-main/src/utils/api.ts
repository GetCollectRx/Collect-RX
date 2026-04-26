/**
 * Central API helper — always uses the Vite proxy path (/api/...)
 * In dev: Vite proxies /api → http://localhost:3000
 * In prod: Electron loads the Railway URL directly, same /api path
 */

export const TOKEN_KEY = 'collectrx_token';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });

  if (res.status === 401) {
    // Token expired or invalid — clear it so the app redirects to login
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event('collectrx:unauthorized'));
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T = unknown>(path: string) => apiFetch<T>(path),
  post: <T = unknown>(path: string, body: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  put: <T = unknown>(path: string, body: unknown) =>
    apiFetch<T>(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};
