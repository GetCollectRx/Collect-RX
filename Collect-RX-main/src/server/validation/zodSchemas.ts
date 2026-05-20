import { z } from 'zod';

export const loginBodySchema = z.object({
  practiceId: z.string().uuid('practiceId must be a valid UUID'),
  password: z.string().min(1, 'password is required').max(256),
});

export const platformDevLoginBodySchema = z.object({
  password: z.string().min(1, 'password is required').max(256),
});

export const carrierUnblockBodySchema = z.object({
  resumedBy: z.string().trim().min(1).max(120),
  notes: z.string().max(2000).optional(),
  practiceId: z.string().uuid().optional(),
});

export const pmsImportBodySchema = z
  .object({
    records: z.array(z.record(z.unknown())).optional(),
    sourceBalanceTotal: z.coerce.number().finite().optional(),
  })
  .passthrough();

export type LoginBody = z.infer<typeof loginBodySchema>;
export type CarrierUnblockBody = z.infer<typeof carrierUnblockBodySchema>;

export function formatZodError(err: z.ZodError): string {
  const first = err.errors[0];
  return first?.message ?? 'Invalid request body';
}
