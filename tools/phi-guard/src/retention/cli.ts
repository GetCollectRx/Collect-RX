import { listMatchingBlobs } from "./azure.js";
import type { BlobLister } from "./azure.js";
import { parseArgs, parseEnv } from "./validate.js";
import type { InputProblem } from "./validate.js";
import { createVapiSource } from "./vapi.js";
import { RetentionError } from "./types.js";
import type { RetentionSource } from "./types.js";

export const USAGE = "usage: retention-check --call-id <id> --container <name> --prefix <blobPrefix>";

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_INPUT = 2;
const MAX_NAMES_SHOWN = 50;

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface CliDeps {
  createSource: (apiKey: string) => RetentionSource;
  listBlobs: BlobLister;
}

const defaultDeps: CliDeps = {
  createSource: (apiKey) => createVapiSource({ apiKey }),
  listBlobs: listMatchingBlobs,
};

const MESSAGES: Readonly<Record<InputProblem, string>> = {
  usage: USAGE,
  "call-id": "invalid --call-id: expected a UUID",
  container: "invalid --container: expected an Azure container name",
  prefix: "invalid --prefix: expected 1 to 200 of letters, digits, . _ - /",
  VAPI_API_KEY: "VAPI_API_KEY is missing or malformed",
  AZURE_STORAGE_ACCOUNT: "AZURE_STORAGE_ACCOUNT is missing or malformed",
};

function printable(name: string): string {
  return name.replace(/[^\x20-\x7E]/gu, "?");
}

function failureLabel(error: unknown): string {
  return error instanceof RetentionError ? error.message : "unexpected error";
}

/** Returns the exit code: 0 clean and archived, 1 a check failed, 2 bad input or configuration. */
export async function run(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: CliIo,
  deps: CliDeps = defaultDeps,
): Promise<number> {
  const args = parseArgs(argv);
  if (!args.ok) {
    io.err(MESSAGES[args.problem]);
    return EXIT_INPUT;
  }
  const config = parseEnv(env);
  if (!config.ok) {
    io.err(MESSAGES[config.problem]);
    return EXIT_INPUT;
  }
  const { callId, container, prefix } = args.value;

  let vapiPass = false;
  const source = deps.createSource(config.value.apiKey);
  io.out(`${source.name}: call ${callId}`);
  try {
    const result = await source.check(callId);
    io.out(`  ${result.detail}`);
    for (const field of result.fields) {
      io.out(`  ${field.present ? "PRESENT" : "absent "} ${field.field}`);
    }
    const present = result.fields.filter((field) => field.present).length;
    if (!result.complete) {
      io.out(`${source.name} result: FAIL (call has not ended, so absence is not proof)`);
    } else if (present > 0) {
      io.out(`${source.name} result: FAIL (${String(present)} content field(s) present)`);
    } else {
      io.out(`${source.name} result: PASS (no content fields present)`);
      vapiPass = true;
    }
  } catch (error) {
    io.out(`${source.name} result: FAIL (${failureLabel(error)})`);
  }

  let azurePass = false;
  io.out(`azure: container ${container}, prefix ${prefix}`);
  try {
    const names = await deps.listBlobs({ account: config.value.account, container, prefix, callId });
    io.out(`  matching blobs: ${String(names.length)}`);
    for (const name of names.slice(0, MAX_NAMES_SHOWN)) {
      io.out(`  - ${printable(name)}`);
    }
    if (names.length > MAX_NAMES_SHOWN) {
      io.out(`  (${String(names.length - MAX_NAMES_SHOWN)} more not shown)`);
    }
    if (names.length > 0) {
      io.out("azure result: PASS");
      azurePass = true;
    } else {
      io.out("azure result: FAIL (no matching blobs)");
    }
  } catch (error) {
    io.out(`azure result: FAIL (${failureLabel(error)})`);
  }

  const pass = vapiPass && azurePass;
  io.out(`overall: ${pass ? "PASS" : "FAIL"}`);
  return pass ? EXIT_PASS : EXIT_FAIL;
}
