import { z } from 'zod';

const PRACTICE_ROLES = [
  'practice_owner',
  'office_manager',
  'billing_coordinator',
  'front_desk',
  'associate_dentist',
  'accountant',
  'group_admin',
] as const;

// ─── Auth ─────────────────────────────────────────────────────────────────────

/** New login: individual user email + password. */
export const loginBodySchema = z.object({
  email: z.string().email('email must be a valid email address').toLowerCase(),
  password: z.string().min(1, 'password is required').max(256),
});

export const platformDevLoginBodySchema = z.object({
  password: z.string().min(1, 'password is required').max(256),
});

// ─── User management ──────────────────────────────────────────────────────────

export const createUserBodySchema = z.object({
  email: z.string().email('email must be a valid email address').toLowerCase(),
  password: z.string().min(8, 'password must be at least 8 characters').max(256),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(PRACTICE_ROLES),
  /** Required when role is associate_dentist. */
  providerId: z.string().trim().optional(),
});

export const updateUserBodySchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(PRACTICE_ROLES).optional(),
  isActive: z.boolean().optional(),
  providerId: z.string().trim().optional(),
  tokenExpiresAt: z.string().datetime().optional(),
});

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8, 'new password must be at least 8 characters').max(256),
});

// ─── Existing schemas (unchanged) ─────────────────────────────────────────────

export const carrierUnblockBodySchema = z.object({
  resumedBy: z.string().trim().min(1).max(120),
  notes: z.string().max(2000).optional(),
  practiceId: z.string().uuid().optional(),
});

export const pmsImportBodySchema = z
  .object({
    records: z.array(z.record(z.string(), z.unknown())).optional(),
    sourceBalanceTotal: z.coerce.number().finite().optional(),
  })
  .passthrough();

// ─── Types ────────────────────────────────────────────────────────────────────

export type LoginBody = z.infer<typeof loginBodySchema>;
export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
export type CarrierUnblockBody = z.infer<typeof carrierUnblockBodySchema>;

export function formatZodError(err: z.ZodError): string {
  const issues = (err as unknown as { issues?: { message: string }[]; errors?: { message: string }[] }).issues
    ?? (err as unknown as { errors?: { message: string }[] }).errors
    ?? [];
  const first = issues[0];
  return first?.message ?? 'Invalid request body';
}
