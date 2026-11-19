import type { Span, Ymd } from "./internal.js";
import { NOT_WORD_AFTER, NOT_WORD_BEFORE } from "./internal.js";
import {
  DAY_WORDS_PATTERN,
  MONTH_PATTERN,
  YEAR_WORDS_PATTERN,
  monthNumber,
  parseDayWords,
  parseYearWords,
} from "./words.js";

interface Reading extends Ymd {
  twoDigitYear: boolean;
}

const MIN_YEAR = 1800;
const MAX_YEAR = 2199;

const DAY = `(?:\\d{1,2}(?:st|nd|rd|th)?|${DAY_WORDS_PATTERN})`;
const YEAR = `(?:\\d{4}|${YEAR_WORDS_PATTERN})`;

const ISO_NUMERIC = String.raw`(?<!\d)(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?!\d)`;
const PARTS_NUMERIC = String.raw`(?<!\d)(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})(?!\d)`;
const MONTH_FIRST =
  `${NOT_WORD_BEFORE}(?<month>${MONTH_PATTERN})\\.?[\\s,-]+(?:the\\s+)?(?<day>${DAY})[\\s,-]+(?<year>${YEAR})${NOT_WORD_AFTER}`;
const DAY_FIRST =
  `${NOT_WORD_BEFORE}(?:the\\s+)?(?<day>${DAY})[\\s-]+(?:of\\s+)?(?<month>${MONTH_PATTERN})\\.?[\\s,-]+(?<year>${YEAR})${NOT_WORD_AFTER}`;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function plausible(reading: Reading): boolean {
  return (
    reading.m >= 1 &&
    reading.m <= 12 &&
    reading.d >= 1 &&
    reading.d <= 31 &&
    reading.y >= MIN_YEAR &&
    reading.y <= MAX_YEAR
  );
}

function matchesDob(reading: Reading, dob: Ymd): boolean {
  const yearMatches = reading.twoDigitYear ? reading.y % 100 === dob.y % 100 : reading.y === dob.y;
  return yearMatches && reading.m === dob.m && reading.d === dob.d;
}

function isoKey(reading: Reading): string {
  return `${pad(reading.y, 4)}-${pad(reading.m, 2)}-${pad(reading.d, 2)}`;
}

/**
 * Turns the possible readings of one matched date into a span. A date that
 * matches the date of birth under any reading is a DOB, otherwise a DATE.
 */
function toSpan(
  start: number,
  end: number,
  candidates: readonly Reading[],
  ambiguousKey: string,
  dob: Ymd | undefined,
): Span[] {
  const readings = candidates.filter(plausible);
  if (readings.length === 0) {
    return [];
  }
  if (dob !== undefined && readings.some((reading) => matchesDob(reading, dob))) {
    return [{ start, end, type: "DOB", key: "dob" }];
  }
  const first = readings[0];
  const key = readings.length === 1 && first !== undefined ? isoKey(first) : ambiguousKey;
  return [{ start, end, type: "DATE", key }];
}

function toNumber(value: string, parseWords: (words: string) => number | undefined): number {
  return /^\d/.test(value) ? Number.parseInt(value, 10) : (parseWords(value) ?? Number.NaN);
}

function findNumericDates(text: string, dob: Ymd | undefined): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(new RegExp(ISO_NUMERIC, "gu"))) {
    const reading: Reading = {
      y: Number(match[1]),
      m: Number(match[3]),
      d: Number(match[4]),
      twoDigitYear: false,
    };
    spans.push(...toSpan(match.index, match.index + match[0].length, [reading], "", dob));
  }
  for (const match of text.matchAll(new RegExp(PARTS_NUMERIC, "gu"))) {
    const first = Number(match[1]);
    const second = Number(match[3]);
    const yearText = match[4] ?? "";
    const twoDigitYear = yearText.length === 2;
    const year = twoDigitYear ? (Number(yearText) <= 49 ? 2000 : 1900) + Number(yearText) : Number(yearText);
    const readings: Reading[] = [
      { y: year, m: first, d: second, twoDigitYear },
      { y: year, m: second, d: first, twoDigitYear },
    ];
    const ambiguousKey = `ambiguous-${pad(first, 2)}-${pad(second, 2)}-${pad(year, 4)}`;
    spans.push(...toSpan(match.index, match.index + match[0].length, readings, ambiguousKey, dob));
  }
  return spans;
}

function findWrittenDates(text: string, dob: Ymd | undefined): Span[] {
  const spans: Span[] = [];
  for (const source of [MONTH_FIRST, DAY_FIRST]) {
    for (const match of text.matchAll(new RegExp(source, "giu"))) {
      const groups = match.groups;
      if (groups === undefined) {
        continue;
      }
      const reading: Reading = {
        y: toNumber(groups["year"] ?? "", parseYearWords),
        m: monthNumber(groups["month"] ?? ""),
        d: toNumber(groups["day"] ?? "", parseDayWords),
        twoDigitYear: false,
      };
      spans.push(...toSpan(match.index, match.index + match[0].length, [reading], "", dob));
    }
  }
  return spans;
}

/** Compact numeric forms of the date of birth: YYYYMMDD, MMDDYYYY, DDMMYYYY. */
function findCompactDob(text: string, dob: Ymd | undefined): Span[] {
  if (dob === undefined) {
    return [];
  }
  const year = pad(dob.y, 4);
  const month = pad(dob.m, 2);
  const day = pad(dob.d, 2);
  const forms = new Set([`${year}${month}${day}`, `${month}${day}${year}`, `${day}${month}${year}`]);
  const spans: Span[] = [];
  for (const match of text.matchAll(/(?<!\d)\d{8}(?!\d)/gu)) {
    if (forms.has(match[0])) {
      spans.push({ start: match.index, end: match.index + match[0].length, type: "DOB", key: "dob" });
    }
  }
  return spans;
}

export function findDates(text: string, dob: Ymd | undefined): Span[] {
  return [...findNumericDates(text, dob), ...findWrittenDates(text, dob), ...findCompactDob(text, dob)];
}
