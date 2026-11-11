import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toCsv } from "../../src/synthetic/csv.js";
import {
  ANCHOR_DATE,
  CLAIM_NUMBER_PREFIX,
  DOB_RANGE,
  MAX_COUNT,
  MAX_DAYS_OUTSTANDING,
  MEMBER_ID_PREFIX,
  MIN_DAYS_OUTSTANDING,
  SYNTHETIC_HEADERS,
  generateRecords,
} from "../../src/synthetic/generate.js";
import { SYNTHETIC_CARRIERS, SYNTHETIC_NAMES } from "../../src/synthetic/names.js";
import { SeededRandom } from "../../src/synthetic/prng.js";
import { USAGE, run } from "../../src/synthetic/cli.js";
import { redact } from "../../src/redact/index.js";

describe("seeded generator", () => {
  it("gives identical output for the same seed", () => {
    expect(generateRecords(50, "seed-a")).toEqual(generateRecords(50, "seed-a"));
    expect(toCsv(generateRecords(50, "seed-a").map((r) => r.claim))).toBe(
      toCsv(generateRecords(50, "seed-a").map((r) => r.claim)),
    );
  });

  it("gives different output for different seeds", () => {
    expect(generateRecords(20, "seed-a")).not.toEqual(generateRecords(20, "seed-b"));
  });

  it("produces a stable prefix when asked for more rows", () => {
    expect(generateRecords(30, "seed-a").slice(0, 10)).toEqual(generateRecords(10, "seed-a"));
  });

  it("does not use Math.random", () => {
    const original = Math.random;
    Math.random = (): number => {
      throw new Error("Math.random must not be called");
    };
    try {
      expect(generateRecords(5, "seed-a")).toHaveLength(5);
    } finally {
      Math.random = original;
    }
  });

  it("covers the whole range with int()", () => {
    const rng = new SeededRandom("range");
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      seen.add(rng.int(0, 4));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("refuses to pick from an empty list", () => {
    expect(() => new SeededRandom("x").pick([])).toThrow("synthetic-data: cannot pick from an empty list");
  });
});

describe("synthetic values", () => {
  const records = generateRecords(400, "values");

  it("marks every identifier as synthetic", () => {
    for (const { claim, context } of records) {
      expect(claim.subscriber_id.startsWith(MEMBER_ID_PREFIX)).toBe(true);
      expect(claim.claim_number.startsWith(CLAIM_NUMBER_PREFIX)).toBe(true);
      expect(claim.group_policy_number.startsWith("SYN-GRP-")).toBe(true);
      expect(context.memberId).toBe(claim.subscriber_id);
      expect(context.claimNumber).toBe(claim.claim_number);
    }
  });

  it("keeps identifiers unique", () => {
    expect(new Set(records.map((r) => r.claim.claim_number)).size).toBe(records.length);
    expect(new Set(records.map((r) => r.claim.subscriber_id)).size).toBe(records.length);
  });

  it("uses only the fixed fictional names", () => {
    expect(SYNTHETIC_NAMES).toHaveLength(20);
    const allowed = new Set(SYNTHETIC_NAMES.map((n) => `${n.first} ${n.last}`));
    for (const { claim } of records) {
      expect(allowed.has(`${claim.patient_first_name} ${claim.patient_last_name}`)).toBe(true);
    }
    expect(new Set(records.map((r) => r.claim.patient_last_name)).size).toBe(20);
  });

  it("uses only the six carriers", () => {
    expect([...SYNTHETIC_CARRIERS]).toEqual([
      "Sun Life",
      "Canada Life",
      "Manulife",
      "Green Shield",
      "RBC",
      "TELUS AdjudiCare",
    ]);
    const seen = new Set(records.map((r) => r.claim.insurance_carrier));
    expect([...seen].sort()).toEqual([...SYNTHETIC_CARRIERS].sort());
  });

  it("keeps dates of birth inside the documented range", () => {
    for (const { claim } of records) {
      expect(claim.patient_dob).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(claim.patient_dob >= DOB_RANGE.first).toBe(true);
      expect(claim.patient_dob <= DOB_RANGE.last).toBe(true);
    }
  });

  it("keeps service dates and ages consistent with the fixed anchor", () => {
    const anchor = Date.parse(ANCHOR_DATE);
    for (const { claim } of records) {
      const days = Number(claim.days_outstanding);
      expect(days).toBeGreaterThanOrEqual(MIN_DAYS_OUTSTANDING);
      expect(days).toBeLessThanOrEqual(MAX_DAYS_OUTSTANDING);
      expect((anchor - Date.parse(claim.treatment_date)) / 86400000).toBe(days);
      const gap = (Date.parse(claim.submitted_date) - Date.parse(claim.treatment_date)) / 86400000;
      expect(gap).toBeGreaterThanOrEqual(1);
      expect(gap).toBeLessThanOrEqual(3);
    }
  });

  it("writes money as plain two-place decimals with a positive balance", () => {
    for (const { claim } of records) {
      for (const value of [claim.amount_billed, claim.amount_outstanding, claim.expected_amount]) {
        expect(value).toMatch(/^[1-9]\d*\.\d{2}$|^0\.\d{2}$/u);
      }
      expect(Number(claim.amount_outstanding)).toBeGreaterThan(0);
      expect(Number(claim.amount_outstanding)).toBeLessThanOrEqual(Number(claim.amount_billed));
      expect(Number(claim.expected_amount)).toBeGreaterThan(0);
    }
  });

  it("never starts a value with a formula character", () => {
    for (const { claim } of records) {
      for (const value of Object.values(claim)) {
        expect(value).not.toMatch(/^[=+\-@%\t\r]/u);
      }
    }
  });

  it("produces contexts that module A accepts and redacts completely", () => {
    for (const { claim, context } of records.slice(0, 60)) {
      const transcript = `Patient ${claim.patient_first_name} ${claim.patient_last_name} born ${claim.patient_dob}, member ${claim.subscriber_id}, claim ${claim.claim_number}.`;
      const { redacted } = redact(transcript, context);
      for (const secret of [
        claim.patient_first_name,
        claim.patient_last_name,
        claim.patient_dob,
        claim.subscriber_id,
        claim.claim_number,
      ]) {
        expect(redacted).not.toContain(secret);
      }
    }
  });
});

describe("CSV output", () => {
  it("writes the documented header row and quotes multi-code cells", () => {
    const records = generateRecords(200, "csv");
    const csv = toCsv(records.map((r) => r.claim));
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(SYNTHETIC_HEADERS.join(","));
    expect(lines).toHaveLength(201);
    expect(csv.endsWith("\n")).toBe(true);
    expect(csv).toMatch(/"D\d{4},D\d{4}"/u);
  });

  it("escapes quotes and line breaks in cells", () => {
    const [record] = generateRecords(1, "escape");
    if (record === undefined) {
      throw new Error("expected a record");
    }
    const csv = toCsv([{ ...record.claim, patient_first_name: 'A "B"\nC' }]);
    expect(csv).toContain('"A ""B""\nC"');
  });
});

describe("generate command", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "phi-guard-synthetic-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const capture = (): { io: { out: (l: string) => void; err: (l: string) => void }; out: string[]; err: string[] } => {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
  };

  it("writes claims.csv and one context file per row", () => {
    const { io, out } = capture();
    expect(run(["generate", "--count", "7", "--seed", "abc", "--out", join(dir, "nested", "out")], io)).toBe(0);
    expect(out).toEqual(["wrote 7 synthetic claims"]);
    const target = join(dir, "nested", "out");
    const files = readdirSync(target).sort();
    expect(files.filter((f) => f.startsWith("context-SYN-CLM-") && f.endsWith(".json"))).toHaveLength(7);
    expect(files).toContain("claims.csv");
    const records = generateRecords(7, "abc");
    expect(readFileSync(join(target, "claims.csv"), "utf8")).toBe(toCsv(records.map((r) => r.claim)));
    for (const record of records) {
      const text = readFileSync(join(target, `context-${record.context.claimNumber}.json`), "utf8");
      expect(JSON.parse(text)).toEqual(record.context);
    }
  });

  it("writes byte-identical files for the same seed", () => {
    const a = join(dir, "a");
    const b = join(dir, "b");
    run(["generate", "--count", "5", "--seed", "same", "--out", a], capture().io);
    run(["generate", "--count", "5", "--seed", "same", "--out", b], capture().io);
    for (const file of readdirSync(a)) {
      expect(readFileSync(join(b, file), "utf8")).toBe(readFileSync(join(a, file), "utf8"));
    }
  });

  const bad: ReadonlyArray<[string, string[]]> = [
    ["no command", []],
    ["unknown command", ["wipe", "--count", "1", "--seed", "a", "--out", "x"]],
    ["missing count", ["generate", "--seed", "a", "--out", "x"]],
    ["missing seed", ["generate", "--count", "1", "--out", "x"]],
    ["missing out", ["generate", "--count", "1", "--seed", "a"]],
    ["flag without value", ["generate", "--count", "1", "--seed", "a", "--out"]],
    ["unknown flag", ["generate", "--count", "1", "--seed", "a", "--out", "x", "--force", "y"]],
    ["repeated flag", ["generate", "--count", "1", "--count", "2", "--seed", "a", "--out", "x"]],
    ["zero count", ["generate", "--count", "0", "--seed", "a", "--out", "x"]],
    ["negative count", ["generate", "--count", "-3", "--seed", "a", "--out", "x"]],
    ["fractional count", ["generate", "--count", "1.5", "--seed", "a", "--out", "x"]],
    ["non-numeric count", ["generate", "--count", "ten", "--seed", "a", "--out", "x"]],
    ["count above the maximum", ["generate", "--count", String(MAX_COUNT + 1), "--seed", "a", "--out", "x"]],
    ["empty seed", ["generate", "--count", "1", "--seed", "", "--out", "x"]],
    ["seed with spaces", ["generate", "--count", "1", "--seed", "a b", "--out", "x"]],
    ["seed too long", ["generate", "--count", "1", "--seed", "a".repeat(65), "--out", "x"]],
    ["blank out", ["generate", "--count", "1", "--seed", "a", "--out", "  "]],
    ["out with a null byte", ["generate", "--count", "1", "--seed", "a", "--out", "a\0b"]],
  ];
  it.each(bad)("exits 2 with usage for %s and writes nothing", (_label, args) => {
    const { io, out, err } = capture();
    expect(run(args, io)).toBe(2);
    expect(err).toEqual([USAGE]);
    expect(out).toEqual([]);
  });

  it("accepts the maximum count", () => {
    expect(generateRecords(MAX_COUNT, "max")).toHaveLength(MAX_COUNT);
  });
});
