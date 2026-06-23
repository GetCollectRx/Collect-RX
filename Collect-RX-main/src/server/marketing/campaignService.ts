import type { Prisma, PrismaClient } from '@prisma/client';
import { harvestProspects, type HarvestInput, type HarvestResult } from './prospectHarvester.js';

export interface CreateCampaignInput {
  name: string;
  targetProvinces?: string[];
  harvestQuery?: string;
  maxProspects?: number;
  notes?: string;
}

export async function listCampaigns(prisma: PrismaClient) {
  const rows = await prisma.marketingCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { prospects: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    targetProvinces: c.targetProvinces,
    harvestQuery: c.harvestQuery,
    maxProspects: c.maxProspects,
    active: c.active,
    notes: c.notes,
    prospectCount: c._count.prospects,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

export async function createCampaign(prisma: PrismaClient, input: CreateCampaignInput) {
  const name = input.name.trim();
  if (!name) throw new Error('Campaign name required');

  return prisma.marketingCampaign.create({
    data: {
      name,
      targetProvinces: input.targetProvinces?.length
        ? (input.targetProvinces as unknown as Prisma.InputJsonValue)
        : undefined,
      harvestQuery: input.harvestQuery?.trim() || null,
      maxProspects: input.maxProspects ?? null,
      notes: input.notes?.trim() || null,
    },
  });
}

export async function harvestForCampaign(
  prisma: PrismaClient,
  campaignId: string,
  overrides: Partial<HarvestInput> = {},
): Promise<HarvestResult> {
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error('Campaign not found');
  if (!campaign.active) throw new Error('Campaign is inactive');

  const currentCount = await prisma.prospect.count({ where: { campaignId } });
  if (campaign.maxProspects != null && currentCount >= campaign.maxProspects) {
    return {
      imported: 0,
      skipped: 0,
      errors: [`Campaign cap reached (${campaign.maxProspects} prospects)`],
    };
  }

  const query = overrides.query?.trim() || campaign.harvestQuery?.trim();
  if (!query) throw new Error('Harvest query required on campaign or request body');

  const provinces = Array.isArray(campaign.targetProvinces)
    ? (campaign.targetProvinces as string[])
    : [];
  const province = overrides.province || provinces[0];

  const remaining =
    campaign.maxProspects != null ? Math.max(0, campaign.maxProspects - currentCount) : undefined;
  const limit = overrides.limit ?? remaining ?? 20;

  const result = await harvestProspects(prisma, {
    query,
    city: overrides.city,
    province,
    limit,
    campaignId,
  });

  return result;
}
