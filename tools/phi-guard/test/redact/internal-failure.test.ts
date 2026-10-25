import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/redact/dates.js", () => ({
  findDates: (): never => {
    throw new Error("Alma Quillfeather SYN-48271936");
  },
}));

describe("internal failure", () => {
  it("throws a generic error with no cause and never returns text", async () => {
    const { redact } = await import("../../src/redact/index.js");
    let caught: unknown;
    try {
      redact("Alma Quillfeather SYN-48271936", {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error;
    expect(error.message).toBe("phi-redact: internal failure");
    expect(error.cause).toBeUndefined();
  });
});
