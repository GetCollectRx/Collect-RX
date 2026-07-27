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
  /** When true, issues a front-desk-only session (live console + history). */
  deskMode: z.boolean().optional(),
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

export const registerBodySchema = z.object({
  practiceName: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, 'password must be at least 8 characters').max(256),
  /** Self-serve DSO signup: when set, an Organization is created alongside additionalPractices. */
  organizationName: z.string().trim().min(1).max(200).optional(),
  additionalPractices: z
    .array(
      z.object({
        practiceName: z.string().trim().min(1).max(200),
        timezone: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .max(49, 'use a batch import for organizations larger than 50 locations')
    .optional(),
});

export const inviteBodySchema = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(PRACTICE_ROLES),
});

export const acceptInviteBodySchema = z.object({
  token: z.string().uuid(),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(8, 'password must be at least 8 characters').max(256),
});

/** Admin-assisted DSO/multi-location org creation (POST /api/admin/organizations). */
export const createOrganizationBodySchema = z.object({
  organizationName: z.string().trim().min(1).max(200),
  practices: z
    .array(
      z.object({
        practiceName: z.string().trim().min(1).max(200),
        timezone: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .min(1, 'at least one practice is required')
    .max(50, 'use a batch import for organizations larger than 50 locations'),
  /** Invited as group_admin on the first practice — sees the cross-practice dashboard. */
  primaryContact: z.object({
    email: z.string().email().toLowerCase(),
    displayName: z.string().trim().min(1).max(120),
  }),
});

/**
 * Batch PMS import (POST /api/group/pms-import) — replaces the admin-run
 * per-practice loop with one authorized call across an org's practices.
 * Each entry runs through the same runPmsImportPipeline as the single-practice
 * upload; the route validates every practiceId belongs to the caller's org
 * before touching it (authorized narrow RLS iteration).
 */
export const groupPmsImportBodySchema = z.object({
  imports: z
    .array(
      z.object({
        practiceId: z.string().uuid(),
        pmsVendor: z.string().trim().min(1),
        records: z.array(z.record(z.string(), z.unknown())).min(1, 'at least one record is required'),
        sourceBalanceTotal: z.coerce.number().finite().optional(),
      }),
    )
    .min(1, 'at least one practice import is required')
    .max(50, 'batch imports are capped at 50 practices per call'),
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
    pmsVendor: z.string().trim().optional(),
    /** @deprecated Use pmsVendor */
    pmsSource: z.string().trim().optional(),
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
