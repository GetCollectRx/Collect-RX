export type InputProblem =
  | "usage"
  | "call-id"
  | "container"
  | "prefix"
  | "VAPI_API_KEY"
  | "AZURE_STORAGE_ACCOUNT";

export interface CliArgs {
  callId: string;
  container: string;
  prefix: string;
}

export interface CliEnv {
  apiKey: string;
  account: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: InputProblem };

// Vapi's reference types the call id only as a string. The one place its docs name
// a format is the Langfuse traceName text, which calls call.id a "Call UUID".
const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
// Azure container names: 3 to 63 lowercase letters, digits and single hyphens.
const CONTAINER = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,61}[a-z0-9]$/u;
const PREFIX = /^[A-Za-z0-9._\-/]{1,200}$/u;
const ACCOUNT = /^[a-z0-9]{3,24}$/u;
const API_KEY = /^[\x21-\x7E]{8,512}$/u;
const FLAGS: ReadonlySet<string> = new Set(["--call-id", "--container", "--prefix"]);

export function parseArgs(argv: readonly string[]): Parsed<CliArgs> {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || value === undefined || !FLAGS.has(flag) || values.has(flag)) {
      return { ok: false, problem: "usage" };
    }
    values.set(flag, value);
  }
  const callId = values.get("--call-id");
  const container = values.get("--container");
  const prefix = values.get("--prefix");
  if (callId === undefined || container === undefined || prefix === undefined) {
    return { ok: false, problem: "usage" };
  }
  if (!CALL_ID.test(callId)) {
    return { ok: false, problem: "call-id" };
  }
  if (!CONTAINER.test(container)) {
    return { ok: false, problem: "container" };
  }
  if (!PREFIX.test(prefix) || prefix.includes("..")) {
    return { ok: false, problem: "prefix" };
  }
  return { ok: true, value: { callId: callId.toLowerCase(), container, prefix } };
}

export function parseEnv(env: Readonly<Record<string, string | undefined>>): Parsed<CliEnv> {
  const apiKey = env["VAPI_API_KEY"];
  if (apiKey === undefined || !API_KEY.test(apiKey)) {
    return { ok: false, problem: "VAPI_API_KEY" };
  }
  const account = env["AZURE_STORAGE_ACCOUNT"];
  if (account === undefined || !ACCOUNT.test(account)) {
    return { ok: false, problem: "AZURE_STORAGE_ACCOUNT" };
  }
  return { ok: true, value: { apiKey, account } };
}
