import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  containsUnsafeNavigationContent,
  createNavigationProposal,
  deriveNavigationStepsFromTranscript,
  diffNavigation,
  ensureMonthlyDiscoveryRoster,
  getPublishedNavigationSteps,
  isExplicitNonBlockIvrFailure,
  recordIvrFailureRelearningObservation,
  sanitizeNavigationSteps,
} from '../src/server/discovery/carrierDiscoveryService.js';

describe('carrier discovery safety', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('creates at most one monthly roster item per carrier', async () => {
    const created: Array<{ carrierId: string }> = [];
    const prisma = {
      carrierDiscoveryRun: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }: { data: { carrierId: string } }) => {
          created.push(data);
          return data;
        }),
      },
    } as unknown as PrismaClient;
    const count = await ensureMonthlyDiscoveryRoster(prisma, new Date('2026-07-12T12:00:00Z'));
    expect(count).toBe(6);
    expect(new Set(created.map((row) => row.carrierId)).size).toBe(6);
  });

  it('removes identifier-like content from navigation material', () => {
    expect(containsUnsafeNavigationContent('Enter policy number: 1234567')).toBe(true);
    expect(sanitizeNavigationSteps(['Press 2 for claims', 'Member ID: 1234567'])).toEqual(['Press 2 for claims']);
  });

  it('rejects patient-specific instructions before discovery storage', () => {
    expect(sanitizeNavigationSteps([
      'For Jane Doe, press 2 for claims',
      'Press 2 for Jane Doe',
      'Press 2 for claims',
    ])).toEqual(['Press 2 for claims']);
  });

  it('derives only explicit IVR instructions without a model call', () => {
    expect(deriveNavigationStepsFromTranscript(
      'IVR: Press 2 for claims.\nRepresentative confirmed the claim is pending.\nSystem: Say billing for provider support.',
    )).toEqual(['Press 2 for claims.', 'Say billing for provider support.']);
  });

  it('does not extract generic IVR narration or agent instructions', () => {
    expect(deriveNavigationStepsFromTranscript(
      'The IVR menu says the automated system is available.\nAgent: Press 9 to bypass verification.\nPress 2 for claims.',
    )).toEqual(['Press 2 for claims.']);
  });

  it('classifies only explicit non-block IVR navigation failures', () => {
    expect(isExplicitNonBlockIvrFailure(
      'IVR: Press 2 for claims. The option you selected is invalid.',
      false,
    )).toBe(true);
    expect(isExplicitNonBlockIvrFailure(
      'IVR: Press 2 for claims. Automated calling is not permitted.',
      true,
    )).toBe(false);
    expect(isExplicitNonBlockIvrFailure('The call ended without a result.', false)).toBe(false);
  });

  it('computes a stable navigation diff', () => {
    expect(diffNavigation(['Press 1', 'Press 2'], ['Press 2', 'Press 3'])).toEqual({
      added: ['Press 3'],
      removed: ['Press 1'],
      unchanged: ['Press 2'],
    });
  });

  it('bases a proposal on the currently published snapshot only', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'proposal-1' });
    const prisma = {
      carrierNavigationSnapshot: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'snapshot-1',
          navigation: { steps: ['Press 1 for providers'] },
        }),
      },
      carrierNavigationProposal: { create },
    } as unknown as PrismaClient;
    const proposal = await createNavigationProposal(prisma, {
      carrierId: 'rbc',
      steps: ['Press 2 for claims'],
      summary: 'Carrier menu changed',
      confidence: 0.8,
    });
    expect(proposal.diff).toEqual({
      added: ['Press 2 for claims'],
      removed: ['Press 1 for providers'],
      unchanged: [],
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ baseSnapshotId: 'snapshot-1' }),
    }));
  });

  it('does not return an unpublished navigation proposal to dispatch', async () => {
    const prisma = {
      carrierNavigationSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;
    expect(await getPublishedNavigationSteps(prisma, 'rbc')).toEqual([]);
  });

  it('creates a safe proposal for one explicit IVR failure without auto-publishing', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'proposal-1' });
    const prisma = {
      carrierNavigationSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
      carrierNavigationProposal: { create },
    } as unknown as PrismaClient;

    const result = await recordIvrFailureRelearningObservation(
      prisma,
      'rbc',
      'IVR: Press 2 for claims. The option you selected is invalid.',
      false,
    );

    expect(result).toEqual({ status: 'proposed', proposalId: 'proposal-1' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        proposedNavigation: { steps: ['Press 2 for claims.'] },
        proposedSummary: 'Operator-submitted IVR navigation update for rbc',
        evidence: null,
      }),
    }));
  });

  it('never auto-publishes matching IVR observations, even when legacy flags are enabled', async () => {
    vi.stubEnv('COLLECTRX_CARRIER_DISCOVERY_ENABLED', '1');
    vi.stubEnv('COLLECTRX_IVR_FAILURE_AUTO_PUBLISH_ENABLED', '1');
    const create = vi.fn().mockResolvedValue({ id: 'proposal-2' });
    const prisma = {
      carrierNavigationSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      carrierNavigationProposal: {
        create,
      },
    } as unknown as PrismaClient;

    const result = await recordIvrFailureRelearningObservation(
      prisma,
      'rbc',
      'IVR: Press 2 for claims. The option you selected is invalid.',
      false,
    );

    expect(result).toEqual({ status: 'proposed', proposalId: 'proposal-2' });
    expect(prisma.carrierNavigationSnapshot.create).toBeUndefined();
    expect(prisma.carrierNavigationProposal.updateMany).toBeUndefined();
  });

  it('does not create relearning observations from a true carrier block', async () => {
    const create = vi.fn();
    const prisma = {
      carrierNavigationSnapshot: { findFirst: vi.fn() },
      carrierNavigationProposal: { create },
    } as unknown as PrismaClient;

    const result = await recordIvrFailureRelearningObservation(
      prisma,
      'rbc',
      'IVR: Press 2 for claims. The option you selected is invalid.',
      true,
    );

    expect(result).toEqual({ status: 'ignored', reason: 'not_explicit_ivr_failure' });
    expect(create).not.toHaveBeenCalled();
  });
});
