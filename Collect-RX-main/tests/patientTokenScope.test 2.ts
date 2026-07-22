import { describe, expect, it, vi } from 'vitest';
import { patientTokenBelongsToPractice } from '../src/server/accessControl/patientTokenScope.js';

describe('patientTokenBelongsToPractice', () => {
  it('returns true when token exists on a claim for the practice', async () => {
    const prisma = {
      insuranceClaim: { findFirst: vi.fn().mockResolvedValue({ id: 'c1' }) },
      appointmentVerification: { findFirst: vi.fn().mockResolvedValue(null) },
      scheduledAppointment: { findFirst: vi.fn().mockResolvedValue(null) },
      cdcpReconsiderationCase: { findFirst: vi.fn().mockResolvedValue(null) },
      adjudicationEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(patientTokenBelongsToPractice(prisma as never, 'prac-1', 'tok-1')).resolves.toBe(true);
  });

  it('returns false when token is not referenced by the practice', async () => {
    const prisma = {
      insuranceClaim: { findFirst: vi.fn().mockResolvedValue(null) },
      appointmentVerification: { findFirst: vi.fn().mockResolvedValue(null) },
      scheduledAppointment: { findFirst: vi.fn().mockResolvedValue(null) },
      cdcpReconsiderationCase: { findFirst: vi.fn().mockResolvedValue(null) },
      adjudicationEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(patientTokenBelongsToPractice(prisma as never, 'prac-1', 'tok-x')).resolves.toBe(false);
  });

  it('returns false for blank token', async () => {
    const prisma = {
      insuranceClaim: { findFirst: vi.fn() },
      appointmentVerification: { findFirst: vi.fn() },
      scheduledAppointment: { findFirst: vi.fn() },
      cdcpReconsiderationCase: { findFirst: vi.fn() },
      adjudicationEvent: { findFirst: vi.fn() },
    };
    await expect(patientTokenBelongsToPractice(prisma as never, 'prac-1', '  ')).resolves.toBe(false);
    expect(prisma.insuranceClaim.findFirst).not.toHaveBeenCalled();
  });
});
