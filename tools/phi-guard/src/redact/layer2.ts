import type { Span } from "./internal.js";
import { NOT_WORD_AFTER, NOT_WORD_BEFORE } from "./internal.js";
import { DIGIT_WORD_ALTERNATION, DIGIT_WORD_VALUES } from "./words.js";

const MIN_DIGIT_SEQUENCE = 6;

const EMAIL = String.raw`(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}`;
const PHONE = String.raw`(?<![\p{L}\p{N}])(?:\+?1[\s.-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[\s.-]?[2-9]\d{2}[\s.-]?\d{4}(?!\d)`;
const HEALTH_NUMBER = String.raw`(?<!\d)\d{4}[\s-]?\d{3}[\s-]?\d{3}(?:[A-Za-z]{2}(?![A-Za-z])|[\s-][A-Z]{2}(?![A-Za-z]))?(?!\d)`;
const CURRENCY = String.raw`\$\s?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?(?!\d)`;

const SPOKEN_DIGIT = `${NOT_WORD_BEFORE}(?:(?:double|triple)[\\s-]+)?(?:${DIGIT_WORD_ALTERNATION})${NOT_WORD_AFTER}`;
const UNIT = `(?:${SPOKEN_DIGIT}|\\d+)`;
const SEPARATOR = "(?:[\\s\\u2010-\\u2015/-]+|[,.]\\s+)";
const DIGIT_RUN = `${UNIT}(?:${SEPARATOR}${UNIT})*`;

function collect(source: string, flags: string, text: string, type: Span["type"], keyOf: (m: string) => string): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(new RegExp(source, flags))) {
    spans.push({ start: match.index, end: match.index + match[0].length, type, key: keyOf(match[0]) });
  }
  return spans;
}

const digitsOnly = (value: string): string => value.replace(/\D/g, "");

export function findEmails(text: string): Span[] {
  return collect(EMAIL, "giu", text, "EMAIL", (m) => m.toLowerCase());
}

export function findPhones(text: string): Span[] {
  const spans = collect(PHONE, "gu", text, "PHONE", digitsOnly);
  // Ten bare digits are the Ontario health number shape, not a formatted phone number.
  return spans.filter((span) => !/^\d{10}$/.test(text.slice(span.start, span.end)));
}

export function findHealthNumbers(text: string): Span[] {
  return collect(HEALTH_NUMBER, "gu", text, "HEALTH_NUMBER", (m) => m.replace(/[^0-9A-Za-z]/g, "").toUpperCase());
}

/** Reduces a run to its digit string, so spoken and written forms of one value match. */
function canonicalDigits(run: string): string {
  let digits = "";
  for (const unit of run.matchAll(new RegExp(UNIT, "giu"))) {
    const token = unit[0].toLowerCase();
    const word = token.split(/[\s-]+/).pop() ?? "";
    const value = DIGIT_WORD_VALUES.get(word);
    if (value === undefined) {
      digits += token;
    } else {
      const repeat = token.startsWith("double") ? 2 : token.startsWith("triple") ? 3 : 1;
      digits += String(value).repeat(repeat);
    }
  }
  return digits;
}

/** Runs of six or more digits, written as numerals or spoken, broken by spaces or hyphens. */
export function findDigitSequences(text: string): Span[] {
  const currency = collect(CURRENCY, "gu", text, "DIGIT_SEQUENCE", () => "");
  const spans: Span[] = [];
  for (const match of text.matchAll(new RegExp(DIGIT_RUN, "giu"))) {
    const start = match.index;
    const end = start + match[0].length;
    const isCurrency = currency.some((c) => start >= c.start && end <= c.end);
    const digits = canonicalDigits(match[0]);
    if (!isCurrency && digits.length >= MIN_DIGIT_SEQUENCE) {
      spans.push({ start, end, type: "DIGIT_SEQUENCE", key: digits });
    }
  }
  return spans;
}
