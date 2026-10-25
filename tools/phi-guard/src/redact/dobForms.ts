import type { Span, Ymd } from "./internal.js";
import { NOT_WORD_AFTER, NOT_WORD_BEFORE } from "./internal.js";
import { WORDS_FOR_DIGIT, cardinalWord, monthNames, ordinalWord, yearWordVariants } from "./words.js";

/**
 * Spoken and spaced numeric forms of the date of birth that the generic date
 * finder cannot recognise, because they have no month name or punctuation:
 * "oh three oh four nineteen eighty five", "three four eighty five",
 * "zero three zero four one nine eight five" and their day-first and
 * year-first variants. They are built from the known date of birth, so a
 * different date never matches.
 */

const WORD_SEPARATOR = "[\\s-]+";
const DIGIT_JOIN = "[\\s-]*";
const PART_SEPARATOR = "[\\s,./-]+";

function digit(d: number): string {
  return `(?:${String(d)}|${WORDS_FOR_DIGIT[d] ?? ""})`;
}

function digitwise(value: string): string {
  return [...value].map((char) => digit(Number(char))).join(DIGIT_JOIN);
}

function phrase(words: string): string {
  return words.split(" ").join(WORD_SEPARATOR);
}

function alternation(parts: readonly string[]): string {
  return `(?:${parts.join("|")})`;
}

/** Month or day: "4", "04", "oh four", "zero four", "four", "twenty four", "two four". */
function dayOrMonth(n: number): string {
  if (n < 10) {
    return `(?:(?:zero|oh|0)${DIGIT_JOIN})?${digit(n)}`;
  }
  return alternation([digitwise(String(n)), phrase(cardinalWord(n))]);
}

function fullYear(year: number): string {
  return alternation([digitwise(String(year)), ...yearWordVariants(year).map(phrase)]);
}

function shortYear(year: number): string {
  const rest = year % 100;
  const parts = [digitwise(String(rest).padStart(2, "0"))];
  if (rest >= 10) {
    parts.push(phrase(cardinalWord(rest)));
  }
  return alternation(parts);
}

function dayWithSuffix(day: number): string {
  const suffixed = `${String(day)}(?:st|nd|rd|th)`;
  return alternation([dayOrMonth(day), suffixed, phrase(ordinalWord(day))]);
}

export function findSpokenDob(text: string, dob: Ymd | undefined): Span[] {
  if (dob === undefined) {
    return [];
  }
  const month = dayOrMonth(dob.m);
  const day = dayOrMonth(dob.d);
  const year = alternation([fullYear(dob.y), shortYear(dob.y)]);
  const names = alternation(monthNames(dob.m)) + "\\.?";
  const namedDay = dayWithSuffix(dob.d);
  const forms = [
    `${month}${PART_SEPARATOR}${day}${PART_SEPARATOR}${year}`,
    `${day}${PART_SEPARATOR}${month}${PART_SEPARATOR}${year}`,
    `${fullYear(dob.y)}${PART_SEPARATOR}${month}${PART_SEPARATOR}${day}`,
    `${names}${PART_SEPARATOR}(?:the${PART_SEPARATOR})?${namedDay}${PART_SEPARATOR}${year}`,
    `(?:the${PART_SEPARATOR})?${namedDay}${PART_SEPARATOR}(?:of${PART_SEPARATOR})?${names}${PART_SEPARATOR}${year}`,
  ];
  const spans: Span[] = [];
  for (const form of forms) {
    const regex = new RegExp(`${NOT_WORD_BEFORE}${form}${NOT_WORD_AFTER}`, "giu");
    for (const match of text.matchAll(regex)) {
      spans.push({ start: match.index, end: match.index + match[0].length, type: "DOB", key: "dob" });
    }
  }
  return spans;
}
