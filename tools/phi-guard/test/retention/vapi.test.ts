import { describe, expect, it, vi } from "vitest";
import { CONTENT_FIELDS, VAPI_CALL_URL, createVapiSource, isEmptyValue } from "../../src/retention/vapi.js";
import { RetentionError } from "../../src/retention/types.js";

// Identifiers below are invented placeholders.
const CALL_ID = "123e4567-e89b-42d3-a456-426614174000";
const API_KEY = "test-key-not-a-real-credential";

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });
}

function source(fetchImpl: typeof fetch) {
  return createVapiSource({ apiKey: API_KEY, fetchImpl });
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current = target;
  for (const key of keys.slice(0, -1)) {
    const next: Record<string, unknown> = {};
    current[key] = next;
    current = next;
  }
  current[keys[keys.length - 1] ?? ""] = value;
}

const ENDED = { id: CALL_ID, status: "ended" };

describe("content fields", () => {
  it("lists only paths taken from the Vapi Get Call reference", () => {
    expect(CONTENT_FIELDS).toContain("artifact.transcript");
    expect(CONTENT_FIELDS).toContain("artifact.recordingUrl");
    expect(CONTENT_FIELDS).toContain("artifact.stereoRecordingUrl");
    expect(CONTENT_FIELDS).toContain("artifact.logUrl");
    expect(CONTENT_FIELDS).toContain("artifact.structuredOutputs");
    expect(CONTENT_FIELDS).toContain("artifact.messages");
    expect(CONTENT_FIELDS).toContain("messages");
    expect(CONTENT_FIELDS).toContain("analysis.summary");
    expect(new Set(CONTENT_FIELDS).size).toBe(CONTENT_FIELDS.length);
  });
});

describe("pass", () => {
  it.each([
    ["every field absent", { ...ENDED }],
    ["artifact and analysis absent", { ...ENDED, artifact: undefined }],
    ["null values", { ...ENDED, artifact: { transcript: null, recordingUrl: null }, analysis: { summary: null } }],
    ["empty strings", { ...ENDED, artifact: { transcript: "", logUrl: "   " }, analysis: { summary: "" } }],
    ["empty arrays", { ...ENDED, messages: [], artifact: { messages: [] } }],
    ["empty objects", { ...ENDED, artifact: { structuredOutputs: {}, variableValues: {}, recording: {} } }],
    ["nested empties", { ...ENDED, artifact: { recording: { mono: {}, stereoUrl: "" }, transfers: [{}] } }],
    ["unrelated fields set", { ...ENDED, cost: 0.4, artifact: { performanceMetrics: { turnLatency: 3 } }, monitor: { listenUrl: "x" } }],
  ])("reports no content when %s", async (_label, body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
    const result = await source(fetchImpl).check(CALL_ID);
    expect(result.complete).toBe(true);
    expect(result.detail).toBe("status=ended");
    expect(result.fields).toHaveLength(CONTENT_FIELDS.length);
    expect(result.fields.filter((f) => f.present)).toEqual([]);
  });

  it("sends a bearer token to the documented URL and refuses redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(ENDED));
    await source(fetchImpl).check(CALL_ID);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`${VAPI_CALL_URL}${CALL_ID}`);
    expect(url).toBe(`https://api.vapi.ai/call/${CALL_ID}`);
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({ Authorization: `Bearer ${API_KEY}`, Accept: "application/json" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("each failing field", () => {
  it.each(CONTENT_FIELDS.map((field) => [field]))("flags only %s when it holds content", async (field) => {
    const body: Record<string, unknown> = { ...ENDED };
    setPath(body, field, "content-that-must-never-be-printed");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
    const result = await source(fetchImpl).check(CALL_ID);
    expect(result.complete).toBe(true);
    expect(result.fields.filter((f) => f.present).map((f) => f.field)).toEqual([field]);
    expect(JSON.stringify(result)).not.toContain("must-never-be-printed");
  });

  it.each([
    ["a number", 0],
    ["false", false],
    ["a non-empty array", [{ role: "user" }]],
    ["a non-empty object", { a: { b: "x" } }],
    ["an object holding zero", { score: 0 }],
  ])("counts %s as content", async (_label, value) => {
    const body = { ...ENDED, artifact: { variableValues: value } };
    const result = await source(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body))).check(CALL_ID);
    expect(result.fields.find((f) => f.field === "artifact.variableValues")?.present).toBe(true);
  });
});

describe("call state", () => {
  it.each(["scheduled", "queued", "ringing", "in-progress", "forwarding", "not-found", "deletion-failed"])(
    "is not complete while status is %s",
    async (status) => {
      const result = await source(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status }))).check(CALL_ID);
      expect(result.complete).toBe(false);
      expect(result.detail).toBe(`status=${status}`);
    },
  );

  it.each([
    ["missing", {}],
    ["not a string", { status: 5 }],
    ["unexpected characters", { status: "ended; DROP TABLE" }],
    ["too long", { status: "a".repeat(40) }],
  ])("treats a %s status as unknown and incomplete", async (_label, body) => {
    const result = await source(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body))).check(CALL_ID);
    expect(result.complete).toBe(false);
    expect(result.detail).toBe("status=unknown");
  });
});

describe("failures", () => {
  async function failure(fetchImpl: typeof fetch): Promise<RetentionError> {
    try {
      await source(fetchImpl).check(CALL_ID);
    } catch (error) {
      if (error instanceof RetentionError) {
        return error;
      }
    }
    throw new Error("expected a RetentionError");
  }

  it.each([401, 403, 404, 429, 500, 503])("reports HTTP %i without the response body", async (status) => {
    const error = await failure(
      vi.fn<typeof fetch>().mockResolvedValue(new Response("BODY-WITH-SECRET-TEXT", { status })),
    );
    expect(error.kind).toBe("http");
    expect(error.message).toBe(`Vapi returned HTTP ${String(status)}`);
    expect(error.message).not.toContain("SECRET");
  });

  it("reports non-JSON responses without echoing them", async () => {
    const error = await failure(vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>SECRET</html>")));
    expect(error.kind).toBe("parse");
    expect(error.message).toBe("Vapi response was not valid JSON");
  });

  it.each([["an array", "[1]"], ["null", "null"], ["a string", '"x"'], ["a number", "7"]])(
    "rejects %s as a response body",
    async (_label, text) => {
      const error = await failure(vi.fn<typeof fetch>().mockResolvedValue(new Response(text)));
      expect(error.kind).toBe("parse");
      expect(error.message).toBe("Vapi response was not a JSON object");
    },
  );

  it("hides the cause of a network failure, including the key", async () => {
    const error = await failure(vi.fn<typeof fetch>().mockRejectedValue(new Error(`connect failed ${API_KEY}`)));
    expect(error.kind).toBe("network");
    expect(error.message).toBe("Vapi request failed");
    expect(error.message).not.toContain(API_KEY);
    expect(error.cause).toBeUndefined();
  });

  it("rejects an oversized declared body", async () => {
    const response = new Response("{}", { headers: { "content-length": "30000000" } });
    const error = await failure(vi.fn<typeof fetch>().mockResolvedValue(response));
    expect(error.kind).toBe("size");
  });

  it("rejects an oversized actual body", async () => {
    const response = new Response(JSON.stringify({ pad: "x".repeat(20_000_001) }));
    const error = await failure(vi.fn<typeof fetch>().mockResolvedValue(response));
    expect(error.kind).toBe("size");
  });

  it("reports a body that cannot be read", async () => {
    const response = new Response("{}");
    vi.spyOn(response, "text").mockRejectedValue(new Error("stream error"));
    const error = await failure(vi.fn<typeof fetch>().mockResolvedValue(response));
    expect(error.kind).toBe("network");
    expect(error.message).toBe("Vapi response could not be read");
  });

  it("aborts after the timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const slow = createVapiSource({ apiKey: API_KEY, fetchImpl, timeoutMs: 20 });
    await expect(slow.check(CALL_ID)).rejects.toMatchObject({ kind: "network" });
  });

  it("uses the global fetch when none is injected", async () => {
    const original = globalThis.fetch;
    const stub = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(ENDED));
    globalThis.fetch = stub;
    try {
      const result = await createVapiSource({ apiKey: API_KEY }).check(CALL_ID);
      expect(result.complete).toBe(true);
      expect(stub).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("isEmptyValue", () => {
  it.each([
    [undefined, true],
    [null, true],
    ["", true],
    ["  \n", true],
    [[], true],
    [{}, true],
    [[null, "", {}], true],
    [{ a: [{ b: "" }] }, true],
    ["x", false],
    [0, false],
    [false, false],
    [[0], false],
    [{ a: { b: 1 } }, false],
  ])("treats %j as empty=%s", (value, expected) => {
    expect(isEmptyValue(value)).toBe(expected);
  });
});
