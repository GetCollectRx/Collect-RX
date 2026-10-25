import type { CallContext, RedactionResult } from "./types.js";
import { findDates } from "./dates.js";
import { findSpokenDob } from "./dobForms.js";
import { findHealthNumbers, findDigitSequences, findEmails, findPhones } from "./layer2.js";
import { findIdentifiers, findNames } from "./layer1.js";
import { apply } from "./merge.js";
import { ERR_INTERNAL, assertText, validateContext } from "./validate.js";

export type { CallContext, Finding, IdentifierType, RedactionResult } from "./types.js";

// Invisible format characters can split an identifier without changing how it reads.
const INVISIBLE = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g;

/**
 * Replaces every identifier in a transcript with a token.
 *
 * Fails closed: invalid input or context throws an error whose message never
 * contains input content, and no code path returns unredacted text on error.
 */
export function redact(text: string, context: CallContext): RedactionResult {
  const raw = assertText(text);
  const ctx = validateContext(context);
  try {
    const normalised = raw.normalize("NFKC").replace(INVISIBLE, "");
    return apply(normalised, [
      ...findNames(normalised, ctx),
      ...findIdentifiers(normalised, ctx),
      ...findDates(normalised, ctx.dob),
      ...findSpokenDob(normalised, ctx.dob),
      ...findEmails(normalised),
      ...findPhones(normalised),
      ...findHealthNumbers(normalised),
      ...findDigitSequences(normalised),
    ]);
  } catch {
    // Dropping the original error is deliberate: engine errors can echo pattern text.
    throw new Error(ERR_INTERNAL);
  }
}
