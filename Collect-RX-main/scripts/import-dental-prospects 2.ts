import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function importDentalProspects() {
  try {
    // Read CSV file from outreach directory
    const csvPath = path.resolve(__dirname, '../../outreach/dental-prospects-ottawa-gta.csv');
    if (!fs.existsSync(csvPath)) {
      console.error('CSV file not found at', csvPath);
      process.exit(1);
    }

    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = fileContent.split('\n');

    // Parse CSV header
    const headers = lines[0].split(',').map((h) => h.trim());
    const headerMap: Record<string, number> = {};
    headers.forEach((h, idx) => {
      headerMap[h.toLowerCase().replace(/\s+/g, '_')] = idx;
    });

    // Create campaign
    const campaign = await prisma.marketingCampaign.create({
      data: {
        name: 'Ottawa + GTA Dental Practices Q3 2026',
        targetProvinces: ['ON'],
        notes: 'Initial cold outreach to 150 dental practices in Ottawa and GTA area',
        active: true,
      },
    });

    console.log(`Created campaign: ${campaign.name} (ID: ${campaign.id})`);

    // Import prospects
    const prospects = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;

      const values = lines[i].split(',').map((v) => v.trim());

      const practiceName = values[headerMap['practice_name']] || '';
      const owner = values[headerMap['owner_/_principal_(_likely_)']] || '';
      const address = values[headerMap['address']] || '';
      const city = values[headerMap['city']] || '';
      const postalCode = values[headerMap['postal_code']] || '';
      const segment = values[headerMap['segment']] || '';
      const tier = values[headerMap['suggested_tier']] || '';

      if (!practiceName || !city) continue;

      // Try to extract email from general email column if it exists, or build placeholder
      let email = values[headerMap['general_email_(_to_enrich_)']] || '';

      // Improve email by guessing from practice info
      if (!email) {
        const practiceLower = practiceName.toLowerCase().replace(/\s+/g, '');
        email = `info@${practiceLower}.local`; // Placeholder - will be enriched later
      }

      prospects.push({
        practiceName,
        contactName: owner,
        email,
        city,
        province: 'ON',
        website: null,
        googlePlaceId: null,
        score: segment === 'Prime' ? 80 : segment === 'Group' ? 70 : 60,
        stage: 'new' as const,
        source: 'manual' as const,
        campaignId: campaign.id,
        metadata: {
          tier,
          segment,
          postalCode,
          address,
        } as any,
      });
    }

    console.log(`Importing ${prospects.length} prospects...`);

    // Batch insert
    const batchSize = 50;
    let inserted = 0;

    for (let i = 0; i < prospects.length; i += batchSize) {
      const batch = prospects.slice(i, i + batchSize);
      await prisma.prospect.createMany({
        data: batch,
        skipDuplicates: true,
      });
      inserted += batch.length;
      console.log(`Inserted ${inserted}/${prospects.length}`);
    }

    console.log(`✓ Successfully imported ${inserted} prospects into campaign ${campaign.name}`);
    console.log(`\nNext steps:`);
    console.log(`1. Visit Admin > Campaign Manager to see the imported prospects`);
    console.log(`2. Send initial email batch: click "Send Email Batch" button`);
    console.log(`3. Follow-ups will automatically send 5 days after initial send`);
    console.log(`4. Track conversions and replies in the dashboard`);

    process.exit(0);
  } catch (err) {
    console.error('Import failed:', (err as Error).message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

importDentalProspects();
