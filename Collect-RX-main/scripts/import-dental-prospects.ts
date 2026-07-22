import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function importDentalProspects() {
  try {
    // Read enriched emails from JSON file
    const enrichedPath = path.resolve(__dirname, '../../enriched_emails.json');
    if (!fs.existsSync(enrichedPath)) {
      console.error('Enriched emails file not found at', enrichedPath);
      process.exit(1);
    }

    const enrichedData = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));
    const enrichedMap: Record<string, string> = {};

    // Flatten all batches into a practice name → email map
    Object.keys(enrichedData).forEach((key) => {
      if (key === 'enrichment_summary') return;
      const batch = enrichedData[key];
      if (Array.isArray(batch)) {
        batch.forEach((item: { practice_name: string; email: string }) => {
          enrichedMap[item.practice_name.toLowerCase()] = item.email;
        });
      }
    });

    console.log(`Loaded ${Object.keys(enrichedMap).length} enriched emails`);

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
        notes: 'Initial cold outreach to 101 dental practices in Ottawa and GTA area with verified emails',
        active: true,
      },
    });

    console.log(`Created campaign: ${campaign.name} (ID: ${campaign.id})`);

    // Import prospects
    const prospects = [];
    let skippedNoEmail = 0;
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

      // Look up email from enriched map
      const email = enrichedMap[practiceName.toLowerCase()];

      // Skip practices without emails (no verified contact found)
      if (!email) {
        skippedNoEmail++;
        continue;
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
