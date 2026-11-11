import type { PrismaClient } from '@prisma/client';
import { harvestForCampaign } from '../marketing/campaignService.js';
import { logger } from '../observability/logger.js';

export interface ProspectHarvestResult {
  campaignId: string;
  campaignName: string;
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Automated prospect harvesting for active campaigns.
 * Queries Google Places API for each campaign's harvestQuery and target provinces,
 * respecting maxProspects limits. Runs on a configurable schedule (default: daily at 2 AM ET).
 */
export async function runProspectHarvesting(prisma: PrismaClient): Promise<ProspectHarvestResult[]> {
  const results: ProspectHarvestResult[] = [];

  if (!process.env.GOOGLE_PLACES_API_KEY?.trim()) {
    logger.warn('[prospectHarvesting] GOOGLE_PLACES_API_KEY not set — skipping harvest', {});
    return results;
  }

  // Get all active campaigns with a harvest query
  const campaigns = await prisma.marketingCampaign.findMany({
    where: {
      active: true,
      harvestQuery: { not: null },
    },
  });

  if (campaigns.length === 0) {
    logger.info('[prospectHarvesting] No active campaigns with harvest queries', {});
    return results;
  }

  for (const campaign of campaigns) {
    try {
      // Harvest for each target province (or once if no specific provinces set)
      const targetProvinces = Array.isArray(campaign.targetProvinces)
        ? (campaign.targetProvinces as string[])
        : [];
      const provinceList = targetProvinces.length > 0 ? targetProvinces : [undefined];

      for (const province of provinceList) {
        const harvestResult = await harvestForCampaign(prisma, campaign.id, {
          province,
          limit: 10, // Conservative per-call limit to avoid rate limiting
        });

        if (harvestResult.imported > 0 || harvestResult.errors.length > 0) {
          results.push({
            campaignId: campaign.id,
            campaignName: campaign.name,
            imported: harvestResult.imported,
            skipped: harvestResult.skipped,
            errors: harvestResult.errors,
          });

          logger.info('[prospectHarvesting] Campaign harvest complete', {
            campaignId: campaign.id,
            campaignName: campaign.name,
            province,
            imported: harvestResult.imported,
            skipped: harvestResult.skipped,
            errors: harvestResult.errors.length > 0 ? harvestResult.errors[0] : null,
          });
        }
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      results.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        imported: 0,
        skipped: 0,
        errors: [errorMsg],
      });

      logger.error('[prospectHarvesting] Campaign harvest failed', {
        campaignId: campaign.id,
        campaignName: campaign.name,
        error: errorMsg,
      });
    }
  }

  const totalImported = results.reduce((sum, r) => sum + r.imported, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  logger.info('[prospectHarvesting] Harvest cycle complete', {
    campaignsProcessed: campaigns.length,
    totalImported,
    totalErrors,
  });

  return results;
}
