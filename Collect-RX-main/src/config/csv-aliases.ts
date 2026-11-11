/**
 * Universal CSV header alias dictionary for multi-vertical A/R imports.
 *
 * Practices export an A/R aging or claims report from their own software and
 * upload it. Headers differ by vendor, so each canonical field lists the header
 * spellings seen (or expected) per vertical. Matching is done on a normalized
 * form (lowercase, accents stripped, non-alphanumerics removed), so
 * "Claim #", "claim_no" and "CLAIM NO." all compare equal, and French exports
 * ("Numéro de réclamation") are covered.
 *
 * CONFIDENCE: these lists are best-effort from vendor documentation and common
 * report layouts. They have NOT been verified against live exports from
 * Symbility, Jane App, Tracker/AbelMed, Mitchell, Audatex, CCC ONE, Xactimate,
 * AthenaHealth, WebPT or JobNimbus. Anything not matched is returned as
 * `unmappedHeaders` by the parser so the practice can map it by hand, and a
 * missing required field fails the whole file rather than guessing. Replace or
 * extend entries as real sample exports arrive.
 */

import type { IndustryType } from '../types/industry-claims';

export type CanonicalField =
  | 'claimNumber'
  | 'primaryReferenceId'
  | 'secondaryReferenceId'
  | 'payerName'
  | 'payerPhone'
  | 'insuredName'
  | 'dateOfService'
  | 'billedAmount'
  | 'balanceDue'
  | 'agingDays'
  | 'lineItemCode'
  | 'lineItemDescription';

export type AliasMap = Partial<Record<CanonicalField, readonly string[]>>;

/** Compare-form of a header: lowercase, accents stripped, letters and digits only. */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Fields every row must carry, per vertical. Missing column => file rejected. */
export const REQUIRED_FIELDS: Record<IndustryType, readonly CanonicalField[]> = {
  DENTAL: ['claimNumber', 'primaryReferenceId', 'payerName', 'insuredName', 'dateOfService', 'balanceDue'],
  AUTO_COLLISION: ['claimNumber', 'primaryReferenceId', 'payerName', 'insuredName', 'dateOfService', 'balanceDue'],
  PROPERTY_RESTORATION: ['claimNumber', 'primaryReferenceId', 'payerName', 'insuredName', 'dateOfService', 'balanceDue'],
  PARAMEDICAL_PHYSIO: ['claimNumber', 'primaryReferenceId', 'payerName', 'insuredName', 'dateOfService', 'balanceDue'],
  DME: ['claimNumber', 'primaryReferenceId', 'payerName', 'insuredName', 'dateOfService', 'balanceDue'],
  ROOFING_TRADES: ['claimNumber', 'primaryReferenceId', 'payerName', 'insuredName', 'dateOfService', 'balanceDue'],
  NEMT: ['claimNumber', 'primaryReferenceId', 'payerName', 'insuredName', 'dateOfService', 'balanceDue'],
};

/** Shared across verticals (English and French). Industry lists take precedence. */
export const COMMON_ALIASES: AliasMap = {
  claimNumber: [
    'Claim #', 'Claim No', 'Claim Number', 'Claim ID', 'Insurance Claim #', 'Payer Claim #',
    'No de réclamation', 'Numéro de réclamation', 'N° de réclamation', 'No réclamation',
  ],
  payerName: [
    'Insurance Company', 'Insurer', 'Carrier', 'Payer', 'Payer Name', 'Primary Insurance',
    'Insurance Name', 'Bill To', 'Assureur', 'Compagnie d\'assurance', 'Payeur',
  ],
  payerPhone: ['Payer Phone', 'Insurer Phone', 'Carrier Phone', 'Ins Phone', 'Claims Phone', 'Adjuster Phone', 'Téléphone assureur'],
  insuredName: [
    'Insured', 'Insured Name', 'Patient Name', 'Customer Name', 'Client Name', 'Policyholder', 'Policyholder Name',
    'Subscriber Name', 'Homeowner', 'Owner', 'Client', 'Patient', 'Assuré', 'Nom de l\'assuré', 'Nom du patient', 'Nom du client',
  ],
  dateOfService: ['Date of Service', 'Service Date', 'DOS', 'Date of Loss', 'Loss Date', 'Date de service', 'Date du sinistre', 'Date de perte'],
  billedAmount: [
    'Billed Amount', 'Total Billed', 'Total Charges', 'Charge Amount', 'Invoice Total', 'Invoice Amount', 'Total Invoice',
    'Montant facturé', 'Total facturé',
  ],
  balanceDue: [
    'Balance Due', 'Balance', 'Outstanding', 'Outstanding Balance', 'Amount Due', 'Insurance Balance', 'Ins Balance',
    'Open Balance', 'AR Balance', 'Unpaid Amount', 'Solde', 'Solde dû', 'Montant dû', 'Solde impayé',
  ],
  agingDays: ['Age', 'Aging', 'Aging Days', 'Days Outstanding', 'Days in AR', 'Days Old', 'Age Days', 'Jours en souffrance', 'Âge en jours'],
  lineItemCode: ['Procedure Code', 'Proc Code', 'Service Code', 'Line Code', 'Item Code', 'CDT', 'CPT', 'Code de procédure'],
  lineItemDescription: ['Procedure Description', 'Service Description', 'Line Description', 'Item Description', 'Description', 'Description du service'],
};

export const INDUSTRY_CSV_ALIASES: Record<IndustryType, AliasMap> = {
  // Software: Tracker, AbelMed / AbelDent (Canadian dental PMS). Existing dental
  // imports still run through parseSimpleCsv; these entries serve the new parser.
  DENTAL: {
    primaryReferenceId: ['Patient ID', 'Patient Chart #', 'Chart #', 'Chart Number', 'PatNum', 'Account #', 'Account Number', 'No de dossier'],
    secondaryReferenceId: ['Subscriber ID', 'Policy #', 'Group/Plan #', 'Certificate #'],
    dateOfService: ['Treatment Date', 'Date of Treatment'],
    balanceDue: ['Ins Portion Owing', 'Insurance Owing'],
  },

  // Software: Mitchell, Audatex (Canadian collision estimating), CCC ONE.
  AUTO_COLLISION: {
    primaryReferenceId: ['RO #', 'RO Number', 'Repair Order', 'Repair Order #', 'Work Order #', 'Estimate #', 'File #', 'Job #'],
    secondaryReferenceId: ['VIN', 'Vehicle ID', 'Vehicle VIN', 'NIV', 'Numéro d\'identification du véhicule'],
    payerName: ['Insurance Company', 'Insurer', 'Insurer Name', 'Carrier', 'Payer', 'Bill To'],
    dateOfService: ['Date of Loss', 'DOL', 'Repair Date', 'Drop Off Date', 'In Date', 'Completion Date', 'Date de réparation'],
    billedAmount: ['Total Gross Estimate', 'Gross Total', 'Estimate Total', 'Net Estimate', 'Total Estimate', 'Total RO'],
    balanceDue: ['Insurance Balance', 'Net Due', 'Balance Owing', 'Amount Owing'],
    agingDays: ['Days in Shop', 'AR Days', 'Aging'],
    lineItemCode: ['Part #', 'Labour Op', 'Operation Code'],
    lineItemDescription: ['Operation', 'Part Description', 'Labour Description'],
  },

  // Software: Symbility, Xactimate (Canadian P&C restoration), DASH, Restoration Manager.
  PROPERTY_RESTORATION: {
    primaryReferenceId: ['Job #', 'Job Number', 'Project #', 'Project Number', 'File #', 'Estimate ID', 'Symbility Claim ID', 'Xactimate ID', 'Work Order #'],
    secondaryReferenceId: ['Policy #', 'Policy Number', 'Policy No', 'Policy ID', 'Numéro de police'],
    payerName: ['Insurance Carrier', 'Insurer', 'Insurance Company', 'Carrier', 'Payer Name'],
    dateOfService: ['Date of Loss', 'Loss Date', 'Mitigation Date', 'Start Date', 'Completion Date', 'Date du sinistre'],
    billedAmount: ['Estimate Total', 'Scope Total', 'Scope Value', 'Invoice Total', 'RCV Total', 'Total RCV', 'Invoice Amount'],
    balanceDue: ['Outstanding Balance', 'Unpaid Amount', 'AR Balance', 'Amount Owing', 'Balance Owing'],
    agingDays: ['Age Days', 'Days Unpaid', 'Aging'],
    lineItemCode: ['Line Item Code', 'Cat/Sel', 'Category Code', 'Item Code'],
    lineItemDescription: ['Line Item', 'Line Item Description', 'Scope Item'],
  },

  // Software: Jane App (Canadian physio, chiro, massage, RMT), also WebPT, ChiroTouch.
  PARAMEDICAL_PHYSIO: {
    primaryReferenceId: ['Patient ID', 'Client ID', 'Patient #', 'Case #', 'Case Number', 'Chart #', 'File #'],
    secondaryReferenceId: ['Policy #', 'Policy Number', 'Member ID', 'Certificate #', 'Group #'],
    payerName: ['Insurer', 'Insurance Company', 'Insurance', 'Payer', 'Third Party', 'Third-Party Payer', 'Payer Name', 'WSIB', 'WCB'],
    claimNumber: ['Claim #', 'Claim Number', 'Invoice #', 'Invoice Number', 'Receipt #', 'WSIB Claim #', 'WCB Claim #'],
    dateOfService: ['Appointment Date', 'Visit Date', 'Treatment Date', 'Date of Visit', 'Start Date', 'DOS'],
    billedAmount: ['Invoice Total', 'Total Billed', 'Charge', 'Fee', 'Amount Billed'],
    balanceDue: ['Outstanding', 'Outstanding Balance', 'Insurer Balance', 'Third Party Balance', 'Claim Balance', 'Ins Due', 'Amount Outstanding'],
    lineItemCode: ['Treatment Code', 'Billing Code', 'Service Code', 'Item #'],
    lineItemDescription: ['Treatment', 'Treatment Description', 'Billable Item', 'Item'],
  },

  // Software: Brightree, TIMS, Universal Software.
  DME: {
    primaryReferenceId: ['Sales Order #', 'Sales Order', 'SO #', 'SO Number', 'Order #', 'Order ID', 'Order Number'],
    secondaryReferenceId: ['Policy #', 'Member ID', 'Certificate #'],
    payerName: ['Payer', 'Payer Name', 'Insurance Plan', 'Plan Name', 'Primary Payer', 'ADP', 'Funder'],
    claimNumber: ['Claim #', 'Billing Reference', 'Invoice #', 'Authorization #', 'Auth #'],
    dateOfService: ['Delivery Date', 'Date Delivered', 'Date Shipped', 'Dispense Date', 'DOS'],
    insuredName: ['Beneficiary', 'Client Name', 'Patient Name'],
    balanceDue: ['Open Balance', 'Balance Due', 'Payer Balance'],
    lineItemCode: ['HCPCS', 'Product Code', 'Item Code', 'SKU'],
    lineItemDescription: ['Product', 'Product Description', 'Item'],
  },

  // Software: JobNimbus, AccuLynx, Roofr, plus Xactimate/Symbility estimates.
  ROOFING_TRADES: {
    primaryReferenceId: ['Job #', 'Job Number', 'Job ID', 'Work Order #', 'Project #'],
    secondaryReferenceId: ['Policy #', 'Policy Number', 'Policy No'],
    payerName: ['Insurance Co', 'Insurance Company', 'Insurance Carrier', 'Insurer', 'Carrier'],
    claimNumber: ['Claim #', 'Claim Number', 'Adjuster Reference', 'Insurance Claim #'],
    dateOfService: ['Date of Loss', 'Completion Date', 'Build Date', 'Install Date', 'Job Completed'],
    billedAmount: ['Contract Amount', 'Contract Total', 'Job Total', 'Invoice Total', 'RCV'],
    balanceDue: ['Depreciation Due', 'Recoverable Depreciation', 'RCV Balance', 'Unpaid Balance', 'Balance Owing'],
    insuredName: ['Homeowner', 'Customer', 'Customer Name', 'Contact'],
  },

  // Software: AngelTrack, MPatrick, TripSpark, and funder portals.
  NEMT: {
    primaryReferenceId: ['Trip ID', 'Trip #', 'Run #', 'Run Number', 'Dispatch #', 'Booking #'],
    secondaryReferenceId: ['Authorization #', 'Prior Auth #', 'Member ID', 'Client ID'],
    payerName: ['Payer', 'Payer Name', 'Funder', 'Funding Source', 'Contract', 'Ministry'],
    claimNumber: ['Claim #', 'Invoice #', 'Invoice Number', 'Billing Reference'],
    dateOfService: ['Transport Date', 'Trip Date', 'Run Date', 'Pickup Date', 'Service Date'],
    insuredName: ['Passenger Name', 'Passenger', 'Rider', 'Client Name', 'Patient Name'],
    billedAmount: ['Total Trip Charge', 'Trip Charge', 'Fare', 'Invoice Total'],
    balanceDue: ['Trip Balance', 'Uncollected', 'Outstanding', 'Balance Due'],
  },
};

/** Software the practice can pick in the upload UI; informational. */
export const SOFTWARE_PROFILES: ReadonlyArray<{
  id: string;
  label: string;
  industry: IndustryType;
  market: 'CA' | 'US' | 'BOTH';
}> = [
  { id: 'tracker', label: 'Tracker', industry: 'DENTAL', market: 'CA' },
  { id: 'abelmed', label: 'AbelMed / AbelDent', industry: 'DENTAL', market: 'CA' },
  { id: 'mitchell', label: 'Mitchell', industry: 'AUTO_COLLISION', market: 'BOTH' },
  { id: 'audatex', label: 'Audatex', industry: 'AUTO_COLLISION', market: 'BOTH' },
  { id: 'ccc-one', label: 'CCC ONE', industry: 'AUTO_COLLISION', market: 'BOTH' },
  { id: 'symbility', label: 'Symbility', industry: 'PROPERTY_RESTORATION', market: 'CA' },
  { id: 'xactimate', label: 'Xactimate', industry: 'PROPERTY_RESTORATION', market: 'BOTH' },
  { id: 'jane', label: 'Jane App', industry: 'PARAMEDICAL_PHYSIO', market: 'CA' },
  { id: 'webpt', label: 'WebPT', industry: 'PARAMEDICAL_PHYSIO', market: 'US' },
  { id: 'brightree', label: 'Brightree', industry: 'DME', market: 'BOTH' },
  { id: 'jobnimbus', label: 'JobNimbus', industry: 'ROOFING_TRADES', market: 'BOTH' },
  { id: 'acculynx', label: 'AccuLynx', industry: 'ROOFING_TRADES', market: 'BOTH' },
  { id: 'angeltrack', label: 'AngelTrack', industry: 'NEMT', market: 'BOTH' },
];

/** Normalized alias -> canonical field for one vertical. Industry entries win over common. */
export function buildAliasLookup(industry: IndustryType): Map<string, CanonicalField> {
  const lookup = new Map<string, CanonicalField>();
  const add = (map: AliasMap, overwrite: boolean) => {
    for (const [field, aliases] of Object.entries(map) as Array<[CanonicalField, readonly string[]]>) {
      for (const alias of aliases) {
        const key = normalizeHeader(alias);
        if (key && (overwrite || !lookup.has(key))) lookup.set(key, field);
      }
    }
  };
  add(COMMON_ALIASES, false);
  add(INDUSTRY_CSV_ALIASES[industry], true);
  return lookup;
}
