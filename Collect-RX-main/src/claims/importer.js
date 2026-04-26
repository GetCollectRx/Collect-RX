/**
 * CollectRx — AbelDent Claims Importer
 *
 * Parses the CSV export that AbelDent produces from its insurance AR aging report
 * and upserts the records into the `claims` table.
 *
 * AbelDent aging export column mapping (adjust column names to match your actual export):
 *
 *   Claim ID / Ref        → id
 *   Patient First Name    → patient_first_name
 *   Patient Last Name     → patient_last_name
 *   Insurance Company     → carrier_name  (we derive carrier_code from this)
 *   Policy Number         → policy_number
 *   Procedure Code        → procedure_code
 *   Procedure Description → procedure_description
 *   Date of Service       → treatment_date
 *   Date Submitted        → submission_date
 *   Amount Billed         → amount_billed
 *   Amount Outstanding    → amount_outstanding
 *   Days Outstanding      → days_outstanding  (or computed from submission_date)
 *
 * Usage:
 *   POST /api/claims/import
 *   Body: multipart/form-data with field "csv" OR application/json array of claim objects
 */

const { query } = require('../db');
const logger = require('../logger');

// ─── Carrier name → carrier_code mapping ──────────────────────────────────────
// Extend this as you add new carriers to your KB.
const CARRIER_CODE_MAP = {
  'sun life':             'sunlife_private',
  'sun life financial':   'sunlife_private',
  'sunlife':              'sunlife_private',
  'canada life':          'canada_life',
  'great-west life':      'canada_life',
  'great west life':      'canada_life',
  'green shield':         'green_shield',
  'green shield canada':  'green_shield',
  'manulife':             'manulife',
  'manufacturers life':   'manulife',
  'rbc':                  'rbc_insurance',
  'rbc insurance':        'rbc_insurance',
  'royal bank':           'rbc_insurance',
  'cdcp':                 'cdcp_sunlife',
  'canadian dental care': 'cdcp_sunlife',
  'desjardins':           'desjardins',
  'blue cross':           'blue_cross',
  'alberta blue cross':   'blue_cross',
};

function normalizeCarrierCode(carrierName) {
  if (!carrierName) return 'unknown';
  const key = carrierName.toLowerCase().trim();
  for (const [pattern, code] of Object.entries(CARRIER_CODE_MAP)) {
    if (key.includes(pattern)) return code;
  }
  // Fallback: slugify the name
  return key.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ─── Aging bucket calculator ───────────────────────────────────────────────────

function getAgingBucket(daysOutstanding) {
  const d = parseInt(daysOutstanding) || 0;
  if (d >= 120) return '120+';
  if (d >= 90)  return '90-119';
  if (d >= 60)  return '60-89';
  if (d >= 30)  return '30-59';
  return '0-29';
}

// ─── Normalize a raw CSV row → DB-ready object ────────────────────────────────
// Handles flexible column naming (AbelDent exports vary slightly by version).

function normalizeRow(raw, practiceId) {
  // Try multiple possible column name variants
  const get = (...keys) => {
    for (const k of keys) {
      const val = raw[k] ?? raw[k?.toLowerCase()] ?? raw[k?.toUpperCase()];
      if (val !== undefined && val !== null && val !== '') return val;
    }
    return null;
  };

  const claimId = get('Claim ID', 'ClaimID', 'Ref', 'Reference', 'claim_id', 'id');
  if (!claimId) throw new Error(`Row missing Claim ID: ${JSON.stringify(raw)}`);

  const daysOutstanding = parseInt(get('Days Outstanding', 'Days', 'days_outstanding') || 0);
  const submissionDateRaw = get('Date Submitted', 'Submitted Date', 'submission_date', 'Claim Date');
  const treatmentDateRaw  = get('Date of Service', 'Service Date', 'treatment_date', 'Treatment Date');
  const carrierName = get('Insurance Company', 'Carrier', 'Insurance', 'carrier_name') || '';

  return {
    id:                   String(claimId).trim(),
    practice_id:          practiceId || null,
    patient_first_name:   get('Patient First Name', 'First Name', 'patient_first_name') || '',
    patient_last_name:    get('Patient Last Name', 'Last Name', 'patient_last_name') || '',
    carrier_name:         carrierName,
    carrier_code:         normalizeCarrierCode(carrierName),
    policy_number:        get('Policy Number', 'Policy', 'policy_number') || '',
    group_number:         get('Group Number', 'Group', 'group_number') || null,
    subscriber_name:      get('Subscriber', 'Subscriber Name', 'subscriber_name') || null,
    procedure_code:       get('Procedure Code', 'Code', 'Proc Code', 'procedure_code') || '',
    procedure_description:get('Procedure Description', 'Description', 'procedure_description') || null,
    treatment_date:       treatmentDateRaw ? new Date(treatmentDateRaw).toISOString().split('T')[0] : null,
    submission_date:      submissionDateRaw ? new Date(submissionDateRaw).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    amount_billed:        parseFloat(String(get('Amount Billed', 'Billed', 'amount_billed') || '0').replace(/[$,]/g, '')) || 0,
    amount_outstanding:   parseFloat(String(get('Amount Outstanding', 'Outstanding', 'Balance', 'amount_outstanding') || '0').replace(/[$,]/g, '')) || 0,
    days_outstanding:     daysOutstanding,
    aging_bucket:         getAgingBucket(daysOutstanding),
    claim_number:         get('Claim Number', 'claim_number') || null,
    status:               'Pending',
    queue_status:         'queued',
  };
}

// ─── Upsert a single claim ────────────────────────────────────────────────────
// INSERT on new claims. UPDATE amount_outstanding + days_outstanding on existing ones.
// Does NOT reset queue_status if the claim is already in_progress or resolved.

async function upsertClaim(claim) {
  await query(
    `INSERT INTO claims (
       id, practice_id, patient_first_name, patient_last_name,
       carrier_code, carrier_name, policy_number,
       procedure_code, procedure_description, submission_date,
       amount_billed, amount_outstanding, days_outstanding, aging_bucket,
       status, queue_status, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       amount_outstanding  = EXCLUDED.amount_outstanding,
       days_outstanding    = EXCLUDED.days_outstanding,
       aging_bucket        = EXCLUDED.aging_bucket,
       carrier_name        = EXCLUDED.carrier_name,
       carrier_code        = EXCLUDED.carrier_code,
       updated_at          = NOW()
     WHERE claims.queue_status NOT IN ('resolved', 'in_progress')`,
    [
      claim.id,
      claim.practice_id,
      claim.patient_first_name,
      claim.patient_last_name,
      claim.carrier_code,
      claim.carrier_name,
      claim.policy_number,
      claim.procedure_code,
      claim.procedure_description,
      claim.submission_date,
      claim.amount_billed,
      claim.amount_outstanding,
      claim.days_outstanding,
      claim.aging_bucket,
      claim.status,
      claim.queue_status,
    ]
  );
}

// ─── Import from JSON array ───────────────────────────────────────────────────
// Accepts the already-parsed rows (parsed CSV or JSON POST body).

async function importClaims(rows, practiceId) {
  const results = { imported: 0, skipped: 0, errors: [] };

  for (const raw of rows) {
    try {
      // Skip zero-balance rows (AbelDent sometimes includes $0 lines)
      const outstanding = parseFloat(String(raw['Amount Outstanding'] || raw.amount_outstanding || '0').replace(/[$,]/g, ''));
      if (outstanding <= 0) {
        results.skipped++;
        continue;
      }

      const claim = normalizeRow(raw, practiceId);
      await upsertClaim(claim);
      results.imported++;
    } catch (err) {
      logger.warn(`Import error on row`, { error: err.message, row: raw });
      results.errors.push({ row: raw, error: err.message });
    }
  }

  logger.info(`Claims import complete`, results);
  return results;
}

// ─── Parse CSV text → array of row objects ────────────────────────────────────
// Simple CSV parser — handles quoted fields and comma-in-value.
// For production, swap in the `csv-parse` npm package if needed.

function parseCSV(csvText) {
  const lines = csvText.trim().split('\n').filter(Boolean);
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  // Parse headers
  const headers = splitCSVLine(lines[0]);

  // Parse data rows
  return lines.slice(1).map(line => {
    const values = splitCSVLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h.trim()] = (values[i] || '').trim();
    });
    return row;
  });
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

module.exports = {
  importClaims,
  parseCSV,
  normalizeCarrierCode,
  getAgingBucket,
};
