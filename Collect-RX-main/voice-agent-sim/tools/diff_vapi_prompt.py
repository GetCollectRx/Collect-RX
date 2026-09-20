#!/usr/bin/env python3
"""Compare a production Vapi assistant prompt against a TEST-squad rendered
copy, correctly distinguishing template-variable substitution from real
behavioral/instruction changes.

Four prior approaches in this file's history were wrong; kept as the
reason this one looks the way it does (don't re-attempt any of these):

1. Replace every {{var}} with the SAME generic placeholder, then diff.
   WRONG: collapsing distinct variables to one identical token destroys
   difflib's alignment on long prompts.

2. Split prod into literal segments, find() each one in test with a
   forward-only cursor. WRONG on long/repetitive prompts: an earlier
   segment can match at a spuriously late position (shared boilerplate
   recurs across the scenario tree), pushing the cursor past a later
   segment's real, earlier occurrence.

3. Diff raw unmodified text with difflib, check if each non-equal hunk
   is fully "{{...}}"-shaped. WRONG: difflib's LCS is character-level
   and splits markers mid-token against coincidentally matching
   characters nearby (prod's "{{p" aligning with test's "CollectRx
   Demo P").

4. Replace each marker with a unique sentinel ("\\x00TVAR3\\x00"), diff
   raw characters. WRONG for the same reason as #3 one level down: the
   sentinel's own digits/letters still get character-level-matched
   against coincidentally similar digits/letters in the test-side
   rendered values, fragmenting the "atomic" sentinel anyway.

The actual fix: character-level diffing can never treat "{{...}}" as
atomic, because difflib.SequenceMatcher has no concept of "atomic unit"
at the character level - only at the level of whatever sequence you feed
it. So feed it a sequence of WORD TOKENS (str.split() on whitespace)
instead of raw characters. "{{practice_name}}" and "${{amount_billed}}"
each contain no internal whitespace, so they land as single list
elements automatically - impossible to fragment mid-marker, because
SequenceMatcher never splits inside a list element, only between them.

Usage:
    python3 diff_vapi_prompt.py prod.txt test.txt
"""
import argparse
import difflib
import re
import sys

TEMPLATE_MARKER = re.compile(r"\{\{.*?\}\}|\{%.*?%\}")


def has_template(token):
    return bool(TEMPLATE_MARKER.search(token))


def compare(prod, test):
    """Returns (behavioral_diff_found, list of (prod_tokens, test_tokens) issues).
    Tokenized on whitespace so {{var}} markers are atomic list elements."""
    prod_tokens = prod.split()
    test_tokens = test.split()

    sm = difflib.SequenceMatcher(None, prod_tokens, test_tokens, autojunk=False)
    issues = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        prod_piece = prod_tokens[i1:i2]
        test_piece = test_tokens[j1:j2]
        # template-only if EVERY prod-side token in this hunk contains a
        # marker - a mix of marker and non-marker tokens in one hunk means
        # real literal text changed alongside a variable, so it counts.
        if prod_piece and all(has_template(t) for t in prod_piece):
            continue
        issues.append((" ".join(prod_piece), " ".join(test_piece)))
    return (len(issues) > 0), issues


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("prod_file")
    ap.add_argument("test_file")
    args = ap.parse_args()

    with open(args.prod_file, "r", encoding="utf-8") as f:
        prod = f.read()
    with open(args.test_file, "r", encoding="utf-8") as f:
        test = f.read()

    behavioral, issues = compare(prod, test)
    if not behavioral:
        print("CONFIRMED (template-substitution only, or identical)")
        return 0

    print("FLAGGED (behavioral diff found):")
    for prod_piece, test_piece in issues:
        pp = prod_piece if len(prod_piece) <= 200 else prod_piece[:200] + "...(truncated)"
        tp = test_piece if len(test_piece) <= 200 else test_piece[:200] + "...(truncated)"
        print("  prod:", repr(pp))
        print("  test:", repr(tp))
    return 1


if __name__ == "__main__":
    sys.exit(main())
