/** CollectRx session roles (JWT `role` claim). */
export type AuthRole = 'practice' | 'platform_dev';

export type PracticeAuthPayload = {
  role: 'practice';
  practiceId: string;
  phiAccess: true;
};

/** Platform operator — full ops/config; PHI blocked at middleware + serializers. */
export type PlatformDevAuthPayload = {
  role: 'platform_dev';
  phiAccess: false;
};

export type AuthJwtPayload = PracticeAuthPayload | PlatformDevAuthPayload;

export function isPlatformDev(auth: AuthJwtPayload | undefined): auth is PlatformDevAuthPayload {
  return auth?.role === 'platform_dev';
}

export function hasPhiAccess(auth: AuthJwtPayload | undefined): boolean {
  return auth?.phiAccess === true;
}
