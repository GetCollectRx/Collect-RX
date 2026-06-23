import type { PrismaClient, ProspectStage } from '@prisma/client';

const DEFAULT_STAGE_MAP: Record<string, string> = {
  new: 'appointmentscheduled',
  contacted: 'appointmentscheduled',
  engaged: 'qualifiedtobuy',
  qualified: 'qualifiedtobuy',
  demo_booked: 'presentationscheduled',
  closed_won: 'closedwon',
  closed_lost: 'closedlost',
  opted_out: 'closedlost',
};

function hubspotToken(): string | null {
  return process.env.HUBSPOT_ACCESS_TOKEN?.trim() || null;
}

function stageToDealStage(stage: ProspectStage): string {
  const raw = process.env.HUBSPOT_DEAL_STAGE_MAP?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed[stage]) return parsed[stage];
    } catch {
      /* use defaults */
    }
  }
  return DEFAULT_STAGE_MAP[stage] ?? 'appointmentscheduled';
}

async function hubspotFetch(path: string, init: RequestInit): Promise<Response> {
  const token = hubspotToken();
  if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN not configured');
  return fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function upsertHubspotContact(prospect: {
  email: string | null;
  contactName: string | null;
  practiceName: string;
  phone: string | null;
  city: string | null;
  province: string | null;
}): Promise<string | null> {
  if (!prospect.email?.trim()) return null;

  const searchRes = await hubspotFetch('/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [{ propertyName: 'email', operator: 'EQ', value: prospect.email.trim() }],
        },
      ],
      properties: ['email'],
      limit: 1,
    }),
  });

  if (searchRes.ok) {
    const search = (await searchRes.json()) as { results?: { id: string }[] };
    if (search.results?.[0]?.id) return search.results[0].id;
  }

  const createRes = await hubspotFetch('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        email: prospect.email.trim(),
        firstname: prospect.contactName?.split(' ')[0] || prospect.practiceName,
        lastname: prospect.contactName?.split(' ').slice(1).join(' ') || '',
        phone: prospect.phone || '',
        city: prospect.city || '',
        state: prospect.province || '',
        company: prospect.practiceName,
      },
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`HubSpot contact create failed: ${createRes.status} ${errText.slice(0, 200)}`);
  }

  const created = (await createRes.json()) as { id: string };
  return created.id;
}

export async function syncProspectStageToHubspot(
  prisma: PrismaClient,
  prospectId: string,
  stage?: ProspectStage,
): Promise<{ dealId: string | null; synced: boolean }> {
  if (!hubspotToken()) return { dealId: null, synced: false };

  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect) return { dealId: null, synced: false };

  const targetStage = stage ?? prospect.stage;
  const dealStage = stageToDealStage(targetStage);
  let dealId = prospect.hubspotDealId;

  if (!dealId) {
    const contactId = await upsertHubspotContact(prospect);
    const createRes = await hubspotFetch('/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          dealname: prospect.practiceName,
          dealstage: dealStage,
          pipeline: process.env.HUBSPOT_PIPELINE_ID || 'default',
        },
        associations: contactId
          ? [
              {
                to: { id: contactId },
                types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
              },
            ]
          : undefined,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`HubSpot deal create failed: ${createRes.status} ${errText.slice(0, 200)}`);
    }

    const created = (await createRes.json()) as { id: string };
    dealId = created.id;
    await prisma.prospect.update({
      where: { id: prospectId },
      data: { hubspotDealId: dealId },
    });
  } else {
    const patchRes = await hubspotFetch(`/crm/v3/objects/deals/${dealId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { dealstage: dealStage } }),
    });
    if (!patchRes.ok) {
      const errText = await patchRes.text();
      throw new Error(`HubSpot deal update failed: ${patchRes.status} ${errText.slice(0, 200)}`);
    }
  }

  return { dealId, synced: true };
}
