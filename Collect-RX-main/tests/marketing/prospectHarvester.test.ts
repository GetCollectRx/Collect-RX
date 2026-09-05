import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { harvestProspects } from '../../src/server/marketing/prospectHarvester.js';

function mockPrisma(opts: { existing?: unknown } = {}) {
  return {
    prospect: {
      findFirst: vi.fn().mockResolvedValue(opts.existing ?? null),
      create: vi.fn().mockResolvedValue({}),
    },
    marketingScoreConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaClient;
}

describe('harvestProspects', () => {
  afterEach(() => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a config error and imports nothing when GOOGLE_PLACES_API_KEY is unset', async () => {
    const prisma = mockPrisma();
    const result = await harvestProspects(prisma, { query: 'dentist' });
    expect(result).toEqual({
      imported: 0,
      skipped: 0,
      errors: ['GOOGLE_PLACES_API_KEY not set — add key or create prospects manually'],
    });
    expect(prisma.prospect.create).not.toHaveBeenCalled();
  });

  it('parses Places API results and creates new prospects', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    const places = [
      {
        name: 'Downtown Dental',
        formatted_address: '123 Main St, Toronto, ON, Canada',
        place_id: 'place-1',
        rating: 4.7,
        website: 'https://downtown.ca',
        formatted_phone_number: '4165550100',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ status: 'OK', results: places }),
      }),
    );

    const prisma = mockPrisma();
    const result = await harvestProspects(prisma, { query: 'dentist', city: 'Toronto', province: 'ON' });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(prisma.prospect.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          practiceName: 'Downtown Dental',
          phone: '4165550100',
          website: 'https://downtown.ca',
          googlePlaceId: 'place-1',
          source: 'harvest',
          stage: 'new',
        }),
      }),
    );
  });

  it('skips a place that already exists by googlePlaceId', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            status: 'OK',
            results: [{ name: 'Existing Dental', place_id: 'place-existing' }],
          }),
      }),
    );

    const prisma = mockPrisma({
      existing: { id: 'already-there', lastEmailSentAt: new Date(), activities: [] },
    });
    const result = await harvestProspects(prisma, { query: 'dentist' });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(prisma.prospect.create).not.toHaveBeenCalled();
  });

  it('surfaces a Places API error status without throwing', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({ status: 'REQUEST_DENIED', error_message: 'API key invalid' }),
      }),
    );

    const prisma = mockPrisma();
    const result = await harvestProspects(prisma, { query: 'dentist' });

    expect(result.imported).toBe(0);
    expect(result.errors).toEqual(['API key invalid']);
  });

  it('treats ZERO_RESULTS as a clean empty harvest, not an error', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ status: 'ZERO_RESULTS' }),
      }),
    );

    const prisma = mockPrisma();
    const result = await harvestProspects(prisma, { query: 'dentist' });

    expect(result).toEqual({ imported: 0, skipped: 0, errors: [] });
  });

  it('records a network error without throwing', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const prisma = mockPrisma();
    const result = await harvestProspects(prisma, { query: 'dentist' });

    expect(result.imported).toBe(0);
    expect(result.errors).toEqual(['network down']);
  });
});
