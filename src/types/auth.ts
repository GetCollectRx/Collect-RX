export type UserRole = 'practice_admin' | 'staff' | 'platform_admin';

export interface LoginRequest {
  practiceId: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  practiceId: string;
  practiceName: string;
}

export interface AdminLoginRequest {
  secret: string;
}

export interface AdminLoginResponse {
  token: string;
  role: UserRole;
}

export interface JWTPayload {
  practiceId: string;
  role: UserRole;
  userId: string;
}
