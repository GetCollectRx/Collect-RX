# CASL — partnership outreach policy (internal)

CollectRx cold email to dental practices must comply with Canada's Anti-Spam Legislation (CASL). This is an internal operating guide, not legal advice.

## What we send

- B2B outreach about **insurance AR automation** only
- Locked templates from `outreachVoice.ts` / `emailTemplates.ts`
- No fabricated social proof, no em dashes, no invented metrics

## When we may email

Send only when one of these applies:

1. **Conspicuous publication** — the address is published on the practice website or Google Business listing as a business contact (office@, info@, billing@), and the message relates to their business role.
2. **Referral or inbound** — they asked for information, booked a demo, or a current customer introduced them with permission.
3. **Existing relationship** — they are in an active sales or customer conversation with CollectRx.

Do not buy email lists. Do not scrape personal addresses unrelated to the practice.

## Required in every email

- Clear sender identity (CollectRx)
- Relevant subject (no deceptive subjects)
- Unsubscribe mechanism (reply "unsubscribe" is handled automatically)

## Opt-out handling

- Inbound "unsubscribe" → auto confirmation + `opted_out` stage + cadence stopped
- Manual opt-out on prospect detail page
- SendGrid spam report → auto opt-out via event webhook
- Never re-email opted-out addresses

## Record keeping

- `ProspectActivity` logs emails sent, replies, stage changes
- Keep harvest source (`source: harvest | manual`) for audit

## Before scaling

- [ ] Legal review of templates and CASL basis for your target list
- [ ] Verified SendGrid domain + SPF/DKIM
- [ ] Test with internal addresses first
- [ ] Low volume ramp (10–20/day) before harvest at scale

## References

- Capability copy: `GET /api/admin/partnerships/outreach-voice`
- Deploy steps: `PARTNERSHIPS-DEPLOY.md`
