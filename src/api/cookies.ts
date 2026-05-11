export const AUTH_COOKIE = 'collectrx_at';

const EIGHT_H_MS = 8 * 60 * 60 * 1000;

export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: EIGHT_H_MS,
    path: '/',
  };
}
