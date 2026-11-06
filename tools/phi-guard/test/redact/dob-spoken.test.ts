import { describe, expect, it } from "vitest";
import { redact } from "../../src/redact/index.js";
import { cardinalWord, monthNames, ordinalWord, parseYearWords, yearWordVariants } from "../../src/redact/words.js";

// The date of birth below is invented.
const DOB_1985 = { dateOfBirth: "1985-03-04" };
const DOB_2005 = { dateOfBirth: "2005-12-25" };
const DOB_1900 = { dateOfBirth: "1900-01-31" };
const DOB_2000 = { dateOfBirth: "2000-10-20" };

describe("spoken numeric forms of the date of birth", () => {
  const march4th1985 = [
    "oh three oh four nineteen eighty five",
    "zero three zero four one nine eight five",
    "oh three oh four one nine eight five",
    "zero three zero four nineteen eighty-five",
    "three four eighty five",
    "three four nineteen eighty five",
    "three oh four eighty five",
    "oh three four eighty five",
    "zero three four eight five",
    "three, four, eighty five",
    "3 4 85",
    "03 04 1985",
    "0 3 0 4 1 9 8 5",
    "oh four oh three nineteen eighty five",
    "four three eighty five",
    "four three nineteen eighty five",
    "zero four zero three one nine eight five",
    "nineteen eighty five oh three oh four",
    "one nine eight five zero three zero four",
    "march four eighty five",
    "march fourth eighty five",
    "march 4th 85",
    "the fourth of march eighty five",
    "4 mar eighty five",
  ];
  it.each(march4th1985)("redacts %j as the date of birth", (form) => {
    const result = redact(`my birthday is ${form} okay`, DOB_1985);
    expect(result.redacted).toBe("my birthday is [[DOB_1]] okay");
    expect(result.findings).toEqual([{ token: "[[DOB_1]]", type: "DOB" }]);
  });

  it("does not need any other identifier in the context", () => {
    expect(redact("three four eighty five", DOB_1985).redacted).toBe("[[DOB_1]]");
  });

  const otherDates: ReadonlyArray<[string, string, { dateOfBirth: string }]> = [
    ["two digit month and day, words", "twelve twenty five two thousand five", DOB_2005],
    ["digit by digit month and day", "one two two five two thousand and five", DOB_2005],
    ["day first with twenty oh five", "twenty five twelve twenty oh five", DOB_2005],
    ["short year with oh", "twelve twenty five oh five", DOB_2005],
    ["numerals", "12 25 05", DOB_2005],
    ["year first", "two thousand five twelve twenty five", DOB_2005],
    ["nineteen hundred", "oh one thirty one nineteen hundred", DOB_1900],
    ["thirty first", "january thirty first nineteen hundred", DOB_1900],
    ["two thousand", "ten twenty two thousand", DOB_2000],
    ["twentieth", "october twentieth two thousand", DOB_2000],
  ];
  it.each(otherDates)("handles %s", (_label, form, context) => {
    expect(redact(`born ${form} ok`, context).redacted).toBe("born [[DOB_1]] ok");
  });

  const notTheDateOfBirth = [
    "three five eighty five",
    "three four eighty six",
    "four four eighty five",
    "oh three oh five nineteen eighty five",
    "march five eighty five",
    "press three then four",
    "three four",
    "eighty five",
  ];
  it.each(notTheDateOfBirth)("leaves %j alone", (form) => {
    expect(redact(form, DOB_1985).redacted).toBe(form);
  });

  it("does nothing without a date of birth", () => {
    expect(redact("three four eighty five", {}).redacted).toBe("three four eighty five");
  });

  it("does not match inside longer numbers", () => {
    expect(redact("1 3 4 85 7", DOB_1985).redacted).not.toContain("[[DOB_1]] 7");
    expect(redact("a3 4 85", DOB_1985).redacted).toBe("a3 4 85");
  });
});

describe("number word helpers", () => {
  it("round-trips every year variant through the year parser", () => {
    for (let year = 1800; year <= 2099; year += 1) {
      const variants = yearWordVariants(year);
      expect(variants.length).toBeGreaterThan(0);
      for (const variant of variants) {
        expect(parseYearWords(variant)).toBe(year);
      }
    }
  });

  it("spells cardinals and ordinals", () => {
    expect(cardinalWord(4)).toBe("four");
    expect(cardinalWord(13)).toBe("thirteen");
    expect(cardinalWord(40)).toBe("forty");
    expect(cardinalWord(85)).toBe("eighty five");
    expect(ordinalWord(4)).toBe("fourth");
    expect(ordinalWord(12)).toBe("twelfth");
    expect(ordinalWord(20)).toBe("twentieth");
    expect(ordinalWord(21)).toBe("twenty first");
    expect(ordinalWord(30)).toBe("thirtieth");
    expect(ordinalWord(31)).toBe("thirty first");
  });

  it("lists month names", () => {
    expect(monthNames(3)).toEqual(["march", "mar"]);
    expect(monthNames(9)).toEqual(["september", "sep", "sept"]);
  });
});
