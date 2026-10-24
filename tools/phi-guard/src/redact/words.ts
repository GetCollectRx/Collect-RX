/** Spoken-number and month vocabulary shared by the layer 1 and layer 2 matchers. */

export const DIGIT_WORD_VALUES: ReadonlyMap<string, number> = new Map([
  ["zero", 0],
  ["oh", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
]);

export const DIGIT_WORD_ALTERNATION = "zero|oh|one|two|three|four|five|six|seven|eight|nine";

/** Spoken words for each digit, used when building identifier patterns. */
export const WORDS_FOR_DIGIT: readonly string[] = [
  "zero|oh",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];

const CARDINAL_UNITS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const CARDINAL_TEENS = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const CARDINAL_TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINAL_UNITS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
];
const ORDINAL_TEENS = [
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
];

const WORD_NUMBER_VALUES: ReadonlyMap<string, number> = new Map<string, number>([
  ...CARDINAL_UNITS.map((w, i): [string, number] => [w, i + 1]),
  ...CARDINAL_TEENS.map((w, i): [string, number] => [w, i + 10]),
  ...CARDINAL_TENS.map((w, i): [string, number] => [w, (i + 2) * 10]),
  ...ORDINAL_UNITS.map((w, i): [string, number] => [w, i + 1]),
  ...ORDINAL_TEENS.map((w, i): [string, number] => [w, i + 10]),
  ["twentieth", 20],
  ["thirtieth", 30],
]);

const SEP = "[\\s-]+";

/** Day of month spoken as a cardinal or ordinal word, 1 to 31. */
export const DAY_WORDS_PATTERN =
  `(?:(?:twenty|thirty)${SEP}(?:${ORDINAL_UNITS.join("|")}|${CARDINAL_UNITS.join("|")})` +
  `|${ORDINAL_TEENS.join("|")}|twentieth|thirtieth|${ORDINAL_UNITS.join("|")}` +
  `|${CARDINAL_TEENS.join("|")}|twenty|thirty|${CARDINAL_UNITS.join("|")})`;

const YEAR_UNIT = CARDINAL_UNITS.join("|");
const YEAR_TEEN = CARDINAL_TEENS.join("|");
const YEAR_TENS = CARDINAL_TENS.join("|");

/** Years spoken as "nineteen eighty five", "twenty oh five", "two thousand and five". */
export const YEAR_WORDS_PATTERN =
  `(?:(?:eighteen|nineteen|twenty)${SEP}(?:hundred|oh${SEP}(?:${YEAR_UNIT})` +
  `|(?:${YEAR_TENS})(?:${SEP}(?:${YEAR_UNIT}))?|(?:${YEAR_TEEN}))` +
  `|two${SEP}thousand(?:${SEP}and)?(?:${SEP}(?:(?:${YEAR_TENS})(?:${SEP}(?:${YEAR_UNIT}))?|${YEAR_TEEN}|${YEAR_UNIT}))?)`;

export const MONTH_PATTERN =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const MONTH_PREFIXES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function monthNumber(name: string): number {
  return MONTH_PREFIXES.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((w) => w.length > 0);
}

/** Parses a number of 1 to 99 spoken as one or two words; returns undefined when unrecognised. */
function parseUnderHundred(parts: readonly string[]): number | undefined {
  if (parts.length === 1) {
    return WORD_NUMBER_VALUES.get(parts[0] ?? "");
  }
  if (parts.length === 2) {
    const tens = WORD_NUMBER_VALUES.get(parts[0] ?? "");
    const unit = WORD_NUMBER_VALUES.get(parts[1] ?? "");
    if (tens !== undefined && tens >= 20 && unit !== undefined && unit < 10) {
      return tens + unit;
    }
  }
  return undefined;
}

export function parseDayWords(value: string): number | undefined {
  return parseUnderHundred(words(value));
}

export function parseYearWords(value: string): number | undefined {
  const parts = words(value).filter((w) => w !== "and");
  const head = parts[0];
  if (head === "two" && parts[1] === "thousand") {
    const rest = parts.slice(2);
    if (rest.length === 0) {
      return 2000;
    }
    const tail = parseUnderHundred(rest);
    return tail === undefined ? undefined : 2000 + tail;
  }
  const century = head === "eighteen" ? 18 : head === "nineteen" ? 19 : head === "twenty" ? 20 : undefined;
  if (century === undefined) {
    return undefined;
  }
  const rest = parts.slice(1);
  if (rest.length === 1 && rest[0] === "hundred") {
    return century * 100;
  }
  if (rest[0] === "oh" && rest.length === 2) {
    const unit = WORD_NUMBER_VALUES.get(rest[1] ?? "");
    return unit === undefined ? undefined : century * 100 + unit;
  }
  const tail = parseUnderHundred(rest);
  return tail === undefined ? undefined : century * 100 + tail;
}
