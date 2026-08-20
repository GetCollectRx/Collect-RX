# CollectRx Privacy Policy — DRAFT FOR COUNSEL REVIEW

> **STATUS: DRAFT. Not published. Requires review by Canadian privacy counsel (PIPEDA; PHIPA for Ontario practices) before publication.** Prepared 2026-07-18. Factual descriptions of data flows below are accurate to the built system.

## Who we are
CollectRx ("we") provides software that automates insurance claim follow-up for Canadian dental practices. For patient information, the dental practice is the custodian/controller; CollectRx processes that information as the practice's service provider, on its instructions, to deliver the service.

## Information we process
- **Practice account data** (controller: CollectRx): practice name, staff names and emails, login credentials (hashed), billing records via Stripe. We never store full payment card numbers.
- **Patient and claim data** (processed for the practice): patient name, date of birth, insurance policy/group numbers, treatment codes and dates, claim amounts and statuses — imported by the practice via CSV or practice-management-system connector.
- **Call records**: call outcomes, structured summaries, and transcripts of calls with insurance carriers. Transcripts are scrubbed of patient identifiers before storage. Call audio recordings are disabled and any transient recording is deleted.

## How patient information moves (the technical facts)
- Patient identifiers are stored tokenized; the voice-calling vendor receives only ephemeral call variables at dial time and opaque tokens in call metadata — patient identifiers are not persisted with the vendor.
- Automated calls disclose their automated nature, the practice's name, and a callback number at the start of each call (CRTC requirement).
- Data is encrypted in transit; sensitive fields are encrypted at rest.

## Service providers
We use vetted providers to deliver the service: [hosting — Fly.io], [telephony — Twilio], [voice AI — Vapi and its subprocessors], [email — SendGrid/Twilio], [payments — Stripe]. Data processing terms with each are tracked in the vendor register. [Counsel: confirm cross-border transfer disclosures — several providers process in the United States.]

## Purposes and limits
We use patient information only to perform claim follow-up for the practice. We do not sell personal information, use patient information for advertising, or use identifiable patient information to train models. Service improvement uses de-identified or aggregated data.

## Retention
Practice account data: for the life of the account and [X] years after. Patient/claim data: retained per the practice's instructions; on termination the practice may export, after which data is deleted within [30] days except where law requires longer. Call transcripts: [X months — business decision].

## Access, correction, deletion
Patients should direct access/correction requests to their dental practice (the custodian); we support the practice in fulfilling them. Practice staff may contact [privacy@collectrx.ca] for their own data.

## Safeguards
Role-based access, tenant isolation enforced at the database layer, audit logging of PHI access, encryption in transit and at rest, no PHI in application logs.

## Breach response
We notify affected practices without unreasonable delay after confirming a breach involving their data, and support their reporting obligations. [Designate the PIPEDA/PHIPA breach contact — open operator item.]

## Contact
Privacy officer: [name — MUST be designated before publication]. [privacy@collectrx.ca]. We respond to complaints and cooperate with the Office of the Privacy Commissioner of Canada and provincial authorities.
