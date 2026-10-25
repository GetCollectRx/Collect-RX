import { beforeEach, describe, expect, it, vi } from "vitest";

interface State {
  endpoint: string;
  credential: unknown;
  container: string;
  prefix: string | undefined;
  blobs: string[];
  failure: unknown;
  downloads: number;
}

const state = vi.hoisted(
  (): State => ({
    endpoint: "",
    credential: undefined,
    container: "",
    prefix: undefined,
    blobs: [],
    failure: undefined,
    downloads: 0,
  }),
);

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class {
    readonly kind = "default-azure-credential";
  },
}));

vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: class {
    constructor(endpoint: string, credential: unknown) {
      state.endpoint = endpoint;
      state.credential = credential;
    }
    getContainerClient(name: string) {
      state.container = name;
      return {
        listBlobsFlat: (options: { prefix?: string }) => {
          state.prefix = options.prefix;
          return (async function* () {
            await Promise.resolve();
            if (state.failure !== undefined) {
              // A test double: the SDK can reject with values that are not Error objects.
              throw state.failure as Error;
            }
            for (const name of state.blobs) {
              yield { name };
            }
          })();
        },
        getBlobClient: () => {
          state.downloads += 1;
          return {};
        },
      };
    }
  },
}));

import { listMatchingBlobs } from "../../src/retention/azure.js";
import { RetentionError } from "../../src/retention/types.js";

const CALL_ID = "123e4567-e89b-42d3-a456-426614174000";
const query = { account: "synthaccount01", container: "call-artifacts", prefix: "calls/", callId: CALL_ID };

beforeEach(() => {
  state.blobs = [];
  state.failure = undefined;
  state.downloads = 0;
});

describe("listMatchingBlobs", () => {
  it("lists under the prefix and keeps only names containing the call id", async () => {
    state.blobs = [
      `calls/${CALL_ID}/transcript.json`,
      "calls/other-call/transcript.json",
      `calls/${CALL_ID.toUpperCase()}/summary.json`,
      `calls/x-${CALL_ID}.txt`,
    ];
    const names = await listMatchingBlobs(query);
    expect(names).toEqual([
      `calls/${CALL_ID}/transcript.json`,
      `calls/${CALL_ID.toUpperCase()}/summary.json`,
      `calls/x-${CALL_ID}.txt`,
    ]);
    expect(state.prefix).toBe("calls/");
    expect(state.container).toBe("call-artifacts");
  });

  it("uses the account endpoint and DefaultAzureCredential only", async () => {
    await listMatchingBlobs(query);
    expect(state.endpoint).toBe("https://synthaccount01.blob.core.windows.net");
    expect(state.credential).toMatchObject({ kind: "default-azure-credential" });
  });

  it("returns an empty list when nothing matches", async () => {
    state.blobs = ["calls/unrelated.json"];
    expect(await listMatchingBlobs(query)).toEqual([]);
  });

  it("never downloads blob contents", async () => {
    state.blobs = [`calls/${CALL_ID}/a.json`];
    await listMatchingBlobs(query);
    expect(state.downloads).toBe(0);
  });

  it("caps the number of names it keeps", async () => {
    state.blobs = Array.from({ length: 1200 }, (_, i) => `calls/${CALL_ID}/${String(i)}.json`);
    expect(await listMatchingBlobs(query)).toHaveLength(1000);
  });

  it("reports the error class and HTTP status only", async () => {
    const failure = Object.assign(new Error(`secret account detail ${CALL_ID}`), {
      name: "RestError",
      statusCode: 403,
    });
    state.failure = failure;
    const error = await listMatchingBlobs(query).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetentionError);
    expect((error as RetentionError).kind).toBe("azure");
    expect((error as RetentionError).message).toBe("Azure listing failed: RestError (HTTP 403)");
    expect((error as RetentionError).cause).toBeUndefined();
  });

  it("copes with errors that are not Error objects", async () => {
    state.failure = "boom with synthaccount01";
    const error = await listMatchingBlobs(query).catch((e: unknown) => e);
    expect((error as RetentionError).message).toBe("Azure listing failed: UnknownError");
  });

  it("omits the status when the error has none", async () => {
    state.failure = new TypeError("bad");
    const error = await listMatchingBlobs(query).catch((e: unknown) => e);
    expect((error as RetentionError).message).toBe("Azure listing failed: TypeError");
  });
});
