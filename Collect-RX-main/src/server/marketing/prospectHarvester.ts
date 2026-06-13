import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export interface HarvestInput {
  query: string;
  city?: string;
  province?: string;
  limit?: number;
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

function scorePlace(p: PlaceResult): number {
  let score = 40;
  if (p.formatted_phone_number) score += 20;
  if (p.website) score += 15;
  if (p.rating && p.rating >= 4) score += 15;
  if (p.rating && p.rating >= 4.5) score += 10;
  return Math.min(100, score);
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
    const existing = place.place_id
      ? await prisma.prospect.findFirst({ where: { googlePlaceId: place.place_id } })
      : await prisma.prospect.findFirst({
          where: { practiceName: { equals: place.name, mode: 'insensitive' }, city: city ?? undefined },
        });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.prospect.create({
      data: {
        id: randomUUID(),
        practiceName: place.name,
        phone: place.formatted_phone_number ?? null,
        website: place.website ?? null,
        city: input.city ?? city ?? null,
        province: input.province ?? province ?? null,
        googlePlaceId: place.place_id ?? null,
        score: scorePlace(place),
        stage: 'new',
        source: 'harvest',
        metadata: { harvestQuery: textQuery, rating: place.rating ?? null },
      },
    });
    imported++;
  }

  return { imported, skipped, errors };
}
