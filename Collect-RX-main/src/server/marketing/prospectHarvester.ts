import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  computeProspectScore,
  loadScoreWeights,
  signalsFromHarvestPlace,
} from './prospectScoring.js';

export interface HarvestInput {
  query: string;
  city?: string;
  province?: string;
  limit?: number;
  campaignId?: string;
}

export interface HarvestResult {
  imported: number;
  skipped: number;
  errors: string[];
}

interface PlaceResult {
  name: string;
  formatted_address?: string;
  place_id?: string;
  rating?: number;
  website?: string;
  formatted_phone_number?: string;
}

function parseCityProvince(address?: string): { city?: string; province?: string } {
  if (!address) return {};
  const parts = address.split(',').map((s) => s.trim());
  if (parts.length >= 2) {
    return { city: parts[parts.length - 3] || parts[0], province: parts[parts.length - 2] };
  }
  return { city: parts[0] };
}

export async function harvestProspects(
  prisma: PrismaClient,
  input: HarvestInput,
): Promise<HarvestResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const limit = Math.min(input.limit ?? 20, 40);
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  const weights = await loadScoreWeights(prisma);

  if (!apiKey) {
    return {
      imported: 0,
      skipped: 0,
      errors: ['GOOGLE_PLACES_API_KEY not set — add key or create prospects manually'],
    };
  }

  const textQuery = [input.query, input.city, input.province, 'Canada'].filter(Boolean).join(' ');
  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', textQuery);
  url.searchParams.set('key', apiKey);

  let places: PlaceResult[] = [];
  try {
    const res = await fetch(url.toString());
    const data = (await res.json()) as { results?: PlaceResult[]; error_message?: string; status?: string };
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      errors.push(data.error_message || `Places API status: ${data.status}`);
      return { imported, skipped, errors };
    }
    places = (data.results ?? []).slice(0, limit);
  } catch (err) {
    errors.push((err as Error).message);
    return { imported, skipped, errors };
  }

  for (const place of places) {
    const { city, province } = parseCityProvince(place.formatted_address);

    // Dedup strategy (in order of precedence):
    // 1. Email-based dedup (if we have one from Google Places, though unlikely)
    // 2. Google Place ID (exact match)
    // 3. Practice name + city (case-insensitive, same discovery session)

    let existing = null;

    // Check by Google Place ID first (most reliable)
    if (place.place_id) {
      existing = await prisma.prospect.findFirst({
        where: { googlePlaceId: place.place_id },
        include: { activities: { orderBy: { createdAt: 'desc' }, take: 5 } },
      });
    }

    // Fall back to practice name + city match if no place_id
    if (!existing) {
      existing = await prisma.prospect.findFirst({
        where: {
          practiceName: { equals: place.name, mode: 'insensitive' },
          city: { equals: input.city ?? city ?? undefined, mode: 'insensitive' },
        },
        include: { activities: { orderBy: { createdAt: 'desc' }, take: 5 } },
      });
    }

    if (existing) {
      // Contact already exists — check if re-engagement is allowed
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

      // Skip if recently emailed (< 60 days)
      if (existing.lastEmailSentAt && existing.lastEmailSentAt > sixtyDaysAgo) {
        skipped++;
        continue;
      }

      // Skip if opted out
      if (existing.optOutAt) {
        skipped++;
        continue;
      }

      // Check for recent cross-channel engagement (LinkedIn, calls, etc. in ProspectActivity)
      const recentActivity = existing.activities.find((a) => {
        const activityDate = new Date(a.createdAt);
        // 30-day cooldown on cross-channel engagement
        return activityDate > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      });

      if (recentActivity) {
        skipped++;
        continue;
      }

      // Re-engagement eligible — update existing record instead of skipping
      // Refresh the record with latest discovery data
      await prisma.prospect.update({
        where: { id: existing.id },
        data: {
          practiceName: place.name, // Update in case name changed
          phone: place.formatted_phone_number ?? existing.phone,
          website: place.website ?? existing.website,
          googlePlaceId: place.place_id ?? existing.googlePlaceId,
          score: computeProspectScore(signalsFromHarvestPlace(place), weights),
          metadata: {
            ...((existing.metadata as Record<string, unknown>) || {}),
            harvestQuery: textQuery,
            rating: place.rating ?? null,
            reharvestedAt: new Date().toISOString(),
          },
        },
      });
      imported++;
      continue;
    }

    // New prospect — create record
    await prisma.prospect.create({
      data: {
        id: randomUUID(),
        practiceName: place.name,
        phone: place.formatted_phone_number ?? null,
        website: place.website ?? null,
        city: input.city ?? city ?? null,
        province: input.province ?? province ?? null,
        googlePlaceId: place.place_id ?? null,
        score: computeProspectScore(signalsFromHarvestPlace(place), weights),
        stage: 'new',
        source: 'harvest',
        campaignId: input.campaignId ?? null,
        metadata: { harvestQuery: textQuery, rating: place.rating ?? null },
      },
    });
    imported++;
  }

  return { imported, skipped, errors };
}
