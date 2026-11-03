import { createHash } from "node:crypto";
import { toCsv } from "./csv.js";
import {
  ANCHOR_DATE,
  CLAIM_NUMBER_PREFIX,
  GROUP_NUMBER_PREFIX,
  MEMBER_ID_PREFIX,
  generateRecords,
} from "./generate.js";
import type { SyntheticRecord } from "./generate.js";

export const FIXTURE_PROFILE_IDS = [
  "synthetic_claim_standard",
  "synthetic_claim_auth_adversity",
  "synthetic_claim_denial",
  "synthetic_claim_documentation",
  "synthetic_claim_payment",
  "synthetic_claim_ivr",
  "synthetic_claim_handoff",
  "synthetic_claim_dispatch",
  "synthetic_claim_post_call",
  "synthetic_practice_operations",
] as const;

export type FixtureProfileId = (typeof FIXTURE_PROFILE_IDS)[number];

export const PRACTICE_ROLE_IDS = [
  "practice_owner",
  "office_manager",
  "billing_coordinator",
  "front_desk",
  "associate_dentist",
  "accountant",
  "group_admin",
] as const;

export const PLATFORM_IDENTITY_IDS = [
  "auditor",
  "billing_ops_manager",
  "platform_admin",
  "platform_dev",
] as const;

export type SyntheticIdentity = {
  id: string;
  email: string;
  role: (typeof PRACTICE_ROLE_IDS)[number] | (typeof PLATFORM_IDENTITY_IDS)[number];
  authSource: "practice_user" | "platform_user" | "internal_platform";
  phiAccess: boolean;
  permissions: string[];
};

export type SyntheticInsurer = {
  id: string;
  name: string;
  simulatorPhone: string;
  endpointMode: "simulator_only";
};

export type SyntheticAttachmentMetadata = {
  id: string;
  claimNumber: string;
  fileName: string;
  contentType: "application/pdf";
  byteCount: number;
  sha256: string;
  syntheticOnly: true;
};

export type SyntheticPracticeBundle = {
  schemaVersion: 1;
  seed: string;
  profile: FixtureProfileId;
  practice: {
    id: string;
    name: string;
    timezone: "America/Toronto";
    billingPhone: string;
    faxNumber: string;
    practiceAddress: string;
    registrationNumber: string;
    syntheticOnly: true;
  };
  identities: SyntheticIdentity[];
  insurers: SyntheticInsurer[];
  cleanRecords: SyntheticRecord[];
  messyRecords: SyntheticRecord[];
  profileRecords: SyntheticRecord[];
  attachments: SyntheticAttachmentMetadata[];
  scenarioData: Record<string, string | number | boolean>;
  csv: {
    clean: string;
    messy: string;
    profile: string;
  };
};

const DAY_MS = 86_400_000;

const ROLE_PERMISSIONS: Record<SyntheticIdentity["role"], string[]> = {
  practice_owner: ["review_claims", "manage_users", "review_billing"],
  office_manager: ["import_claims", "initiate_call", "resolve_escalations"],
  billing_coordinator: ["import_claims", "review_claims", "initiate_call"],
  front_desk: ["view_console", "take_over_call", "resolve_escalations"],
  associate_dentist: ["review_provider_claims", "review_document_requests"],
  accountant: ["review_aging", "review_financial_analytics"],
  group_admin: ["review_group_dashboard", "review_group_billing"],
  auditor: ["review_granted_reports", "export_compliance_evidence"],
  billing_ops_manager: ["review_portfolio", "review_queue"],
  platform_admin: ["manage_platform", "authorized_break_glass"],
  platform_dev: ["review_system_health", "review_redacted_logs"],
};

const PHI_ACCESS: Record<SyntheticIdentity["role"], boolean> = {
  practice_owner: true,
  office_manager: true,
  billing_coordinator: true,
  front_desk: true,
  associate_dentist: true,
  accountant: false,
  group_admin: false,
  auditor: true,
  billing_ops_manager: false,
  platform_admin: false,
  platform_dev: false,
};

const INSURERS: SyntheticInsurer[] = [
  { id: "sun_life", name: "Sun Life", simulatorPhone: "+16135550101", endpointMode: "simulator_only" },
  { id: "canada_life", name: "Canada Life", simulatorPhone: "+16135550102", endpointMode: "simulator_only" },
  { id: "manulife", name: "Manulife", simulatorPhone: "+16135550103", endpointMode: "simulator_only" },
  { id: "green_shield", name: "Green Shield", simulatorPhone: "+16135550104", endpointMode: "simulator_only" },
  { id: "rbc", name: "RBC", simulatorPhone: "+16135550105", endpointMode: "simulator_only" },
  { id: "telus_adjudicare", name: "TELUS AdjudiCare", simulatorPhone: "+16135550106", endpointMode: "simulator_only" },
];

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cloneRecord(record: SyntheticRecord): SyntheticRecord {
  return { claim: { ...record.claim }, context: { ...record.context } };
}

function namespaceRecords(records: SyntheticRecord[], namespace: string): SyntheticRecord[] {
  return records.map((record) => {
    const copy = cloneRecord(record);
    const claimSuffix = copy.claim.claim_number.slice(CLAIM_NUMBER_PREFIX.length);
    const memberSuffix = copy.claim.subscriber_id.slice(MEMBER_ID_PREFIX.length);
    const groupSuffix = copy.claim.group_policy_number.slice(GROUP_NUMBER_PREFIX.length);
    copy.claim.claim_number = `${CLAIM_NUMBER_PREFIX}${namespace}-${claimSuffix}`;
    copy.claim.subscriber_id = `${MEMBER_ID_PREFIX}${namespace}-${memberSuffix}`;
    copy.claim.group_policy_number = `${GROUP_NUMBER_PREFIX}${namespace}-${groupSuffix}`;
    copy.context.claimNumber = copy.claim.claim_number;
    copy.context.memberId = copy.claim.subscriber_id;
    return copy;
  });
}

function recordsFor(seed: string, label: string, count: number): SyntheticRecord[] {
  const namespace = hash(`${seed}:${label}`).slice(0, 5).toUpperCase();
  return namespaceRecords(generateRecords(count, `${seed}:${label}`), namespace);
}

function treatmentDate(daysOutstanding: number): string {
  return new Date(Date.parse(ANCHOR_DATE) - daysOutstanding * DAY_MS).toISOString().slice(0, 10);
}

function makeMessy(records: SyntheticRecord[]): SyntheticRecord[] {
  const messy = records.map(cloneRecord);
  const first = messy[0];
  const second = messy[1];
  const third = messy[2];
  const fourth = messy[3];
  if (first) first.claim.treatment_codes = "";
  if (second) second.claim.submitted_date = "";
  if (third) third.claim.expected_amount = "";
  if (fourth) fourth.claim.treatment_date = "";
  return messy;
}

function applyProfile(profile: FixtureProfileId, records: SyntheticRecord[]): {
  records: SyntheticRecord[];
  scenarioData: Record<string, string | number | boolean>;
} {
  const profiled = records.map(cloneRecord);
  const scenarioData: Record<string, string | number | boolean> = {
    profile,
    syntheticOnly: true,
  };

  if (profile === "synthetic_claim_auth_adversity") {
    for (const [index, record] of profiled.entries()) {
      record.claim.subscriber_id = `${MEMBER_ID_PREFIX}AUTH-${String(index + 1).padStart(4, "0")}`;
      record.claim.group_policy_number = `${GROUP_NUMBER_PREFIX}AUTH-${String(index + 1).padStart(4, "0")}`;
      record.context.memberId = record.claim.subscriber_id;
    }
    scenarioData.authenticationOrder = "dob_before_practice_id";
  }

  if (profile === "synthetic_claim_denial") {
    scenarioData.denialReasonCode = "SYN-DOC12";
    scenarioData.denialDisposition = "human_review";
  }

  if (profile === "synthetic_claim_documentation") {
    const first = profiled[0];
    const second = profiled[1];
    if (first) first.claim.treatment_codes = "";
    if (second) second.claim.submitted_date = "";
    scenarioData.requiredDocument = "synthetic_xray";
  }

  if (profile === "synthetic_claim_payment") {
    for (const record of profiled) {
      const billed = Number(record.claim.amount_billed);
      record.claim.amount_outstanding = (billed * 0.2).toFixed(2);
      record.claim.expected_amount = (billed * 0.8).toFixed(2);
    }
    scenarioData.paymentState = "partial_payment";
  }

  if (profile === "synthetic_claim_ivr") {
    scenarioData.ivrPath = "claims_to_live_representative";
    scenarioData.maxMenuLoops = 3;
  }

  if (profile === "synthetic_claim_handoff") {
    scenarioData.handoffTarget = "front_desk";
    scenarioData.warmTransferRequired = true;
  }

  if (profile === "synthetic_claim_dispatch") {
    const ages = [29, 30, 90, 91];
    for (const [index, record] of profiled.entries()) {
      const days = ages[index % ages.length] ?? 30;
      record.claim.days_outstanding = String(days);
      record.claim.treatment_date = treatmentDate(days);
      record.claim.submitted_date = treatmentDate(Math.max(0, days - 2));
    }
    scenarioData.dispatchBoundaryAges = "29,30,90,91";
  }

  if (profile === "synthetic_claim_post_call") {
    scenarioData.transcriptTemplate = "Synthetic carrier confirms claim pending and provides reference SYN-REF-1001.";
    scenarioData.expectedDisposition = "PENDING_REVIEW";
  }

  if (profile === "synthetic_practice_operations") {
    scenarioData.voiceAgentEnabled = false;
    scenarioData.externalCallsAllowed = false;
  }

  return { records: profiled, scenarioData };
}

function identities(seedTag: string): SyntheticIdentity[] {
  const practice = PRACTICE_ROLE_IDS.map((role) => ({
    id: `syn-user-${seedTag}-${role}`,
    email: `${role.replaceAll("_", ".")}.${seedTag}@synthetic.collectrx.invalid`,
    role,
    authSource: "practice_user" as const,
    phiAccess: PHI_ACCESS[role],
    permissions: [...ROLE_PERMISSIONS[role]],
  }));
  const platform = PLATFORM_IDENTITY_IDS.map((role) => ({
    id: `syn-user-${seedTag}-${role}`,
    email: `${role.replaceAll("_", ".")}.${seedTag}@synthetic.collectrx.invalid`,
    role,
    authSource: role === "platform_dev" ? "internal_platform" as const : "platform_user" as const,
    phiAccess: PHI_ACCESS[role],
    permissions: [...ROLE_PERMISSIONS[role]],
  }));
  return [...practice, ...platform];
}

function attachments(seed: string, records: SyntheticRecord[]): SyntheticAttachmentMetadata[] {
  return records.slice(0, 2).map((record, index) => {
    const contentHash = hash(`${seed}:attachment:${record.claim.claim_number}:${index}`);
    return {
      id: `syn-attachment-${contentHash.slice(0, 12)}`,
      claimNumber: record.claim.claim_number,
      fileName: `SYNTHETIC_ONLY_${record.claim.claim_number}_xray_${index + 1}.pdf`,
      contentType: "application/pdf",
      byteCount: 1024 + index * 256,
      sha256: contentHash,
      syntheticOnly: true,
    };
  });
}

export function generatePracticeBundle(
  profile: FixtureProfileId,
  seed: string,
  count = 8,
): SyntheticPracticeBundle {
  if (!FIXTURE_PROFILE_IDS.includes(profile)) throw new Error(`unsupported fixture profile: ${profile}`);
  if (!/^[A-Za-z0-9._:-]{1,64}$/u.test(seed)) throw new Error("synthetic factory seed is invalid");
  if (!Number.isInteger(count) || count < 4 || count > 1000) {
    throw new Error("synthetic factory count must be an integer from 4 to 1000");
  }

  const seedTag = hash(`${seed}:${profile}`).slice(0, 10);
  const cleanRecords = recordsFor(seed, `${profile}:clean`, count);
  const messyRecords = makeMessy(recordsFor(seed, `${profile}:messy`, count));
  const profileResult = applyProfile(profile, recordsFor(seed, `${profile}:profile`, count));

  return {
    schemaVersion: 1,
    seed,
    profile,
    practice: {
      id: `syn-practice-${seedTag}`,
      name: `SYNTHETIC ONLY Dental Validation ${seedTag}`,
      timezone: "America/Toronto",
      billingPhone: "+16135550100",
      faxNumber: "+16135550199",
      practiceAddress: `100 Synthetic Test Avenue, Ottawa, ON K1A 0A0 (${seedTag})`,
      registrationNumber: `SYN-REG-${seedTag.toUpperCase()}`,
      syntheticOnly: true,
    },
    identities: identities(seedTag),
    insurers: INSURERS.map((insurer) => ({ ...insurer })),
    cleanRecords,
    messyRecords,
    profileRecords: profileResult.records,
    attachments: attachments(seed, profileResult.records),
    scenarioData: profileResult.scenarioData,
    csv: {
      clean: toCsv(cleanRecords.map((record) => record.claim)),
      messy: toCsv(messyRecords.map((record) => record.claim)),
      profile: toCsv(profileResult.records.map((record) => record.claim)),
    },
  };
}

export function assertSyntheticBundle(bundle: SyntheticPracticeBundle): void {
  if (!bundle.practice.syntheticOnly || !bundle.practice.name.startsWith("SYNTHETIC ONLY")) {
    throw new Error("synthetic factory practice marker is missing");
  }
  if (bundle.identities.length !== 11) throw new Error("synthetic factory requires all 11 identities");
  if (bundle.insurers.length !== 6 || bundle.insurers.some((insurer) => insurer.endpointMode !== "simulator_only")) {
    throw new Error("synthetic factory insurers must be simulator-only");
  }

  const records = [...bundle.cleanRecords, ...bundle.messyRecords, ...bundle.profileRecords];
  const claimNumbers = records.map((record) => record.claim.claim_number);
  const memberIds = records.map((record) => record.claim.subscriber_id);
  if (new Set(claimNumbers).size !== claimNumbers.length) throw new Error("synthetic factory produced duplicate claim numbers");
  if (new Set(memberIds).size !== memberIds.length) throw new Error("synthetic factory produced duplicate member IDs");
  for (const record of records) {
    if (!record.claim.claim_number.startsWith(CLAIM_NUMBER_PREFIX)) throw new Error("claim number is not marked synthetic");
    if (!record.claim.subscriber_id.startsWith(MEMBER_ID_PREFIX)) throw new Error("member ID is not marked synthetic");
    if (!record.claim.group_policy_number.startsWith(GROUP_NUMBER_PREFIX)) throw new Error("group number is not marked synthetic");
  }
}
