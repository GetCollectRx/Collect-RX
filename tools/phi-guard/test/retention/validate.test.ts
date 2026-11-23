import { describe, expect, it } from "vitest";
import { parseArgs, parseEnv } from "../../src/retention/validate.js";

const CALL_ID = "123E4567-E89B-42D3-A456-426614174000";
const good = ["--call-id", CALL_ID, "--container", "call-artifacts", "--prefix", "calls/2026/"];

function withFlag(flag: string, value: string): string[] {
  const copy = [...good];
  copy[copy.indexOf(flag) + 1] = value;
  return copy;
}

describe("parseArgs", () => {
  it("accepts valid arguments and lowercases the call id", () => {
    expect(parseArgs(good)).toEqual({
      ok: true,
      value: { callId: CALL_ID.toLowerCase(), container: "call-artifacts", prefix: "calls/2026/" },
    });
  });

  it("accepts the flags in any order", () => {
    const shuffled = ["--prefix", "p", "--container", "abc", "--call-id", CALL_ID];
    expect(parseArgs(shuffled).ok).toBe(true);
  });

  it.each([
    ["no arguments", []],
    ["missing --call-id", ["--container", "abc", "--prefix", "p"]],
    ["missing --container", ["--call-id", CALL_ID, "--prefix", "p"]],
    ["missing --prefix", ["--call-id", CALL_ID, "--container", "abc"]],
    ["a flag without a value", ["--call-id", CALL_ID, "--container", "abc", "--prefix"]],
    ["an unknown flag", [...good, "--force", "y"]],
    ["a repeated flag", [...good, "--prefix", "q"]],
    ["a bare word", ["call-id", CALL_ID]],
  ])("rejects %s as usage", (_label, argv) => {
    expect(parseArgs(argv)).toEqual({ ok: false, problem: "usage" });
  });

  it.each([
    "",
    "not-a-uuid",
    "123e4567e89b42d3a456426614174000",
    "123e4567-e89b-42d3-a456-42661417400",
    "123e4567-e89b-42d3-a456-4266141740000",
    "123e4567-e89b-42d3-a456-42661417400g",
    "../../etc/passwd",
    `${CALL_ID}/../x`,
    `${CALL_ID}?x=1`,
    `${CALL_ID} `,
    "123e4567-e89b-42d3-a456-426614174000\n",
  ])("rejects call id %j", (value) => {
    expect(parseArgs(withFlag("--call-id", value))).toEqual({ ok: false, problem: "call-id" });
  });

  it.each([
    "",
    "ab",
    "A".repeat(10),
    "has_underscore",
    "-leading",
    "trailing-",
    "double--hyphen",
    "a".repeat(64),
    "con tainer",
    "../x",
  ])("rejects container %j", (value) => {
    expect(parseArgs(withFlag("--container", value))).toEqual({ ok: false, problem: "container" });
  });

  it.each(["abc", "a-b-c", "a".repeat(63)])("accepts container %j", (value) => {
    expect(parseArgs(withFlag("--container", value)).ok).toBe(true);
  });

  it.each(["", "a b", "a/../b", "..", "a".repeat(201), "p\nq", "p;q", "p$q", "a\\b", "\u00E9"])(
    "rejects prefix %j",
    (value) => {
      expect(parseArgs(withFlag("--prefix", value))).toEqual({ ok: false, problem: "prefix" });
    },
  );

  it.each(["calls/", "a.b-c_d/e", "x".repeat(200)])("accepts prefix %j", (value) => {
    expect(parseArgs(withFlag("--prefix", value)).ok).toBe(true);
  });
});

describe("parseEnv", () => {
  const env = { VAPI_API_KEY: "test-key-not-a-real-credential", AZURE_STORAGE_ACCOUNT: "synthaccount01" };

  it("accepts a valid environment", () => {
    expect(parseEnv(env)).toEqual({
      ok: true,
      value: { apiKey: "test-key-not-a-real-credential", account: "synthaccount01" },
    });
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", "short"],
    ["containing a space", "has space in key"],
    ["containing a newline", "valid-looking-key\n"],
    ["too long", "k".repeat(513)],
  ])("rejects a VAPI_API_KEY that is %s", (_label, value) => {
    expect(parseEnv({ ...env, VAPI_API_KEY: value })).toEqual({ ok: false, problem: "VAPI_API_KEY" });
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", "ab"],
    ["too long", "a".repeat(25)],
    ["uppercase", "ABCDEF"],
    ["with a dot", "a.b.c"],
    ["a URL", "acct.blob.core.windows.net"],
  ])("rejects an AZURE_STORAGE_ACCOUNT that is %s", (_label, value) => {
    expect(parseEnv({ ...env, AZURE_STORAGE_ACCOUNT: value })).toEqual({
      ok: false,
      problem: "AZURE_STORAGE_ACCOUNT",
    });
  });

  it("ignores any connection string or account key variables", () => {
    const result = parseEnv({
      ...env,
      AZURE_STORAGE_CONNECTION_STRING: "x",
      AZURE_STORAGE_KEY: "y",
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("AZURE_STORAGE_KEY");
  });
});
