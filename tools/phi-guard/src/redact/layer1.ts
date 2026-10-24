import type { Span, ValidatedContext } from "./internal.js";
import { NOT_WORD_AFTER, NOT_WORD_BEFORE, escapeRegExp } from "./internal.js";
import { WORDS_FOR_DIGIT } from "./words.js";

const NAME_PART_SEPARATOR = "[\\s.\\-]+";
const ID_SEPARATOR = "[\\s\\-.,]{0,3}";
const LETTER_SEPARATOR = "[\\s\\-.,]{1,3}";
const MIN_PART_LENGTH = 3;
const MIN_SPELLED_LENGTH = 3;

function wrap(pattern: string): RegExp {
  return new RegExp(`${NOT_WORD_BEFORE}(?:${pattern})${NOT_WORD_AFTER}`, "giu");
}

function collect(regex: RegExp, text: string, type: Span["type"], key: string): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(regex)) {
    if (match[0].length > 0) {
      spans.push({ start: match.index, end: match.index + match[0].length, type, key });
    }
  }
  return spans;
}

/** Regex source for one name, tolerant of spacing, hyphens, periods and apostrophe style. */
function nameSource(name: string): string {
  return name
    .replace(/\./g, " ")
    .split(/[\s-]+/)
    .filter((part) => part.length > 0)
    .map((part) => escapeRegExp(part).replace(/['\u2019]/g, "['\u2019]?"))
    .join(NAME_PART_SEPARATOR);
}

function nameParts(name: string): string[] {
  const parts = name
    .replace(/\./g, " ")
    .split(/[\s-]+/)
    .filter((part) => part.length >= MIN_PART_LENGTH);
  return parts.length > 1 ? parts : [];
}

function spelledSource(name: string): string | undefined {
  const letters = [...name.replace(/[^\p{L}]/gu, "")];
  if (letters.length < MIN_SPELLED_LENGTH) {
    return undefined;
  }
  return letters.map((letter) => escapeRegExp(letter)).join(LETTER_SEPARATOR);
}

export function findNames(text: string, ctx: ValidatedContext): Span[] {
  const { firstName, lastName } = ctx;
  const sources: string[] = [];
  for (const name of [firstName, lastName]) {
    if (name === undefined) {
      continue;
    }
    sources.push(nameSource(name));
    for (const part of nameParts(name)) {
      sources.push(nameSource(part));
    }
    const spelled = spelledSource(name);
    if (spelled !== undefined) {
      sources.push(spelled);
    }
  }
  if (firstName !== undefined && lastName !== undefined) {
    const first = nameSource(firstName);
    const last = nameSource(lastName);
    sources.push(`${first}[\\s,]+${last}`, `${last}[\\s,]+${first}`);
  }
  const spans: Span[] = [];
  for (const source of sources) {
    spans.push(...collect(wrap(source), text, "PATIENT_NAME", "name"));
  }
  return spans;
}

function characterSource(char: string): string {
  if (/[0-9]/.test(char)) {
    const words = WORDS_FOR_DIGIT[Number(char)] ?? char;
    return `(?:${char}|${words})`;
  }
  return char === "o" || char === "O" ? "(?:o|oh)" : escapeRegExp(char);
}

/**
 * Builds a pattern that matches an identifier written out, spoken digit by digit
 * with spaces, hyphens or commas between characters, spoken as digit words,
 * or with "double" before a repeated digit. "Oh" is accepted for zero.
 */
function identifierSource(value: string): string {
  const chars = [...value.replace(/[^A-Za-z0-9]/g, "")];
  const pieces: string[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] ?? "";
    const next = chars[i + 1];
    if (/[0-9]/.test(char) && next === char) {
      const single = characterSource(char);
      const words = WORDS_FOR_DIGIT[Number(char)] ?? char;
      pieces.push(`(?:${single}${ID_SEPARATOR}${single}|double[\\s-]+(?:${words}))`);
      i += 1;
    } else {
      pieces.push(characterSource(char));
    }
  }
  return pieces.join(ID_SEPARATOR);
}

export function findIdentifiers(text: string, ctx: ValidatedContext): Span[] {
  const spans: Span[] = [];
  if (ctx.memberId !== undefined) {
    spans.push(...collect(wrap(identifierSource(ctx.memberId)), text, "MEMBER_ID", "member"));
  }
  if (ctx.claimNumber !== undefined) {
    spans.push(...collect(wrap(identifierSource(ctx.claimNumber)), text, "CLAIM_NUMBER", "claim"));
  }
  return spans;
}
