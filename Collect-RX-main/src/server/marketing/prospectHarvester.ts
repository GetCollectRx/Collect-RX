/**
 * Prospect Harvester
 *
 * Queries Google Places API (Text Search) for dental practices in a given
 * city/province, then upserts them into ProspectPractice — deduplicating by
 * phone number and name+city combo.
 *
 * Requires env: GOOGLE_PLACES_API_KEY
 *
 * Called from:
 *   - POST /api/marketing/harvest  (admin UI trigger)
 *   - Future: nightly cron
 */

import type { PrismaClient } from '@prisma/client';

interface PlacesResult {
  place_id: string;
  name: string;
  formatted_address: string;
  formatted_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
}

interface PlacesTextSearchResponse {
  results: Array<{
    place_id: string;
    name: string;
    formatted_address: string;
    business_status?: string;
  }>;
  next_page_token?: string;
  status: string;
}

interface PlaceDetailResponse {
  result: PlacesResult;
  status: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<T>;
}

/** Parse Canadian province from a formatted_address string. */
function extractProvince(address: string): string | null {
  const provinceCodes = ['ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'NU', 'YT'];
  for (const code of provinceCodes) {
    if (new RegExp(`\\b${code}\\b`).test(address)) return code;
  }
  return null;
}

/** Parse city from "Street, City, Province Postal, Canada" formatted_address. */
function extractCity(address: string): string | null {
  const parts = address.split(',').map((s) => s.trim());
  if (parts.length >= 2) return parts[1] || null;
  return null;
}

/** Parse postal code (Canadian A1A 1A1 format). */
function extractPostal(address: string): string | null {
  const m = address.match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i);
  return m ? m[0].toUpperCase() : null;
}

/** Rough practice-size guess based on ratings count. */
function guessPracticeSize(userRatings: number | undefined): 'solo' | 'small_group' | 'large_group' {
  if (!userRatings || userRatings < 20) return 'solo';
  if (userRatings < 100) return 'small_group';
  return 'large_group';
}

/** Score a prospect 0–100 based on data completeness + signals. */
function scoreProspect(p: PlacesResult): number {
  let score = 40;
  if (p.formatted_phone_number) score += 20;
  if (p.website) score += 15;
  if (p.rating && p.rating >= 4.0) score += 10;
  if (p.user_ratings_total && p.user_ratings_total >= 20) score += 10;
  if (p.business_status === 'OPERATIONAL') score += 5;
  return Math.min(100, score);
}

export interface HarvestOptions {
  query?: string;
  city: string;
  province?: string;
  maxResults?: number;
}

export interface HarvestResult {
  found: number;
  created: number;
  skipped: number;
  errors: number;
}

export async function harvestProspects(
  prisma: PrismaClient,
  opts: HarvestOptions,
): Promise<HarvestResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured');
  }

  const searchQuery = opts.query || `dental practice ${opts.city} ${opts.province || 'Canada'}`;
  const maxResults = Math.min(opts.maxResults || 20, 60);

  const searchUrl =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(searchQuery)}&key=${apiKey}`;

  const searchResp = await fetchJson<PlacesTextSearchResponse>(searchUrl);
  if (searchResp.status !== 'OK' && searchResp.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places API error: ${searchResp.status}`);
  }

  const results = searchResp.results.slice(0, maxResults);
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const place of results) {
    try {
      const detailUrl =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${place.place_id}&fields=name,formatted_phone_number,website,rating,user_ratings_total,formatted_address,business_status&key=${apiKey}`;

      const detailResp = await fetchJson<PlaceDetailResponse>(detailUrl);
      if (detailResp.status !== 'OK') {
        errors++;
        continue;
      }

      const detail = detailResp.result;
      const address = detail.formatted_address || place.formatted_address;
      const city = extractCity(address) || opts.city;
      const province = extractProvince(address) || opts.province || null;
      const postalCode = extractPostal(address);
      const practiceSize = guessPracticeSize(detail.user_ratings_total);
      const score = scoreProspect(detail);

      // Dedup: phone match OR name+city match
      const existing = await prisma.prospectPractice.findFirst({
        where: {
          OR: [
            ...(detail.formatted_phone_number ? [{ phone: detail.formatted_phone_number }] : []),
            { name: detail.name, city },
          ],
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      const now = new Date();
      await prisma.prospectPractice.create({
        data: {
          name: detail.name,
          city,
          province,
          postalCode,
          phone: detail.formatted_phone_number || null,
          website: detail.website || null,
          source: 'google_places',
          stage: 'new',
          practiceSize,
          score,
          updatedAt: now,
        },
      });

      await prisma.prospectEvent.create({
        data: {
          prospectId: (
            await prisma.prospectPractice.findFirst({ where: { name: detail.name, city }, orderBy: { createdAt: 'desc' } })
          )!.id,
          type: 'harvested',
          metadata: { source: 'google_places', placeId: place.place_id, rating: detail.rating },
          occurredAt: now,
        },
      });

      created++;
    } catch (err) {
      console.error(`[prospectHarvester] Error processing place ${place.place_id}:`, err);
      errors++;
    }
  }

  return { found: results.length, created, skipped, errors };
}
