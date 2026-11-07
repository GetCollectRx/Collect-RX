import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { toCsv } from "./csv.js";
import { MAX_COUNT, generateRecords } from "./generate.js";

export const USAGE = "usage: generate --count <n> --seed <s> --out <dir>";

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const SEED_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const COUNT_PATTERN = /^[1-9][0-9]{0,4}$/;
const FLAGS = new Set(["--count", "--seed", "--out"]);

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

interface Options {
  count: number;
  seed: string;
  out: string;
}

function parse(args: readonly string[]): Options | undefined {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === undefined || value === undefined || !FLAGS.has(flag) || values.has(flag)) {
      return undefined;
    }
    values.set(flag, value);
  }
  const count = values.get("--count");
  const seed = values.get("--seed");
  const out = values.get("--out");
  if (count === undefined || seed === undefined || out === undefined) {
    return undefined;
  }
  if (!COUNT_PATTERN.test(count) || Number(count) > MAX_COUNT) {
    return undefined;
  }
  if (!SEED_PATTERN.test(seed) || out.trim() === "" || out.includes("\0")) {
    return undefined;
  }
  return { count: Number(count), seed, out };
}

/** Runs the CLI and returns the exit code: 0 on success, 2 for bad arguments. */
export function run(argv: readonly string[], io: CliIo): number {
  const [command, ...rest] = argv;
  const options = command === "generate" ? parse(rest) : undefined;
  if (options === undefined) {
    io.err(USAGE);
    return EXIT_USAGE;
  }
  const records = generateRecords(options.count, options.seed);
  const dir = resolve(options.out);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "claims.csv"), toCsv(records.map((record) => record.claim)));
  for (const record of records) {
    // Claim numbers are generated from a fixed alphabet, so the file name is safe.
    writeFileSync(
      join(dir, `context-${record.context.claimNumber}.json`),
      `${JSON.stringify(record.context, null, 2)}\n`,
    );
  }
  io.out(`wrote ${String(records.length)} synthetic claims`);
  return EXIT_OK;
}
