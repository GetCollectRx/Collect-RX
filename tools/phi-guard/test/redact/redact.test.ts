import { describe, expect, it } from "vitest";
import { redact } from "../../src/redact/index.js";
import type { CallContext } from "../../src/redact/index.js";

// Every value below is invented. None belongs to a real person.
const CTX: CallContext = {
  patientFirstName: "Alma",
  patientLastName: "Quillfeather",
  dateOfBirth: "1985-03-04",
  memberId: "SYN-48271936",
  claimNumber: "SYN-CLM-905173",
};

interface Row {
  name: string;
  text: string;
  expected: string;
  context?: CallContext;
}

function runTable(rows: readonly Row[]): void {
  it.each(rows)("$name", ({ text, expected, context }) => {
    expect(redact(text, context ?? CTX).redacted).toBe(expected);
  });
}

describe("layer 1: patient name", () => {
  runTable([
    { name: "first name alone", text: "Is this Alma?", expected: "Is this [[PATIENT_NAME_1]]?" },
    { name: "last name alone", text: "Quillfeather is covered.", expected: "[[PATIENT_NAME_1]] is covered." },
    { name: "full name, first then last", text: "Alma Quillfeather called", expected: "[[PATIENT_NAME_1]] called" },
    { name: "full name, last then first", text: "Quillfeather Alma called", expected: "[[PATIENT_NAME_1]] called" },
    { name: "full name with comma", text: "Quillfeather, Alma", expected: "[[PATIENT_NAME_1]]" },
    { name: "case-insensitive", text: "ALMA and quillfeather", expected: "[[PATIENT_NAME_1]] and [[PATIENT_NAME_1]]" },
    { name: "possessive", text: "Alma's claim", expected: "[[PATIENT_NAME_1]]'s claim" },
    { name: "word boundary protects longer words", text: "Almanac Almas", expected: "Almanac Almas" },
    { name: "name spelled out letter by letter", text: "that is Q-U-I-L-L-F-E-A-T-H-E-R", expected: "that is [[PATIENT_NAME_1]]" },
    { name: "name spelled out with spaces", text: "A L M A", expected: "[[PATIENT_NAME_1]]" },
    { name: "short spelled name is not matched", text: "Jo", expected: "[[PATIENT_NAME_1]]", context: { patientFirstName: "Jo" } },
    {
      name: "hyphenated surname written with a space",
      text: "Smythe Jones and Smythe-Jones",
      expected: "[[PATIENT_NAME_1]] and [[PATIENT_NAME_1]]",
      context: { patientLastName: "Smythe-Jones" },
    },
    {
      name: "multi-word first name also matches each part",
      text: "Mary Ann or just Mary",
      expected: "[[PATIENT_NAME_1]] or just [[PATIENT_NAME_1]]",
      context: { patientFirstName: "Mary Ann" },
    },
    {
      name: "apostrophe is optional in the transcript",
      text: "OBrien and O'Brien and O\u2019Brien",
      expected: "[[PATIENT_NAME_1]] and [[PATIENT_NAME_1]] and [[PATIENT_NAME_1]]",
      context: { patientLastName: "O'Brien" },
    },
    {
      name: "period in a name is optional",
      text: "St John and St. John",
      expected: "[[PATIENT_NAME_1]] and [[PATIENT_NAME_1]]",
      context: { patientLastName: "St. John" },
    },
    {
      name: "accented name",
      text: "Jos\u00E9 spoke",
      expected: "[[PATIENT_NAME_1]] spoke",
      context: { patientFirstName: "Jos\u00E9" },
    },
    { name: "name absent from text", text: "Nothing to see", expected: "Nothing to see" },
  ]);
});

describe("layer 1: date of birth", () => {
  const forms = [
    "1985-03-04",
    "1985/03/04",
    "03/04/1985",
    "04/03/1985",
    "3/4/1985",
    "March 4 1985",
    "March 4th 1985",
    "March 4th, 1985",
    "Mar. 4, 1985",
    "4 March 1985",
    "4th of March 1985",
    "the fourth of march nineteen eighty five",
    "march fourth nineteen eighty five",
    "March fourth, nineteen eighty-five",
    "MARCH 4 1985",
    "20850304".replace("2085", "1985"),
    "03041985",
    "04031985",
    "03/04/85",
  ];
  it.each(forms)("recognises %s as the date of birth", (form) => {
    const result = redact(`born ${form} ok`, CTX);
    expect(result.redacted).toBe("born [[DOB_1]] ok");
    expect(result.findings).toEqual([{ token: "[[DOB_1]]", type: "DOB" }]);
  });

  it("uses one token for every form of the date of birth", () => {
    expect(redact("1985-03-04 then March 4 1985 then 03/04/1985", CTX).redacted).toBe(
      "[[DOB_1]] then [[DOB_1]] then [[DOB_1]]",
    );
  });

  it("matches the other day/month reading too", () => {
    const swapped: CallContext = { dateOfBirth: "1985-04-03" };
    expect(redact("03/04/1985", swapped).redacted).toBe("[[DOB_1]]");
    expect(redact("04/03/1985", swapped).redacted).toBe("[[DOB_1]]");
  });

  it("does not call a different date a date of birth", () => {
    expect(redact("born 1985-03-05", CTX).redacted).toBe("born [[DATE_1]]");
    expect(redact("born 03/05/85", CTX).redacted).toBe("born [[DATE_1]]");
  });
});

describe("layer 1: member id and claim number", () => {
  runTable([
    { name: "member id as written", text: "member SYN-48271936.", expected: "member [[MEMBER_ID_1]]." },
    { name: "member id lower case, no hyphen", text: "syn48271936", expected: "[[MEMBER_ID_1]]" },
    { name: "member id spoken with spaces", text: "S Y N 4 8 2 7 1 9 3 6", expected: "[[MEMBER_ID_1]]" },
    { name: "member id spoken with hyphens", text: "S-Y-N-4-8-2-7-1-9-3-6", expected: "[[MEMBER_ID_1]]" },
    { name: "member id grouped digits", text: "SYN 4827 1936", expected: "[[MEMBER_ID_1]]" },
    {
      name: "member id with digits as words",
      text: "S Y N four eight two seven one nine three six",
      expected: "[[MEMBER_ID_1]]",
    },
    { name: "claim number as written", text: "claim SYN-CLM-905173", expected: "claim [[CLAIM_NUMBER_1]]" },
    {
      name: "claim number with oh for zero",
      text: "SYN CLM nine oh five one seven three",
      expected: "[[CLAIM_NUMBER_1]]",
    },
    {
      name: "claim number with zero for zero",
      text: "SYN CLM nine zero five one seven three",
      expected: "[[CLAIM_NUMBER_1]]",
    },
    {
      name: "oh in a numeric id",
      text: "four oh four oh",
      expected: "[[MEMBER_ID_1]]",
      context: { memberId: "4040" },
    },
    {
      name: "double for a repeated digit",
      text: "A B double three four five six",
      expected: "[[MEMBER_ID_1]]",
      context: { memberId: "AB33456" },
    },
    {
      name: "letter o in an id may be said as oh",
      text: "oh k 1 2 3 4",
      expected: "[[MEMBER_ID_1]]",
      context: { memberId: "OK1234" },
    },
    { name: "id absent from text", text: "no ids here", expected: "no ids here" },
    {
      name: "repeated digits written out",
      text: "1 1 2 2 3 3",
      expected: "[[MEMBER_ID_1]]",
      context: { memberId: "112233" },
    },
  ]);
});

describe("layer 2: patterns not in the context", () => {
  runTable([
    { name: "digits of six or more", text: "number 123456 ok", expected: "number [[DIGIT_SEQUENCE_1]] ok", context: {} },
    { name: "seven digits with hyphen", text: "555-1234", expected: "[[DIGIT_SEQUENCE_1]]", context: {} },
    {
      name: "digits broken by spaces",
      text: "1 2 3 4 5 6",
      expected: "[[DIGIT_SEQUENCE_1]]",
      context: {},
    },
    {
      name: "digits spoken as words",
      text: "one two three four five six",
      expected: "[[DIGIT_SEQUENCE_1]]",
      context: {},
    },
    {
      name: "spoken digits with commas",
      text: "one, two, three, four, five, six.",
      expected: "[[DIGIT_SEQUENCE_1]].",
      context: {},
    },
    {
      name: "mixed numerals and words",
      text: "1 two 3 four 5 six",
      expected: "[[DIGIT_SEQUENCE_1]]",
      context: {},
    },
    {
      name: "double and triple",
      text: "double five triple two oh",
      expected: "[[DIGIT_SEQUENCE_1]]",
      context: {},
    },
    { name: "five digits is not enough", text: "12345", expected: "12345", context: {} },
    {
      name: "spoken and numeric forms of one value share a token",
      text: "123456 and one two three four five six",
      expected: "[[DIGIT_SEQUENCE_1]] and [[DIGIT_SEQUENCE_1]]",
      context: {},
    },
    { name: "different digit runs get different tokens", text: "123456 and 654321", expected: "[[DIGIT_SEQUENCE_1]] and [[DIGIT_SEQUENCE_2]]", context: {} },
    { name: "digits next to letters", text: "abc1234567x", expected: "abc[[DIGIT_SEQUENCE_1]]x", context: {} },
    { name: "email", text: "write to Foo.Bar+x@Example.test now", expected: "write to [[EMAIL_1]] now", context: {} },
    { name: "same email in another case", text: "a@b.test A@B.TEST", expected: "[[EMAIL_1]] [[EMAIL_1]]", context: {} },
    { name: "phone with hyphens", text: "519-555-1234", expected: "[[PHONE_1]]", context: {} },
    { name: "phone with brackets", text: "(416) 555-0199", expected: "[[PHONE_1]]", context: {} },
    { name: "phone with country code", text: "+1 905 555 0100", expected: "[[PHONE_1]]", context: {} },
    { name: "phone with dots", text: "1.905.555.0100", expected: "[[PHONE_1]]", context: {} },
    { name: "eleven plain digits", text: "19055550100", expected: "[[PHONE_1]]", context: {} },
    { name: "health number plain", text: "1234567890", expected: "[[HEALTH_NUMBER_1]]", context: {} },
    { name: "health number grouped with version code", text: "1234-567-890 AB", expected: "[[HEALTH_NUMBER_1]]", context: {} },
    { name: "health number attached version code", text: "1234567890xy", expected: "[[HEALTH_NUMBER_1]]", context: {} },
    {
      name: "lower case word after a health number is kept",
      text: "1234567890 is valid",
      expected: "[[HEALTH_NUMBER_1]] is valid",
      context: {},
    },
    { name: "three letters after digits are not a version code", text: "1234567890abc", expected: "[[HEALTH_NUMBER_1]]abc", context: {} },
    { name: "service date in ISO form", text: "seen 2024-01-15", expected: "seen [[DATE_1]]", context: {} },
    { name: "service date written", text: "seen June 12 2024", expected: "seen [[DATE_1]]", context: {} },
    { name: "service date spoken", text: "seen twelfth of june twenty twenty four", expected: "seen [[DATE_1]]", context: {} },
    { name: "service date with timestamp", text: "2024-01-15T10:30:00Z", expected: "[[DATE_1]]T10:30:00Z", context: {} },
    { name: "service date is a DATE not a DOB", text: "seen 2024-01-15", expected: "seen [[DATE_1]]" },
    {
      name: "different dates get different tokens",
      text: "2024-01-15 and 2024-01-16 and 2024-01-15",
      expected: "[[DATE_1]] and [[DATE_2]] and [[DATE_1]]",
      context: {},
    },
    {
      name: "one date written two ways shares a token",
      text: "June 12 2024 and 2024-06-12 and 12 June 2024",
      expected: "[[DATE_1]] and [[DATE_1]] and [[DATE_1]]",
      context: {},
    },
    {
      name: "ambiguous date with no date of birth is a DATE",
      text: "03/04/1985",
      expected: "[[DATE_1]]",
      context: {},
    },
    {
      name: "unambiguous day-first date",
      text: "13/04/2024 and 2024-04-13",
      expected: "[[DATE_1]] and [[DATE_1]]",
      context: {},
    },
    {
      name: "the two readings of an ambiguous date stay distinct",
      text: "03/04/2024 and 04/03/2024 and 03/04/2024",
      expected: "[[DATE_1]] and [[DATE_2]] and [[DATE_1]]",
      context: {},
    },
    { name: "two digit year", text: "seen 12/06/24", expected: "seen [[DATE_1]]", context: {} },
    { name: "two digit year in the 1900s", text: "seen 12/06/75", expected: "seen [[DATE_1]]", context: {} },
    {
      name: "spoken years",
      text: "June 1 two thousand five, June 1 two thousand and five, June 1 twenty oh five, June 1 nineteen hundred, June 1 nineteen ten, June 1 two thousand",
      expected: "[[DATE_1]], [[DATE_1]], [[DATE_1]], [[DATE_2]], [[DATE_3]], [[DATE_4]]",
      context: {},
    },
    {
      name: "spoken day words",
      text: "the twenty first of may 2024, may twenty-first 2024, thirty first of may 2024, May thirteenth 2024",
      expected: "[[DATE_1]], [[DATE_1]], [[DATE_2]], [[DATE_3]]",
      context: {},
    },
    {
      name: "month abbreviations",
      text: "Jan 5 2024, Sept 5 2024, Dec. 5 2024",
      expected: "[[DATE_1]], [[DATE_2]], [[DATE_3]]",
      context: {},
    },
    { name: "impossible numeric date falls back to the digit rule", text: "31/31/2024", expected: "[[DIGIT_SEQUENCE_1]]", context: {} },
    { name: "impossible written date falls back to the digit rule", text: "May 45 2024", expected: "May [[DIGIT_SEQUENCE_1]]", context: {} },
    { name: "year out of range falls back to the digit rule", text: "12/06/0099", expected: "[[DIGIT_SEQUENCE_1]]", context: {} },
  ]);
});

describe("must not redact", () => {
  const rows: readonly Row[] = [
    { name: "press 1", text: "Please press 1 to continue.", expected: "Please press 1 to continue." },
    { name: "option 2", text: "Choose option 2 for claims.", expected: "Choose option 2 for claims." },
    { name: "press star", text: "Press star to go back.", expected: "Press star to go back." },
    { name: "press pound then digit", text: "Press 1, then press 2, then press 3.", expected: "Press 1, then press 2, then press 3." },
    { name: "time with pm", text: "We close at 3 pm.", expected: "We close at 3 pm." },
    { name: "time with colon", text: "Call back at 10:30.", expected: "Call back at 10:30." },
    { name: "currency with cents", text: "The amount is $250.00.", expected: "The amount is $250.00." },
    { name: "currency in words", text: "That is 1,250 dollars.", expected: "That is 1,250 dollars." },
    { name: "currency with spaced thousands", text: "Total $1 250 000 today", expected: "Total $1 250 000 today" },
    { name: "currency with comma thousands", text: "Total $1,250,000.50", expected: "Total $1,250,000.50" },
    {
      name: "business hours",
      text: "We are open Monday to Friday 8 to 5.",
      expected: "We are open Monday to Friday 8 to 5.",
    },
    { name: "duration in days", text: "Allow 21 days.", expected: "Allow 21 days." },
    { name: "duration in business days", text: "Allow 30 business days.", expected: "Allow 30 business days." },
    {
      name: "all of them together",
      text: "Press 1, option 2, press star. Open 3 pm to 10:30, Monday to Friday 8 to 5. $250.00 or 1,250 dollars in 21 days or 30 business days.",
      expected:
        "Press 1, option 2, press star. Open 3 pm to 10:30, Monday to Friday 8 to 5. $250.00 or 1,250 dollars in 21 days or 30 business days.",
    },
    { name: "a bare year", text: "In 1985 things changed", expected: "In 1985 things changed" },
    { name: "month and day without a year", text: "on March 4", expected: "on March 4" },
    { name: "the word one in speech", text: "No one knows. One moment please.", expected: "No one knows. One moment please." },
    { name: "a word that ends in a digit word", text: "someone gone alone", expected: "someone gone alone" },
    { name: "empty string", text: "", expected: "" },
  ];
  runTable(rows);
  runTable(rows.map((row) => ({ ...row, name: `${row.name} (empty context)`, context: {} })));
});

describe("tokens and findings", () => {
  it("counts from 1 per type and reuses tokens for equal values", () => {
    const result = redact(
      "member SYN-48271936 phone 519-555-1234 claim SYN-CLM-905173 again SYN-48271936 phone 416-555-0199 phone 519-555-1234",
      CTX,
    );
    expect(result.redacted).toBe(
      "member [[MEMBER_ID_1]] phone [[PHONE_1]] claim [[CLAIM_NUMBER_1]] again [[MEMBER_ID_1]] phone [[PHONE_2]] phone [[PHONE_1]]",
    );
    expect(result.findings).toEqual([
      { token: "[[MEMBER_ID_1]]", type: "MEMBER_ID" },
      { token: "[[PHONE_1]]", type: "PHONE" },
      { token: "[[CLAIM_NUMBER_1]]", type: "CLAIM_NUMBER" },
      { token: "[[PHONE_2]]", type: "PHONE" },
    ]);
  });

  it("restarts numbering on every call", () => {
    const first = redact("phone 519-555-1234", {});
    const second = redact("phone 416-555-0199", {});
    expect(first.redacted).toBe("phone [[PHONE_1]]");
    expect(second.redacted).toBe("phone [[PHONE_1]]");
  });

  it("keeps findings free of values, lengths and positions", () => {
    const result = redact("Alma at 519-555-1234, member SYN-48271936", CTX);
    for (const finding of result.findings) {
      expect(Object.keys(finding).sort()).toEqual(["token", "type"]);
      expect(finding.token).toMatch(/^\[\[[A-Z_]+_\d+\]\]$/u);
    }
    expect(JSON.stringify(result.findings)).not.toMatch(/Alma|519|48271936/u);
  });

  it("is a pure function: identical calls give identical results", () => {
    const text = "Alma Quillfeather 519-555-1234 on 2024-01-15";
    const first = redact(text, CTX);
    redact("something else entirely 999-999-9999", {});
    expect(redact(text, CTX)).toEqual(first);
  });

  it("does not mutate the context", () => {
    const context: CallContext = { ...CTX };
    redact("Alma", context);
    expect(context).toEqual(CTX);
  });

  it("leaves no output containing any identifier value", () => {
    const text =
      "Alma Quillfeather, member SYN-48271936, claim SYN-CLM-905173, born March 4 1985, phone 519-555-1234, mail a.b@c.test, hcn 1234567890";
    const { redacted } = redact(text, CTX);
    for (const secret of ["Alma", "Quillfeather", "48271936", "905173", "1985", "519", "a.b@c.test", "1234567890"]) {
      expect(redacted).not.toContain(secret);
    }
  });
});

describe("overlapping and adjacent matches", () => {
  runTable([
    {
      name: "identifier merged with trailing digits that extend it",
      text: "member SYN-48271936 90123 end",
      expected: "member [[MEMBER_ID_1]] end",
    },
    {
      name: "full name is one token, not two",
      text: "Alma Quillfeather",
      expected: "[[PATIENT_NAME_1]]",
    },
    {
      name: "adjacent but separate identifiers",
      text: "Alma,SYN-48271936;SYN-CLM-905173",
      expected: "[[PATIENT_NAME_1]],[[MEMBER_ID_1]];[[CLAIM_NUMBER_1]]",
    },
    {
      name: "name directly followed by a phone number",
      text: "Alma 519-555-1234",
      expected: "[[PATIENT_NAME_1]] [[PHONE_1]]",
    },
    {
      name: "date of birth followed by an unrelated long number",
      text: "1985-03-04 123456",
      expected: "[[DOB_1]]",
    },
    {
      name: "phone number inside a longer digit run is fully covered",
      text: "519-555-1234-5678",
      expected: "[[PHONE_1]]",
    },
    {
      name: "member id outranks claim number when both match the same text",
      text: "ids 9 0 5 1 7 3",
      expected: "ids [[MEMBER_ID_1]]",
      context: { claimNumber: "905173", memberId: "905173" },
    },
    {
      name: "the same text matched by several rules becomes one token",
      text: "1234567890",
      expected: "[[MEMBER_ID_1]]",
      context: { memberId: "1234567890" },
    },
    {
      name: "the date of birth wins over the digit rule",
      text: "19850304",
      expected: "[[DOB_1]]",
    },
    {
      name: "a context whose values never appear leaves ordinary text alone",
      text: "Thank you for calling. Goodbye.",
      expected: "Thank you for calling. Goodbye.",
    },
  ]);
});

describe("text normalisation", () => {
  runTable([
    { name: "full-width digits", text: "\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16", expected: "[[DIGIT_SEQUENCE_1]]", context: {} },
    { name: "zero-width space inside an id", text: "SYN-4827\u200B1936", expected: "[[MEMBER_ID_1]]" },
    { name: "soft hyphen inside a name", text: "Quill\u00ADfeather", expected: "[[PATIENT_NAME_1]]" },
    { name: "decomposed accent in a name", text: "Jose\u0301 here", expected: "[[PATIENT_NAME_1]] here", context: { patientFirstName: "Jos\u00E9" } },
    { name: "non-breaking space between digits", text: "123\u00A0456", expected: "[[DIGIT_SEQUENCE_1]]", context: {} },
  ]);
});

describe("fail closed", () => {
  const SENSITIVE = "Alma-Quillfeather-SYN-48271936";

  it.each([
    ["number", 42],
    ["null", null],
    ["undefined", undefined],
    ["object", { text: SENSITIVE }],
    ["array", [SENSITIVE]],
  ])("rejects non-string text (%s)", (_label, value) => {
    expect(() => redact(value as unknown as string, CTX)).toThrow("phi-redact: invalid input");
  });

  it("rejects text longer than 100000 characters", () => {
    expect(() => redact("a".repeat(100001), CTX)).toThrow("phi-redact: input exceeds maximum length");
  });

  it("accepts text of exactly 100000 characters", () => {
    expect(redact("a".repeat(100000), CTX).redacted).toHaveLength(100000);
  });

  const badContexts: ReadonlyArray<[string, unknown]> = [
    ["null context", null],
    ["string context", SENSITIVE],
    ["array context", []],
    ["unknown key", { patientMiddleName: "Zed" }],
    ["numeric name", { patientFirstName: 5 }],
    ["empty name", { patientFirstName: "" }],
    ["blank name", { patientFirstName: "   " }],
    ["one letter name", { patientFirstName: "A" }],
    ["name with digits", { patientFirstName: "Alma2" }],
    ["name with regex characters", { patientLastName: "(Quill)+" }],
    ["name too long", { patientLastName: "a".repeat(101) }],
    ["dob wrong shape", { dateOfBirth: "04/03/1985" }],
    ["dob impossible day", { dateOfBirth: "1985-02-30" }],
    ["dob impossible month", { dateOfBirth: "1985-13-01" }],
    ["dob zero day", { dateOfBirth: "1985-01-00" }],
    ["dob year out of range", { dateOfBirth: "1700-01-01" }],
    ["dob year too late", { dateOfBirth: "2101-01-01" }],
    ["short member id", { memberId: "123" }],
    ["member id with symbols", { memberId: "AB12$%^&" }],
    ["member id too long", { memberId: "A".repeat(65) }],
    ["claim number not a string", { claimNumber: 905173 }],
    ["claim number empty", { claimNumber: "" }],
  ];
  it.each(badContexts)("rejects an invalid context (%s) without echoing it", (_label, value) => {
    let message = "";
    try {
      redact("hello", value as CallContext);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toBe("phi-redact: invalid context");
  });

  it("never puts input content in an error message", () => {
    const secretText = "Alma 519-555-1234 SYN-48271936";
    for (const call of [
      () => redact(secretText + "x".repeat(100000), CTX),
      () => redact(secretText, { memberId: "SYN-48271936", patientFirstName: "Al!ma" }),
      () => redact(secretText, { dateOfBirth: "1985-02-30" }),
    ]) {
      try {
        call();
        expect.unreachable();
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        expect(message).not.toMatch(/Alma|519|48271936|1985/u);
        expect((error as Error).cause).toBeUndefined();
      }
    }
  });

  it("accepts an undefined optional field", () => {
    expect(redact("Alma", { patientFirstName: undefined } as unknown as CallContext).redacted).toBe("Alma");
  });

  it("does not leak the message of a throwing context getter", () => {
    const hostile = {};
    Object.defineProperty(hostile, "patientFirstName", {
      enumerable: true,
      get(): string {
        throw new Error("Alma Quillfeather");
      },
    });
    expect(() => redact("Alma", hostile as CallContext)).toThrow(/^phi-redact: invalid context$/u);
  });
});

describe("performance on large adversarial input", () => {
  const SIZE = 100000;
  it.each([
    ["a long run of letters", "a".repeat(SIZE)],
    ["a long run of letters with an at sign", `${"a".repeat(SIZE - 1)}@`],
    ["a long run of digits", "1".repeat(SIZE)],
    ["many spoken digits", "one ".repeat(SIZE / 4)],
    ["many separators", "1 ".repeat(SIZE / 2)],
    ["many month names", "may ".repeat(SIZE / 4)],
    ["many hyphens", "-".repeat(SIZE)],
  ])("finishes quickly on %s", (_label, text) => {
    const started = Date.now();
    redact(text, CTX);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
