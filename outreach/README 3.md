# CollectRx outreach pack — Ottawa + GTA

Two files:

- **`dental-prospects-ottawa-gta.csv`** — 150 target practices with owner/principal name and location.
- **`outreach-email.md`** — ROI-hook cold email + one follow-up, CASL-structured.

## What's in the CSV

150 practices across Toronto, Mississauga, Brampton, Hamilton/Halton (incl. Burlington, Oakville, Stoney Creek, Waterdown), and Ottawa (incl. Kanata, Nepean, Orleans, Stittsville, Gloucester). Pure specialists, orthodontists, and standalone hygiene/walk-in clinics were excluded — they generate little insurance-A/R follow-up or aren't the buyer.

Columns: practice name, likely owner/principal, full dentist roster, address, city, postal code, segment, suggested tier, general email (blank — to enrich), outreach status.

- **Segment / Suggested Tier** map to your pricing: `Prime → Core ($799)`, `Group → Growth ($1,999)`, `Group (multi-loc) → Scale ($2,499)`. Start with Prime/Core — solo and small family practices are the sharpest ICP and the fastest close.
- **"Owner / Principal (likely)"** is the eponymous dentist where the practice is named after one, otherwise the first-listed dentist on the practice's Opencare profile. For group practices verify the actual owner before using the name in a salutation.

## Two honest caveats

1. **Owner names are best-effort, not verified.** Source is the Opencare directory. Confirm the principal on the practice website or the RCDSO public register before a named salutation — especially for group practices.
2. **General email is not populated.** Public directories don't expose it reliably, and guessing `info@` risks bounces. This is the next enrichment step — options: (a) I fetch each practice website for the published address / contact form, or (b) run the list through Apollo/Hunter for verified emails (Apollo connector needs authorizing first).

## CASL note (Canadian anti-spam law)

Cold B2B email to these practices is generally permitted under **implied consent** when you email a conspicuously published business address relevant to their role. To stay compliant, every send must:

- Identify the sender (CollectRx) with a **real mailing address** — fill `{{MailingAddress}}`.
- Include a **working unsubscribe** — the "reply unsubscribe" line is the minimum; honor opt-outs promptly.
- Not use misleading subject/sender info.

Keep a suppression list of anyone who opts out and never re-add them.
