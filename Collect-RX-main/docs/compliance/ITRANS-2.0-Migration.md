# ITRANS 2.0 / CDAnet Version 4 Migration Guide
## CollectRx Layer 5 Connector Update
### Deadline: June 30, 2026 — Legacy Protocol Retirement

**Document Version:** 1.0  
**Date:** May 2026  
**Urgency:** HIGH — 46 days to retirement deadline  

---

## 1. What Is Changing

The Canadian Dental Association (CDA) and Canada Health Infoway are retiring the legacy **ITRANS 1.x / CDAnet Version 3** protocol on **June 30, 2026**.

After this date:
- CDAnet Version 3 transactions will no longer be accepted by Sun Life, Manulife, Canada Life, Green Shield, RBC, or TELUS
- Practices on legacy PMS versions that have not upgraded will lose electronic claims submission capability
- Paper fallback will be required for affected practices until PMS upgrade is completed

**Replacement:** ITRANS 2.0 running over CDAnet Version 4, which adds:
- TLS 1.3 transport security (replacing SSL/TLS 1.0)
- Transaction 09 (Attachment) support — required for Phase 5 CDCP reconsideration evidence submission
- Expanded character set for clinical notes (UTF-8)
- Structured denial reason codes (maps to Phase 5 denial taxonomy)
- Real-time acknowledgment (replacing batch polling)

---

## 2. Impact on CollectRx

### 2.1 Affected Components

| Component | Current Protocol | Required Update | Status |
|-----------|----------------|----------------|--------|
| Abeldent Sync Connector | CDAnet v3 (if applicable) | CDAnet v4 / ITRANS 2.0 | Needs verification |
| CDAnet Claim Submission | v3 transaction format | v4 transaction format | Phase 5 update |
| Transaction 09 (Attachments) | Not supported in v3 | New in v4 — required for Phase 5 | Implemented in Phase 5 |
| Status Polling | Batch (v3) | Real-time ACK (v4) | Transport capability only; not a CollectRx pre-call triage signal |
| Denial Code Parsing | Legacy codes | Structured ITRANS 2.0 codes | Phase 5 evidenceMapper.ts |

### 2.2 Phase 5 Implementation Status

The Phase 5 `cdanetSubmission.ts` module is built to **CDAnet Version 4 / ITRANS 2.0** standards:
- `CDANET_VERSION = '04'`
- `ITRANS_VERSION = '2.0'`
- Transaction 09 payload builder implemented
- Submission strategy selector enforces v4 requirement after June 30, 2026

### 2.3 CDAnet no-signal limitation

CollectRx currently does **not** register a CDAnet status transaction as a
pre-call triage channel. The only active pre-call signal is the practice PMS
sync: when it already shows a claim resolved or its outstanding amount at zero,
CollectRx skips the phone call. A missing PMS signal means the normal carrier
call fallback proceeds.

CDAnet v4 / ITRANS 2.0 transport capability, an acknowledgment, or a
successful electronic submission must not be represented as current claim
status. Until a carrier-supported status query is implemented, authenticated,
and registered in triage, it produces **no triage signal** and must not suppress
or close a claim automatically.

---

## 3. Practice PMS Upgrade Requirements

### 3.1 Supported PMS Versions (CDAnet v4 Compatible)

| PMS | Minimum Version | Notes |
|-----|----------------|-------|
| Abeldent Local Plus | v15.x or later | Verify with ABELSoft support |
| Dentrix | G7.5+ | |
| Cleardent | v12+ | |
| Tracker | v11+ | |
| Oral Health Office | v10+ | |
| MacPractice | v11+ | |

### 3.2 For a Practice Using Abeldent Local Plus

1. Contact ABELSoft (1-800-267-ABEL) to confirm current version
2. If below v15.x: Schedule upgrade before June 15, 2026 (allow 2 weeks for testing)
3. After upgrade: Run `npm run abeldent:discover` to refresh the schema map
4. Validate CDAnet v4 connectivity with a test transaction to Sun Life

---

## 4. CollectRx Code Changes (Phase 5)

### 4.1 `cdanetSubmission.ts` — Already Updated

```typescript
const CDANET_VERSION = '04';
const ITRANS_VERSION = '2.0';

// selectSubmissionStrategy() enforces v4 after June 30, 2026:
// CDAnet v3 legacy practices receive paper_fallback with ITRANS upgrade warning
```

### 4.2 `carrier-configs.json` — No Change Required

Carrier configs do not need protocol-specific changes. The transport protocol is handled at the connector layer.

### 4.3 Denial Code Mapping — Phase 5 `evidenceMapper.ts`

ITRANS 2.0 introduces structured denial codes. The Phase 5 `CdcpDenialReasonCode` type maps the new F-0xx codes directly:

```typescript
type CdcpDenialReasonCode =
  | 'F-010'  // Missing documentation
  | 'F-011'  // Frequency limit
  | 'F-012'  // Waiting period
  // ... (full set in types.ts)
```

These codes are transmitted in ITRANS 2.0 Transaction 11 (Pre-Authorization) responses and are parsed by the Abeldent sync connector.

---

## 5. Rollout Timeline

| Date | Action |
|------|--------|
| May 15, 2026 | Phase 5 CDAnet v4 code complete (this release) |
| May 22, 2026 | Test Transaction 09 submission with Sun Life sandbox |
| June 1, 2026 | All practices notified of June 30 deadline |
| June 15, 2026 | PMS upgrade deadline for pilot practice |
| June 30, 2026 | **ITRANS 1.x / CDAnet v3 retired** — paper fallback for non-compliant practices |
| July 7, 2026 | Post-retirement audit — identify any practices still on legacy protocol |

---

## 6. Emergency Fallback

If a practice misses the upgrade deadline:
1. CollectRx `selectSubmissionStrategy()` automatically switches to `paper_fallback`
2. Practice receives an urgent in-app notification with upgrade instructions
3. Reconsideration packages are generated as PDF for manual mailing to the Sun Life PO Box
4. Electronic submission resumes automatically once PMS is upgraded and `pmsCapability` is updated to `'cdanet_v4'`

---

## 7. References

- CDA ITRANS 2.0 Specification: https://www.cda-adc.ca/itrans
- Canada Health Infoway CDAnet v4: https://www.infoway-inforoute.ca
- ABELSoft CDAnet v4 upgrade guide: https://www.abelsoft.com/cdanet-v4
- Sun Life Provider Technical Bulletin (June 2025): Legacy protocol retirement notice
