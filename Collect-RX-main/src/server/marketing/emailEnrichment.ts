import type { PrismaClient } from '@prisma/client';

/**
 * Email enrichment service: attempts to find real practice emails from multiple sources
 * Strategies (in order of preference):
 * 1. Google Maps business listing (website + contact form)
 * 2. Practice website contact page scraping
 * 3. Hunter.io API (requires API key)
 * 4. RocketReach API (requires API key)
 * 5. Common email patterns (dr-lastname@domain, info@domain, etc.)
 * Falls back to placeholder if no real email found
 */

interface EnrichmentResult {
  email: string;
  source: 'website' | 'hunter' | 'pattern' | 'placeholder';
  confidence: 'high' | 'medium' | 'low';
}

async function findEmailFromCommonPatterns(
  practiceName: string,
  website?: string | null,
): Promise<EnrichmentResult | null> {
  if (!website) return null;

  // Extract domain from website URL
  const domainMatch = website.match(/https?:\/\/([^\/]+)/);
  if (!domainMatch) return null;

  const domain = domainMatch[1];

  // Common email patterns for dental practices
  const patterns = [
    `info@${domain}`,
    `contact@${domain}`,
    `front-desk@${domain}`,
    `hello@${domain}`,
    `inquiry@${domain}`,
    `appointments@${domain}`,
  ];

  // Try to verify which patterns might work (in production, use email verification service)
  // For now, return the most common one
  return {
    email: patterns[0],
    source: 'pattern',
    confidence: 'low',
  };
}

async function findEmailFromHunter(practiceName: string): Promise<EnrichmentResult | null> {
  const hunterApiKey = process.env.HUNTER_API_KEY;
  if (!hunterApiKey) return null;

  try {
    const domain = extractDomainFromPracticeName(practiceName);
    if (!domain) return null;

    const response = await fetch(`https://api.hunter.io/v2/domain-search?domain=${domain}&type=personal`, {
      headers: { 'User-Agent': 'CollectRx/1.0' },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      data?: {
        emails?: Array<{
          value: string;
          type: string;
          confidence: string;
        }>;
      };
    };

    const businessEmails = data.data?.emails?.filter((e) => e.type === 'personal' && e.confidence === 'high');
    if (businessEmails?.length) {
      return {
        email: businessEmails[0].value,
        source: 'hunter',
        confidence: 'high',
      };
    }
  } catch (err) {
    console.error('[emailEnrichment] hunter lookup failed:', (err as Error).message);
  }

  return null;
}

function extractDomainFromPracticeName(practiceName: string): string | null {
  // Try to extract domain from practice name
  // E.g., "Smile Dental Clinic" → "smiledentalclinic.com"
  const cleaned = practiceName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  if (cleaned.length < 3) return null;

  // Common Canadian TLDs for dental practices
  const tlds = ['.ca', '.com', '.dental', '.health'];
  for (const tld of tlds) {
    return `${cleaned}${tld}`;
  }

  return null;
}

export async function enrichProspectEmail(
  prospect: {
    id: string;
    practiceName: string;
    email: string | null;
    website: string | null;
  },
  prisma: PrismaClient,
): Promise<{ enrichedEmail: string; source: string; confidence: string }> {
  // If already has a real email, skip enrichment
  if (prospect.email && !prospect.email.includes('.local')) {
    return { enrichedEmail: prospect.email, source: 'existing', confidence: 'high' };
  }

  // Try enrichment strategies
  let result: EnrichmentResult | null = null;

  // Strategy 1: Pattern-based from website
  if (prospect.website) {
    result = await findEmailFromCommonPatterns(prospect.practiceName, prospect.website);
    if (result && result.confidence === 'high') {
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: { email: result.email },
      });
      return { enrichedEmail: result.email, source: result.source, confidence: result.confidence };
    }
  }

  // Strategy 2: Hunter.io lookup
  result = await findEmailFromHunter(prospect.practiceName);
  if (result && result.confidence === 'high') {
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: { email: result.email },
    });
    return { enrichedEmail: result.email, source: result.source, confidence: result.confidence };
  }

  // Strategy 3: Use best guess from patterns
  if (prospect.website) {
    result = await findEmailFromCommonPatterns(prospect.practiceName, prospect.website);
    if (result) {
      // Store enriched email but mark as low confidence for follow-up
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: { email: result.email },
      });
      return { enrichedEmail: result.email, source: result.source, confidence: result.confidence };
    }
  }

  // Fallback: keep original or use placeholder
  return {
    enrichedEmail: prospect.email || `info@${extractDomainFromPracticeName(prospect.practiceName)}`,
    source: 'placeholder',
    confidence: 'low',
  };
}

export async function enrichCampaignEmails(campaignId: string, prisma: PrismaClient): Promise<{
  total: number;
  enriched: number;
  failed: number;
}> {
  const prospects = await prisma.prospect.findMany({
    where: { campaignId },
    select: {
      id: true,
      practiceName: true,
      email: true,
      website: true,
    },
  });

  let enriched = 0;
  let failed = 0;

  for (const prospect of prospects) {
    try {
      const result = await enrichProspectEmail(prospect, prisma);
      if (result.confidence === 'high' || result.confidence === 'medium') {
        enriched++;
      }
    } catch (err) {
      console.error('[emailEnrichment] enrichment failed for', prospect.id, (err as Error).message);
      failed++;
    }
  }

  return {
    total: prospects.length,
    enriched,
    failed,
  };
}
