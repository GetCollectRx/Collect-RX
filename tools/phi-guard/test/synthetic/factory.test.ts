import { describe, expect, it } from "vitest";
import {
  FIXTURE_PROFILE_IDS,
  PLATFORM_IDENTITY_IDS,
  PRACTICE_ROLE_IDS,
  assertSyntheticBundle,
  generatePracticeBundle,
} from "../../src/synthetic/factory.js";

describe("synthetic practice and claim factory", () => {
  it("generates byte-stable bundles for all ten registered profiles", () => {
    expect(FIXTURE_PROFILE_IDS).toHaveLength(10);
    for (const profile of FIXTURE_PROFILE_IDS) {
      const first = generatePracticeBundle(profile, "stage6", 8);
      const second = generatePracticeBundle(profile, "stage6", 8);
      expect(first).toEqual(second);
      expect(() => assertSyntheticBundle(first)).not.toThrow();
    }
  });

  it("contains seven practice roles, four platform/internal identities, and no duplicate identities", () => {
    const bundle = generatePracticeBundle("synthetic_claim_standard", "identity", 8);
    expect(PRACTICE_ROLE_IDS).toHaveLength(7);
    expect(PLATFORM_IDENTITY_IDS).toHaveLength(4);
    expect(bundle.identities).toHaveLength(11);
    expect(new Set(bundle.identities.map((identity) => identity.id)).size).toBe(11);
    expect(new Set(bundle.identities.map((identity) => identity.email)).size).toBe(11);
    expect(bundle.identities.map((identity) => identity.role).sort()).toEqual(
      [...PRACTICE_ROLE_IDS, ...PLATFORM_IDENTITY_IDS].sort(),
    );
  });

  it("marks the practice, attachments, identifiers, and insurer endpoints as synthetic-only", () => {
    const bundle = generatePracticeBundle("synthetic_claim_documentation", "markers", 8);
    expect(bundle.practice.name).toMatch(/^SYNTHETIC ONLY/u);
    expect(bundle.practice.syntheticOnly).toBe(true);
    expect(bundle.practice.registrationNumber).toMatch(/^SYN-REG-/u);
    expect(bundle.attachments).toHaveLength(2);
    expect(bundle.attachments.every((attachment) => attachment.syntheticOnly)).toBe(true);
    expect(bundle.attachments.every((attachment) => attachment.fileName.startsWith("SYNTHETIC_ONLY_"))).toBe(true);
    expect(bundle.insurers).toHaveLength(6);
    expect(bundle.insurers.every((insurer) => insurer.endpointMode === "simulator_only")).toBe(true);
    expect(bundle.insurers.every((insurer) => insurer.simulatorPhone.startsWith("+161355501"))).toBe(true);
  });

  it("keeps all claim numbers and member IDs unique across clean, messy, and profile datasets", () => {
    const bundle = generatePracticeBundle("synthetic_claim_standard", "unique", 100);
    const records = [...bundle.cleanRecords, ...bundle.messyRecords, ...bundle.profileRecords];
    expect(new Set(records.map((record) => record.claim.claim_number)).size).toBe(records.length);
    expect(new Set(records.map((record) => record.claim.subscriber_id)).size).toBe(records.length);
  });

  it("produces an importable messy export without duplicate rows", () => {
    const bundle = generatePracticeBundle("synthetic_claim_standard", "messy", 8);
    expect(bundle.messyRecords).toHaveLength(8);
    expect(new Set(bundle.messyRecords.map((record) => record.claim.claim_number)).size).toBe(8);
    expect(bundle.messyRecords[0]?.claim.treatment_codes).toBe("");
    expect(bundle.messyRecords[1]?.claim.submitted_date).toBe("");
    expect(bundle.messyRecords[2]?.claim.expected_amount).toBe("");
    expect(bundle.messyRecords[3]?.claim.treatment_date).toBe("");
    expect(bundle.csv.messy.split("\n").filter(Boolean)).toHaveLength(9);
  });

  it("creates dispatch boundary fixtures at 29, 30, 90, and 91 days", () => {
    const bundle = generatePracticeBundle("synthetic_claim_dispatch", "dispatch", 8);
    expect(bundle.profileRecords.map((record) => Number(record.claim.days_outstanding))).toEqual([29, 30, 90, 91, 29, 30, 90, 91]);
  });

  it("creates documentation and payment variations without real data", () => {
    const documentation = generatePracticeBundle("synthetic_claim_documentation", "docs", 8);
    expect(documentation.profileRecords[0]?.claim.treatment_codes).toBe("");
    expect(documentation.scenarioData.requiredDocument).toBe("synthetic_xray");

    const payment = generatePracticeBundle("synthetic_claim_payment", "payments", 8);
    for (const record of payment.profileRecords) {
      expect(Number(record.claim.amount_outstanding)).toBeGreaterThan(0);
      expect(Number(record.claim.amount_outstanding)).toBeLessThan(Number(record.claim.amount_billed));
    }
    expect(payment.scenarioData.paymentState).toBe("partial_payment");
  });

  it("fails closed for an unsupported profile, unsafe seed, or invalid count", () => {
    expect(() => generatePracticeBundle("missing" as never, "safe", 8)).toThrow("unsupported fixture profile");
    expect(() => generatePracticeBundle("synthetic_claim_standard", "unsafe seed", 8)).toThrow("seed is invalid");
    expect(() => generatePracticeBundle("synthetic_claim_standard", "safe", 3)).toThrow("count must be an integer");
  });
});
