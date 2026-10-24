import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toCsv } from "../../src/synthetic/csv.js";
import { SYNTHETIC_HEADERS, generateRecords } from "../../src/synthetic/generate.js";

/**
 * Runs generated rows through the repository's own import code. Only the pure
 * stages are exercised here: CSV parsing, row normalisation, carrier mapping,
 * line merging and total validation. The database stages (claim upsert, PHI
 * vault, submission gate, call queue) need Prisma and are not run.
 */

const REPO_SERVER = fileURLToPath(new URL("../../../../Collect-RX-main/src/server/", import.meta.url));
const available = existsSync(`${REPO_SERVER}csv/parseSimple.ts`);

interface NormalizedRow {
  claimNumber: string;
  patientFirstName: string;
  patientLastName: string;
  carrierName: string;
  procedureCode: string;
  servicedAt: Date | null;
  submittedAt: Date | null;
  treatmentCodes: string | null;
  billedAmount: number;
  outstandingAmount: number;
  expectedAmount: number | null;
  insurancePaidAmount: number | null;
  daysOutstanding: number;
  patientDob: string | null;
  subscriberId: string | null;
  groupPolicyNumber: string | null;
  denialReasonCode: string | null;
  transactionType: string | null;
  treatingDentistProviderNumber: string | null;
}

interface RepoPipeline {
  parseSimpleCsv: (text: string) => Array<Record<string, string>>;
  normalizePmsClaimRow: (raw: Record<string, unknown>, family: "generic") => NormalizedRow;
  mapToCarrierId: (raw: string) => string | null;
  mergeClaimRows: (rows: NormalizedRow[]) => { rows: NormalizedRow[]; conflicts: unknown[] };
  validateImportTotals: (input: {
    sourceRecordCount: number;
    importedRecordCount: number;
    sourceBalanceTotal: number;
    importedBalanceTotal: number;
  }) => { passed: boolean };
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function";
}

async function load(): Promise<RepoPipeline> {
  const parse: unknown = await import(`${REPO_SERVER}csv/parseSimple.ts`);
  const normalize: unknown = await import(`${REPO_SERVER}pms/parseExportRows.ts`);
  const carrier: unknown = await import(`${REPO_SERVER}pms/carrierMap.ts`);
  const merge: unknown = await import(`${REPO_SERVER}pms/claimRowMerge.ts`);
  const totals: unknown = await import(`${REPO_SERVER}pms/importValidation.ts`);
  const pick = (module: unknown, name: string): unknown =>
    typeof module === "object" && module !== null ? (module as Record<string, unknown>)[name] : undefined;
  const parts = {
    parseSimpleCsv: pick(parse, "parseSimpleCsv"),
    normalizePmsClaimRow: pick(normalize, "normalizePmsClaimRow"),
    mapToCarrierId: pick(carrier, "mapToCarrierId"),
    mergeClaimRows: pick(merge, "mergeClaimRows"),
    validateImportTotals: pick(totals, "validateImportTotals"),
  };
  for (const [name, fn] of Object.entries(parts)) {
    if (!isFunction(fn)) {
      throw new Error(`repository export ${name} not found`);
    }
  }
  return parts as unknown as RepoPipeline;
}

describe.skipIf(!available)("generated rows against the repository import path", () => {
  const records = generateRecords(120, "pipeline");
  const csv = toCsv(records.map((r) => r.claim));

  it("parses every row with the repository CSV parser and keeps every header", async () => {
    const { parseSimpleCsv } = await load();
    const rows = parseSimpleCsv(csv);
    expect(rows).toHaveLength(records.length);
    for (const [index, row] of rows.entries()) {
      expect(Object.keys(row)).toEqual([...SYNTHETIC_HEADERS]);
      expect(row).toEqual(records[index]?.claim);
    }
  });

  it("normalises every row, maps every carrier, merges nothing, and passes the totals check", async () => {
    const pipeline = await load();
    const rows = pipeline.parseSimpleCsv(csv);
    const normalized = rows.map((row) => pipeline.normalizePmsClaimRow(row, "generic"));
    expect(normalized).toHaveLength(records.length);

    for (const [index, row] of normalized.entries()) {
      const source = records[index];
      expect(source).toBeDefined();
      expect(row.claimNumber).toBe(source?.claim.claim_number);
      expect(row.patientFirstName).toBe(source?.claim.patient_first_name);
      expect(row.patientLastName).toBe(source?.claim.patient_last_name);
      expect(row.patientDob).toBe(source?.claim.patient_dob);
      expect(row.subscriberId).toBe(source?.claim.subscriber_id);
      expect(row.groupPolicyNumber).toBe(source?.claim.group_policy_number);
      expect(pipeline.mapToCarrierId(row.carrierName)).not.toBeNull();

      // Conditions the claim importer, submission gate and call queue test.
      expect(row.outstandingAmount).toBeGreaterThan(0);
      expect(row.daysOutstanding).toBeGreaterThanOrEqual(30);
      expect(row.daysOutstanding).toBeLessThanOrEqual(90);
      expect(row.treatmentCodes?.trim()).toBeTruthy();
      expect(row.procedureCode).toBeTruthy();
      expect(row.servicedAt).not.toBeNull();
      expect(row.submittedAt).not.toBeNull();
      expect(row.expectedAmount ?? 0).toBeGreaterThan(0);
      expect(row.insurancePaidAmount).toBeNull();
      expect(row.denialReasonCode).toBeNull();
      expect(row.transactionType).toBeNull();
      expect(row.treatingDentistProviderNumber).toBeNull();
    }

    const merged = pipeline.mergeClaimRows(normalized);
    expect(merged.conflicts).toEqual([]);
    expect(merged.rows).toHaveLength(records.length);

    const balance = normalized.reduce((sum, row) => sum + row.outstandingAmount, 0);
    expect(
      pipeline.validateImportTotals({
        sourceRecordCount: normalized.length,
        importedRecordCount: normalized.length,
        sourceBalanceTotal: balance,
        importedBalanceTotal: balance,
      }).passed,
    ).toBe(true);
  });

  it("resolves every generated carrier name to a supported carrier", async () => {
    const { mapToCarrierId } = await load();
    const ids = new Set(
      ["Sun Life", "Canada Life", "Manulife", "Green Shield", "RBC", "TELUS AdjudiCare"].map((name) =>
        mapToCarrierId(name),
      ),
    );
    expect([...ids].sort()).toEqual(["canada_life", "green_shield", "manulife", "rbc", "sun_life", "telus_adjudicare"]);
  });
});
