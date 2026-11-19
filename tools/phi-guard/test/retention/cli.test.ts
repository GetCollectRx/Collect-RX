import { describe, expect, it, vi } from "vitest";
import { USAGE, run } from "../../src/retention/cli.js";
import type { CliDeps } from "../../src/retention/cli.js";
import { RetentionError } from "../../src/retention/types.js";
import type { FieldStatus, RetentionSource, SourceResult } from "../../src/retention/types.js";

// All values are invented placeholders.
const CALL_ID = "123e4567-e89b-42d3-a456-426614174000";
const API_KEY = "test-key-not-a-real-credential";
const ENV = { VAPI_API_KEY: API_KEY, AZURE_STORAGE_ACCOUNT: "synthaccount01" };
const ARGS = ["--call-id", CALL_ID, "--container", "call-artifacts", "--prefix", "calls/"];

const FIELDS = ["artifact.transcript", "artifact.logUrl", "analysis.summary"];

function result(overrides: Partial<SourceResult> = {}, present: readonly string[] = []): SourceResult {
  const fields: FieldStatus[] = FIELDS.map((field) => ({ field, present: present.includes(field) }));
  return { complete: true, detail: "status=ended", fields, ...overrides };
}

function harness(options: {
  source?: () => Promise<SourceResult>;
  blobs?: () => Promise<string[]>;
}) {
  const check = vi.fn<RetentionSource["check"]>(options.source ?? (() => Promise.resolve(result())));
  const listBlobs = vi.fn<CliDeps["listBlobs"]>(options.blobs ?? (() => Promise.resolve([`calls/${CALL_ID}/a.json`])));
  const createSource = vi.fn<CliDeps["createSource"]>(() => ({ name: "vapi", check }));
  const out: string[] = [];
  const err: string[] = [];
  const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
  return { deps: { createSource, listBlobs }, check, listBlobs, createSource, io, out, err };
}

describe("exit 0", () => {
  it("passes when Vapi holds no content and a blob exists", async () => {
    const h = harness({});
    expect(await run(ARGS, ENV, h.io, h.deps)).toBe(0);
    expect(h.out).toContain("vapi result: PASS (no content fields present)");
    expect(h.out).toContain("  matching blobs: 1");
    expect(h.out).toContain(`  - calls/${CALL_ID}/a.json`);
    expect(h.out.at(-1)).toBe("overall: PASS");
    expect(h.err).toEqual([]);
    expect(h.createSource).toHaveBeenCalledWith(API_KEY);
    expect(h.check).toHaveBeenCalledWith(CALL_ID);
    expect(h.listBlobs).toHaveBeenCalledWith({
      account: "synthaccount01",
      container: "call-artifacts",
      prefix: "calls/",
      callId: CALL_ID,
    });
  });

  it("reports every field as present or absent", async () => {
    const h = harness({});
    await run(ARGS, ENV, h.io, h.deps);
    expect(h.out).toContain("  absent  artifact.transcript");
    expect(h.out).toContain("  absent  artifact.logUrl");
    expect(h.out).toContain("  absent  analysis.summary");
  });
});

describe("exit 1", () => {
  it.each(FIELDS)("fails when %s holds content", async (field) => {
    const h = harness({ source: () => Promise.resolve(result({}, [field])) });
    expect(await run(ARGS, ENV, h.io, h.deps)).toBe(1);
    expect(h.out).toContain(`  PRESENT ${field}`);
    expect(h.out).toContain("vapi result: FAIL (1 content field(s) present)");
    expect(h.out.at(-1)).toBe("overall: FAIL");
  });

  it("fails and counts several present fields", async () => {
    const h = harness({ source: () => Promise.resolve(result({}, FIELDS)) });
    expect(await run(ARGS, ENV, h.io, h.deps)).toBe(1);
    expect(h.out).toContain("vapi result: FAIL (3 content field(s) present)");
  });

  it("fails when the call has not ended, even with every field absent", async () => {
    const h = harness({ source: () => Promise.resolve(result({ complete: false, detail: "status=in-progress" })) });
    expect(await run(ARGS, ENV, h.io, h.deps)).toBe(1);
    expect(h.out).toContain("  status=in-progress");
    expect(h.out).toContain("vapi result: FAIL (call has not ended, so absence is not proof)");
  });

  it("fails when no blob matches", async () => {
    const h = harness({ blobs: () => Promise.resolve([]) });
    expect(await run(ARGS, ENV, h.io, h.deps)).toBe(1);
    expect(h.out).toContain("  matching blobs: 0");
    expect(h.out).toContain("azure result: FAIL (no matching blobs)");
  });

  it("fails on a Vapi HTTP error but still checks Azure", async () => {
    const h = harness({ source: () => Promise.reject(new RetentionError("http", "Vapi returned HTTP 401")) });
    expect(await run(ARGS, ENV, h.io, h.deps)).toBe(1);
    expect(h.out).toContain("vapi result: FAIL (Vapi returned HTTP 401)");
    expect(h.listBlobs).toHaveBeenCalledOnce();
    expect(h.out).toContain("azure result: PASS");
  });

  it("fails on a non-JSON Vapi response", async () => {
    const h = harness({ source: () => Promise.reject(new RetentionError("parse", "Vapi response was not valid JSON")) });
    expect(await run(ARGS, ENV, h.io, h.deps)).toBe(1);
    expect(h.out).toContain("vapi result: FAIL (Vapi response was not valid JSON)");
  });

  it("fails on an Azure error", async () => {
    const h = harness({
      blobs: () => Promise.reject(new RetentionError("azure", "Azure listing failed: RestError (HTTP 403)")),
    });
    expect(await run(ARGS, ENV, h.io, h.deps)).toBe(1);
    expect(h.out).toContain("azure result: FAIL (Azure listing failed: RestError (HTTP 403))");
  });

  it("hides the text of unexpected errors", async () => {
    const h = harness({
      source: () => Promise.reject(new Error(`leak ${API_KEY}`)),
      blobs: () => Promise.reject(new Error("leak synthaccount01")),
    });
    expect(await run(ARGS, ENV, h.io, h.deps)).toBe(1);
    const text = h.out.join("\n");
    expect(text).toContain("vapi result: FAIL (unexpected error)");
    expect(text).toContain("azure result: FAIL (unexpected error)");
    expect(text).not.toContain("leak");
    expect(text).not.toContain(API_KEY);
  });

  it("shows at most 50 blob names and counts the rest", async () => {
    const names = Array.from({ length: 53 }, (_, i) => `calls/${CALL_ID}/${String(i)}.json`);
    const h = harness({ blobs: () => Promise.resolve(names) });
    expect(await run(ARGS, ENV, h.io, h.deps)).toBe(0);
    expect(h.out.filter((l) => l.startsWith("  - "))).toHaveLength(50);
    expect(h.out).toContain("  (3 more not shown)");
    expect(h.out).toContain("  matching blobs: 53");
  });

  it("replaces control and non-ASCII characters in blob names", async () => {
    const h = harness({ blobs: () => Promise.resolve([`calls/${CALL_ID}/\u001b[31mred\u00E9\n.json`]) });
    await run(ARGS, ENV, h.io, h.deps);
    expect(h.out).toContain(`  - calls/${CALL_ID}/?[31mred??.json`);
    expect(h.out.join("\n")).not.toContain("\u001b");
  });
});

describe("exit 2", () => {
  const cases: ReadonlyArray<[string, string[], Record<string, string | undefined>, string]> = [
    ["no arguments", [], ENV, USAGE],
    ["a missing flag", ARGS.slice(0, 4), ENV, USAGE],
    ["an unknown flag", [...ARGS, "--x", "y"], ENV, USAGE],
    ["an invalid call id", ["--call-id", "nope", ...ARGS.slice(2)], ENV, "invalid --call-id: expected a UUID"],
    [
      "a path-like call id",
      ["--call-id", "../../x", ...ARGS.slice(2)],
      ENV,
      "invalid --call-id: expected a UUID",
    ],
    [
      "an invalid container",
      [...ARGS.slice(0, 2), "--container", "Bad_Name", ...ARGS.slice(4)],
      ENV,
      "invalid --container: expected an Azure container name",
    ],
    [
      "an invalid prefix",
      [...ARGS.slice(0, 4), "--prefix", "../x"],
      ENV,
      "invalid --prefix: expected 1 to 200 of letters, digits, . _ - /",
    ],
    ["a missing VAPI_API_KEY", ARGS, { AZURE_STORAGE_ACCOUNT: "synthaccount01" }, "VAPI_API_KEY is missing or malformed"],
    ["an empty VAPI_API_KEY", ARGS, { ...ENV, VAPI_API_KEY: "" }, "VAPI_API_KEY is missing or malformed"],
    [
      "a missing AZURE_STORAGE_ACCOUNT",
      ARGS,
      { VAPI_API_KEY: API_KEY },
      "AZURE_STORAGE_ACCOUNT is missing or malformed",
    ],
    [
      "an invalid AZURE_STORAGE_ACCOUNT",
      ARGS,
      { ...ENV, AZURE_STORAGE_ACCOUNT: "Bad.Account" },
      "AZURE_STORAGE_ACCOUNT is missing or malformed",
    ],
    ["no environment at all", ARGS, {}, "VAPI_API_KEY is missing or malformed"],
  ];

  it.each(cases)("rejects %s before any request", async (_label, argv, env, message) => {
    const h = harness({});
    expect(await run(argv, env, h.io, h.deps)).toBe(2);
    expect(h.err).toEqual([message]);
    expect(h.out).toEqual([]);
    expect(h.createSource).not.toHaveBeenCalled();
    expect(h.check).not.toHaveBeenCalled();
    expect(h.listBlobs).not.toHaveBeenCalled();
  });

  it("never echoes the rejected value", async () => {
    const h = harness({});
    await run(["--call-id", "SECRET-VALUE", ...ARGS.slice(2)], ENV, h.io, h.deps);
    expect(h.err.join("\n")).not.toContain("SECRET-VALUE");
  });
});

describe("output hygiene", () => {
  it("never prints field values, the API key or response content", async () => {
    const h = harness({
      source: () =>
        Promise.resolve({
          complete: true,
          detail: "status=ended",
          fields: [{ field: "artifact.transcript", present: true }],
        }),
    });
    await run(ARGS, ENV, h.io, h.deps);
    const text = [...h.out, ...h.err].join("\n");
    expect(text).not.toContain(API_KEY);
    expect(text).toContain("PRESENT artifact.transcript");
  });
});
