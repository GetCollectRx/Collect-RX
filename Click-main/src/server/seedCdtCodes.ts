/**
 * Phase 3: CDT Code Database Seed
 * Seeds the most common CDT codes used in general dental practice.
 * Run with: npx tsx src/server/seedCdtCodes.ts
 *
 * Categories:
 *  preventive    — D1000–D1999
 *  restorative   — D2000–D2999
 *  endodontics   — D3000–D3999
 *  periodontics  — D4000–D4999
 *  prosthodontics— D5000–D5999
 *  oral_surgery  — D7000–D7999
 *  orthodontics  — D8000–D8999
 *  adjunctive    — D9000–D9999
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CDT_CODES = [
  // ── Diagnostic ─────────────────────────────────────────────────────────────
  { code: 'D0120', description: 'Periodic oral evaluation', category: 'preventive', subcategory: 'diagnostic', typicalFee: 65 },
  { code: 'D0150', description: 'Comprehensive oral evaluation', category: 'preventive', subcategory: 'diagnostic', typicalFee: 100 },
  { code: 'D0180', description: 'Comprehensive periodontal evaluation', category: 'preventive', subcategory: 'diagnostic', typicalFee: 120 },
  { code: 'D0210', description: 'Full mouth radiographic series (FMX)', category: 'preventive', subcategory: 'radiographic', typicalFee: 160 },
  { code: 'D0220', description: 'Periapical radiographic image — first image', category: 'preventive', subcategory: 'radiographic', typicalFee: 35 },
  { code: 'D0230', description: 'Periapical radiographic image — each additional', category: 'preventive', subcategory: 'radiographic', typicalFee: 25 },
  { code: 'D0240', description: 'Occlusal radiographic image', category: 'preventive', subcategory: 'radiographic', typicalFee: 45 },
  { code: 'D0270', description: 'Bitewing radiographic image — single', category: 'preventive', subcategory: 'radiographic', typicalFee: 30 },
  { code: 'D0272', description: 'Bitewing radiographic images — two images', category: 'preventive', subcategory: 'radiographic', typicalFee: 55 },
  { code: 'D0274', description: 'Bitewing radiographic images — four images', category: 'preventive', subcategory: 'radiographic', typicalFee: 85 },
  { code: 'D0330', description: 'Panoramic radiographic image', category: 'preventive', subcategory: 'radiographic', typicalFee: 175 },

  // ── Preventive ─────────────────────────────────────────────────────────────
  { code: 'D1110', description: 'Prophylaxis — adult', category: 'preventive', subcategory: 'cleaning', typicalFee: 110 },
  { code: 'D1120', description: 'Prophylaxis — child (under 14)', category: 'preventive', subcategory: 'cleaning', typicalFee: 85 },
  { code: 'D1206', description: 'Topical application of fluoride varnish', category: 'preventive', subcategory: 'fluoride', typicalFee: 45 },
  { code: 'D1208', description: 'Topical application of fluoride gel/foam', category: 'preventive', subcategory: 'fluoride', typicalFee: 35 },
  { code: 'D1351', description: 'Sealant — per tooth', category: 'preventive', subcategory: 'sealant', typicalFee: 55 },
  { code: 'D1510', description: 'Space maintainer — fixed, unilateral', category: 'preventive', subcategory: 'space_maintainer', typicalFee: 350 },

  // ── Restorative ───────────────────────────────────────────────────────────
  { code: 'D2140', description: 'Amalgam restoration — 1 surface, primary or permanent', category: 'restorative', subcategory: 'amalgam', typicalFee: 140 },
  { code: 'D2150', description: 'Amalgam restoration — 2 surfaces', category: 'restorative', subcategory: 'amalgam', typicalFee: 175 },
  { code: 'D2160', description: 'Amalgam restoration — 3 surfaces', category: 'restorative', subcategory: 'amalgam', typicalFee: 215 },
  { code: 'D2161', description: 'Amalgam restoration — 4+ surfaces', category: 'restorative', subcategory: 'amalgam', typicalFee: 255 },
  { code: 'D2330', description: 'Resin-based composite — 1 surface, anterior', category: 'restorative', subcategory: 'composite', typicalFee: 155 },
  { code: 'D2331', description: 'Resin-based composite — 2 surfaces, anterior', category: 'restorative', subcategory: 'composite', typicalFee: 195 },
  { code: 'D2332', description: 'Resin-based composite — 3 surfaces, anterior', category: 'restorative', subcategory: 'composite', typicalFee: 235 },
  { code: 'D2391', description: 'Resin-based composite — 1 surface, posterior', category: 'restorative', subcategory: 'composite', typicalFee: 175 },
  { code: 'D2392', description: 'Resin-based composite — 2 surfaces, posterior', category: 'restorative', subcategory: 'composite', typicalFee: 220 },
  { code: 'D2393', description: 'Resin-based composite — 3 surfaces, posterior', category: 'restorative', subcategory: 'composite', typicalFee: 265 },
  { code: 'D2740', description: 'Crown — porcelain/ceramic substrate', category: 'restorative', subcategory: 'crown', typicalFee: 1200 },
  { code: 'D2750', description: 'Crown — porcelain fused to high noble metal (PFM)', category: 'restorative', subcategory: 'crown', typicalFee: 1150 },
  { code: 'D2930', description: 'Prefabricated stainless steel crown — primary tooth', category: 'restorative', subcategory: 'crown', typicalFee: 275 },
  { code: 'D2950', description: 'Core buildup, including any pins when required', category: 'restorative', subcategory: 'crown', typicalFee: 275 },
  { code: 'D2980', description: 'Crown repair — by report', category: 'restorative', subcategory: 'crown', typicalFee: 175 },

  // ── Endodontics ────────────────────────────────────────────────────────────
  { code: 'D3310', description: 'Endodontic therapy — anterior tooth (RCT)', category: 'endodontics', subcategory: 'rct', typicalFee: 750 },
  { code: 'D3320', description: 'Endodontic therapy — premolar tooth (RCT)', category: 'endodontics', subcategory: 'rct', typicalFee: 850 },
  { code: 'D3330', description: 'Endodontic therapy — molar tooth (RCT)', category: 'endodontics', subcategory: 'rct', typicalFee: 1050 },
  { code: 'D3346', description: 'Retreatment of previous root canal — anterior', category: 'endodontics', subcategory: 'retreatment', typicalFee: 875 },
  { code: 'D3347', description: 'Retreatment of previous root canal — premolar', category: 'endodontics', subcategory: 'retreatment', typicalFee: 975 },
  { code: 'D3348', description: 'Retreatment of previous root canal — molar', category: 'endodontics', subcategory: 'retreatment', typicalFee: 1150 },
  { code: 'D3410', description: 'Apicoectomy — anterior', category: 'endodontics', subcategory: 'apicoectomy', typicalFee: 700 },

  // ── Periodontics ────────────────────────────────────────────────────────────
  { code: 'D4341', description: 'Periodontal scaling and root planing — 4 or more teeth per quadrant', category: 'periodontics', subcategory: 'srp', typicalFee: 280 },
  { code: 'D4342', description: 'Periodontal scaling and root planing — 1 to 3 teeth per quadrant', category: 'periodontics', subcategory: 'srp', typicalFee: 185 },
  { code: 'D4355', description: 'Full mouth debridement', category: 'periodontics', subcategory: 'debridement', typicalFee: 165 },
  { code: 'D4910', description: 'Periodontal maintenance', category: 'periodontics', subcategory: 'maintenance', typicalFee: 150 },
  { code: 'D4211', description: 'Gingivectomy — per tooth', category: 'periodontics', subcategory: 'surgical', typicalFee: 200 },
  { code: 'D4260', description: 'Osseous surgery — 4+ teeth per quadrant', category: 'periodontics', subcategory: 'surgical', typicalFee: 950 },

  // ── Prosthodontics — Removable ─────────────────────────────────────────────
  { code: 'D5110', description: 'Complete denture — maxillary (upper)', category: 'prosthodontics', subcategory: 'complete_denture', typicalFee: 1500 },
  { code: 'D5120', description: 'Complete denture — mandibular (lower)', category: 'prosthodontics', subcategory: 'complete_denture', typicalFee: 1500 },
  { code: 'D5130', description: 'Immediate denture — maxillary', category: 'prosthodontics', subcategory: 'immediate_denture', typicalFee: 1650 },
  { code: 'D5140', description: 'Immediate denture — mandibular', category: 'prosthodontics', subcategory: 'immediate_denture', typicalFee: 1650 },
  { code: 'D5213', description: 'Maxillary partial denture — cast metal framework', category: 'prosthodontics', subcategory: 'partial_denture', typicalFee: 1750 },
  { code: 'D5214', description: 'Mandibular partial denture — cast metal framework', category: 'prosthodontics', subcategory: 'partial_denture', typicalFee: 1750 },
  { code: 'D5410', description: 'Adjust complete denture — maxillary', category: 'prosthodontics', subcategory: 'adjustment', typicalFee: 85 },
  { code: 'D5421', description: 'Adjust partial denture — maxillary', category: 'prosthodontics', subcategory: 'adjustment', typicalFee: 85 },

  // ── Fixed Prosthodontics ───────────────────────────────────────────────────
  { code: 'D6010', description: 'Surgical placement of implant body', category: 'prosthodontics', subcategory: 'implant', typicalFee: 2200 },
  { code: 'D6012', description: 'Surgical placement of interim implant body', category: 'prosthodontics', subcategory: 'implant', typicalFee: 900 },
  { code: 'D6065', description: 'Implant supported porcelain/ceramic crown', category: 'prosthodontics', subcategory: 'implant_crown', typicalFee: 2000 },
  { code: 'D6240', description: 'Pontic — porcelain fused to high noble metal', category: 'prosthodontics', subcategory: 'bridge', typicalFee: 1200 },
  { code: 'D6750', description: 'Crown — porcelain fused to high noble metal (bridge abutment)', category: 'prosthodontics', subcategory: 'bridge', typicalFee: 1150 },

  // ── Oral Surgery ───────────────────────────────────────────────────────────
  { code: 'D7140', description: 'Extraction — erupted tooth or exposed root (simple)', category: 'oral_surgery', subcategory: 'extraction', typicalFee: 165 },
  { code: 'D7210', description: 'Extraction — erupted tooth requiring removal of bone or sectioning', category: 'oral_surgery', subcategory: 'extraction', typicalFee: 300 },
  { code: 'D7220', description: 'Removal of impacted tooth — soft tissue', category: 'oral_surgery', subcategory: 'impaction', typicalFee: 385 },
  { code: 'D7230', description: 'Removal of impacted tooth — partially bony', category: 'oral_surgery', subcategory: 'impaction', typicalFee: 475 },
  { code: 'D7240', description: 'Removal of impacted tooth — completely bony', category: 'oral_surgery', subcategory: 'impaction', typicalFee: 565 },
  { code: 'D7310', description: 'Alveoloplasty in conjunction with extractions — per quadrant', category: 'oral_surgery', subcategory: 'alveoloplasty', typicalFee: 285 },

  // ── Orthodontics ───────────────────────────────────────────────────────────
  { code: 'D8080', description: 'Comprehensive orthodontic treatment — adolescent dentition', category: 'orthodontics', subcategory: 'comprehensive', typicalFee: 5500 },
  { code: 'D8090', description: 'Comprehensive orthodontic treatment — adult dentition', category: 'orthodontics', subcategory: 'comprehensive', typicalFee: 6500 },
  { code: 'D8660', description: 'Pre-orthodontic treatment examination', category: 'orthodontics', subcategory: 'diagnostic', typicalFee: 150 },
  { code: 'D8670', description: 'Periodic orthodontic treatment visit', category: 'orthodontics', subcategory: 'visit', typicalFee: 125 },

  // ── Adjunctive ─────────────────────────────────────────────────────────────
  { code: 'D9110', description: 'Palliative (emergency) treatment of dental pain — minor procedure', category: 'adjunctive', subcategory: 'emergency', typicalFee: 90 },
  { code: 'D9210', description: 'Local anesthesia — not in conjunction with operative or surgical procedures', category: 'adjunctive', subcategory: 'anesthesia', typicalFee: 55 },
  { code: 'D9215', description: 'Local anesthesia — in conjunction with operative or surgical procedures', category: 'adjunctive', subcategory: 'anesthesia', typicalFee: 0 },
  { code: 'D9230', description: 'Inhalation of nitrous oxide/anxiolysis', category: 'adjunctive', subcategory: 'anesthesia', typicalFee: 110 },
  { code: 'D9910', description: 'Application of desensitizing medicament', category: 'adjunctive', subcategory: 'medicament', typicalFee: 55 },
  { code: 'D9950', description: 'Occlusal analysis — diagnostic mounting', category: 'adjunctive', subcategory: 'analysis', typicalFee: 185 },
  { code: 'D9951', description: 'Occlusal adjustment — limited', category: 'adjunctive', subcategory: 'adjustment', typicalFee: 115 },
];

async function seed() {
  console.log('🌱 Seeding CDT codes...');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  let created = 0;
  let skipped = 0;

  for (const cdt of CDT_CODES) {
    try {
      await db.cdtCode.upsert({
        where: { code: cdt.code },
        update: {
          description: cdt.description,
          category: cdt.category,
          subcategory: cdt.subcategory ?? null,
          typicalFee: cdt.typicalFee,
        },
        create: cdt,
      });
      created++;
    } catch (err) {
      console.error(`  ❌ Failed to seed ${cdt.code}:`, err);
      skipped++;
    }
  }

  console.log(`✅ CDT seed complete: ${created} upserted, ${skipped} failed`);
  console.log(`   Total codes: ${CDT_CODES.length}`);
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
