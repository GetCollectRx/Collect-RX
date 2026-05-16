/**
 * Phase 5: CDAnet Transaction 09 — Electronic Evidence Submission
 *
 * Bundles clinical attachments (X-rays, PSR scores, clinical notes) into
 * a single encrypted payload for submission to Sun Life via CDAnet
 * Attachment Transaction (Type 09).
 *
 * Max payload: 7MB (Sun Life CDAnet limit)
 * Protocol: CDAnet Version 4 / ITRANS 2.0 (effective June 30, 2026)
 *
 * Paper Fallback: For practices using PMS versions that do not support
 * CDAnet Transaction 09, generates a pre-populated reconsideration package
 * addressed to the Sun Life Montreal PO Box.
 */

import crypto from 'crypto';
import type {
  CdanetAttachment,
  AttachmentFile,
  PaperReconsiderationPackage,
  EvidenceChecklistItem,
} from './types.js';
import { CDCP_SUN_LIFE_PO_BOX } from './reconsiderationEngine.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_PAYLOAD_BYTES = 7 * 1024 * 1024;  // 7 MB
const CDANET_VERSION = '04';                  // CDAnet v4
const ITRANS_VERSION = '2.0';

// ─── Attachment Validation ────────────────────────────────────────────────────

export interface AttachmentValidationResult {
  valid: boolean;
  totalSizeBytes: number;
  exceedsLimit: boolean;
  errors: string[];
  warnings: string[];
}

export function validateAttachments(
  files: AttachmentFile[]
): AttachmentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const totalSizeBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  const exceedsLimit = totalSizeBytes > MAX_PAYLOAD_BYTES;

  if (exceedsLimit) {
    errors.push(
      `Total attachment size ${(totalSizeBytes / 1024 / 1024).toFixed(2)}MB exceeds the 7MB CDAnet limit. Remove lower-priority attachments or compress images.`
    );
  }

  for (const file of files) {
    if (!['image/jpeg', 'image/png', 'image/tiff', 'application/pdf', 'text/plain'].includes(file.mimeType)) {
      errors.push(`File "${file.filename}" has unsupported MIME type "${file.mimeType}". Accepted: JPEG, PNG, TIFF, PDF, TXT.`);
    }

    if (file.sizeBytes === 0) {
      errors.push(`File "${file.filename}" is empty.`);
    }

    if (file.sizeBytes > 3 * 1024 * 1024) {
      warnings.push(`File "${file.filename}" is ${(file.sizeBytes / 1024 / 1024).toFixed(1)}MB. Consider compressing to leave room for other attachments.`);
    }
  }

  if (files.length === 0) {
    errors.push('No attachments provided. At least one clinical document is required.');
  }

  return { valid: errors.length === 0, totalSizeBytes, exceedsLimit, errors, warnings };
}

// ─── Encrypt Payload ─────────────────────────────────────────────────────────

export interface EncryptedPayload {
  encryptedData: string;       // base64-encoded AES-256-GCM ciphertext
  iv: string;                  // base64 IV
  authTag: string;             // base64 GCM auth tag
  keyId: string;               // reference to the key used
  algorithm: string;
}

export function encryptAttachmentPayload(
  payloadJson: string,
  encryptionKey: Buffer,
  keyId: string
): EncryptedPayload {
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);

  const encrypted = Buffer.concat([
    cipher.update(payloadJson, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyId,
    algorithm: 'AES-256-GCM',
  };
}

// ─── Build Transaction 09 Payload ─────────────────────────────────────────────

export interface Transaction09Payload {
  header: {
    transactionType: '09';
    cdanetVersion: string;
    itransVersion: string;
    submittedAt: string;
    claimId: string;
    practiceId: string;
  };
  attachments: AttachmentFile[];
  totalSizeBytes: number;
  checksum: string;
}

export function buildTransaction09(
  claimId: string,
  practiceId: string,
  files: AttachmentFile[],
  submittedAt: Date = new Date()
): Transaction09Payload {
  const totalSizeBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

  // SHA-256 checksum of attachment filenames + sizes for integrity verification
  const checksumInput = files.map(f => `${f.filename}:${f.sizeBytes}`).join('|');
  const checksum = crypto.createHash('sha256').update(checksumInput).digest('hex');

  return {
    header: {
      transactionType: '09',
      cdanetVersion: CDANET_VERSION,
      itransVersion: ITRANS_VERSION,
      submittedAt: submittedAt.toISOString(),
      claimId,
      practiceId,
    },
    attachments: files,
    totalSizeBytes,
    checksum,
  };
}

export function buildCdanetAttachment(
  claimId: string,
  practiceId: string,
  files: AttachmentFile[],
  keyId: string = 'default'
): CdanetAttachment {
  return {
    transactionType: '09',
    claimId,
    practiceId,
    attachments: files,
    totalSizeBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
    encryptionKeyId: keyId,
    submittedAt: undefined,
    confirmationNumber: undefined,
  };
}

// ─── Paper Fallback Package ──────────────────────────────────────────────────

export interface PaperPackageInput {
  claimId: string;
  patientToken: string;
  practiceId: string;
  practiceName: string;
  practiceAddress: string;
  denialDate: Date;
  denialReasonCode: string;
  cdtCode: string;
  procedureDescription: string;
  evidenceItems: EvidenceChecklistItem[];
}

export function buildPaperReconsiderationPackage(
  input: PaperPackageInput
): PaperReconsiderationPackage {
  const deadlineDate = new Date(input.denialDate);
  deadlineDate.setDate(deadlineDate.getDate() + 60);

  const coverLetterText = [
    `${input.practiceName}`,
    `${input.practiceAddress}`,
    '',
    `Date: ${new Date().toLocaleDateString('en-CA')}`,
    '',
    'Sun Life Financial — CDCP Reconsideration Unit',
    CDCP_SUN_LIFE_PO_BOX,
    '',
    `Re: Level 1 Reconsideration Request`,
    `    Claim ID: ${input.claimId}`,
    `    Procedure: ${input.cdtCode} — ${input.procedureDescription}`,
    `    Original Denial Date: ${input.denialDate.toLocaleDateString('en-CA')}`,
    `    Reconsideration Deadline: ${deadlineDate.toLocaleDateString('en-CA')}`,
    `    Denial Reason Code: ${input.denialReasonCode}`,
    '',
    'Dear CDCP Reconsideration Adjudicator,',
    '',
    `This letter constitutes a formal Level 1 Reconsideration request pursuant to Appendix C of the CDCP Dental Benefits Guide. The above-referenced claim was denied on ${input.denialDate.toLocaleDateString('en-CA')}. We respectfully request a full review by a different adjudicator than the one who issued the original denial, as required by CDCP policy.`,
    '',
    'Enclosed clinical evidence is itemized below. We believe this documentation fully supports the medical necessity of the claimed procedure.',
    '',
    'Sincerely,',
    `${input.practiceName}`,
  ].join('\n');

  const presentItems = input.evidenceItems.filter(e => e.present);
  const checklistItems = presentItems.map(
    item => `☑ ${item.description}${item.notes ? ` — Note: ${item.notes}` : ''}`
  );

  if (checklistItems.length === 0) {
    checklistItems.push('⚠ WARNING: No clinical evidence items marked as present. Do not submit this package until evidence is gathered.');
  }

  return {
    claimId: input.claimId,
    patientToken: input.patientToken,
    practiceId: input.practiceId,
    mailingAddress: {
      recipient: 'Sun Life Financial — CDCP Reconsideration Unit',
      poBox: 'PO Box 2890, Station Main',
      city: 'Montreal',
      province: 'QC',
      postalCode: 'H3C 0B3',
    },
    coverLetterText,
    checklistItems,
    generatedAt: new Date(),
  };
}

// ─── Submission Strategy Selector ─────────────────────────────────────────────

export type PmsCapability = 'cdanet_v4' | 'cdanet_v3_legacy' | 'no_cdanet';

export interface SubmissionStrategy {
  method: 'cdanet_09' | 'paper_fallback';
  reason: string;
  itransWarning?: string;
}

/**
 * Selects the appropriate submission method based on the practice's PMS capability.
 * After June 30, 2026, legacy CDAnet v3 is retired — practices must upgrade.
 */
export function selectSubmissionStrategy(
  pmsCapability: PmsCapability,
  asOf: Date = new Date()
): SubmissionStrategy {
  const itransRetirementDate = new Date('2026-06-30');
  const postRetirement = asOf >= itransRetirementDate;

  switch (pmsCapability) {
    case 'cdanet_v4':
      return {
        method: 'cdanet_09',
        reason: 'Practice PMS supports CDAnet v4 / ITRANS 2.0. Electronic submission via Transaction 09.',
      };

    case 'cdanet_v3_legacy':
      if (postRetirement) {
        return {
          method: 'paper_fallback',
          reason: 'CDAnet v3 legacy protocol was retired June 30, 2026. Electronic submission unavailable until PMS is upgraded to CDAnet v4.',
          itransWarning: 'ACTION REQUIRED: Upgrade PMS to CDAnet v4 / ITRANS 2.0 immediately to restore electronic submission capability.',
        };
      }
      return {
        method: 'paper_fallback',
        reason: 'Practice is on CDAnet v3 legacy protocol. Paper fallback used.',
        itransWarning: `CDAnet v3 retires June 30, 2026 (${Math.ceil((itransRetirementDate.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24))} days remaining). Plan PMS upgrade.`,
      };

    case 'no_cdanet':
    default:
      return {
        method: 'paper_fallback',
        reason: 'Practice PMS does not support CDAnet. Paper reconsideration package will be generated.',
      };
  }
}
