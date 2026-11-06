import { SYNTHETIC_HEADERS } from "./generate.js";
import type { SyntheticClaim } from "./generate.js";

function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(claims: readonly SyntheticClaim[]): string {
  const lines = [SYNTHETIC_HEADERS.join(",")];
  for (const claim of claims) {
    lines.push(SYNTHETIC_HEADERS.map((header) => field(claim[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}
