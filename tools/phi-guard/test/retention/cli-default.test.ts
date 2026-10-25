import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));
vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: class {
    getContainerClient() {
      return {
        listBlobsFlat: () =>
          (async function* () {
            await Promise.resolve();
            yield { name: "calls/123e4567-e89b-42d3-a456-426614174000/transcript.json" };
          })(),
      };
    }
  },
}));

import { run } from "../../src/retention/cli.js";

const CALL_ID = "123e4567-e89b-42d3-a456-426614174000";
const ENV = { VAPI_API_KEY: "test-key-not-a-real-credential", AZURE_STORAGE_ACCOUNT: "synthaccount01" };
const ARGS = ["--call-id", CALL_ID, "--container", "call-artifacts", "--prefix", "calls/"];

afterEach(() => {
  vi.unstubAllGlobals();
});

function io() {
  const out: string[] = [];
  return { out, io: { out: (l: string) => out.push(l), err: (l: string) => out.push(l) } };
}

describe("default wiring", () => {
  it("runs the real Vapi source over a stubbed fetch and the mocked Azure SDK", async () => {
    const stub = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: CALL_ID, status: "ended", artifact: { transcript: "" } })),
    );
    vi.stubGlobal("fetch", stub);
    const h = io();
    expect(await run(ARGS, ENV, h.io)).toBe(0);
    expect(stub).toHaveBeenCalledOnce();
    expect(stub.mock.calls[0]?.[0]).toBe(`https://api.vapi.ai/call/${CALL_ID}`);
    expect(h.out).toContain("overall: PASS");
  });

  it("exits 1 when the stubbed Vapi response still holds a transcript", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ status: "ended", artifact: { transcript: "hello" } })),
      ),
    );
    const h = io();
    expect(await run(ARGS, ENV, h.io)).toBe(1);
    expect(h.out).toContain("  PRESENT artifact.transcript");
    expect(h.out.join("\n")).not.toContain("hello");
  });

  it("exits 1 on a Vapi HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 500 })));
    const h = io();
    expect(await run(ARGS, ENV, h.io)).toBe(1);
    expect(h.out).toContain("vapi result: FAIL (Vapi returned HTTP 500)");
  });
});
