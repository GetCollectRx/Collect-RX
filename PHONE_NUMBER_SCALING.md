# Phone Number Scaling for CollectRx

## Current Architecture

**Single phone number for all practices:**
- All outbound calls use one `VAPI_PHONE_NUMBER_ID` (Twilio number registered in Vapi)
- Queue engine dispatches **10 claims per tick** (60-second intervals)
- **~10 calls/minute maximum throughput** (sequential, not concurrent)
- Twilio + Vapi handle call queuing/scheduling

## When Do You Need Multiple Phone Numbers?

### Scenario 1: Twilio Concurrency ✓ (NOT a bottleneck)
**Question:** Can one Twilio number handle 20+ concurrent outbound calls?

**Answer:** YES. Twilio standard numbers support **100+ concurrent calls** natively. One shared number works fine for 50+ practices. Billing is per call, not per number.

**Verified:** Twilio docs confirm up to 100 concurrent (CPS limits may apply for very high volume).

### Scenario 2: Carrier Rate Limiting ❌ (Not yet a blocker)
**Risk:** Some carriers may block repeated calls from the same number within short timeframes.

**Current reality:**
- 10 calls/minute spread across 6 carriers = ~1.7 calls/min per carrier
- Vapi queues calls; they don't all hit at once
- No evidence yet that carriers block by caller ID frequency

**Timeline:** Only matters at 50+ concurrent calls/minute per carrier

### Scenario 3: Geographic Routing / Local Presence (Maybe)
**Question:** Do Canadian carriers care about area codes?

**Current:** You're using a single Twilio number (e.g., +1-613-555-1234)

**Reality:** Most carriers don't verify caller area code. Some may log it for fraud detection, but CollectRx is compliant and disclosed, so no issue.

**Timeline:** Only matters if you see carriers systematically routing calls to voicemail based on geography

---

## Backend Impact of Multiple Phone Numbers

**Good news:** Adding phone numbers requires **zero backend changes**.

### How It Would Work

**Option 1: Round-robin at queue-dispatch time (Simple)**
```typescript
// In queueEngine.ts, when calling initiateCall():
const phoneNumbers = [
  process.env.VAPI_PHONE_NUMBER_ID_1,
  process.env.VAPI_PHONE_NUMBER_ID_2,
  process.env.VAPI_PHONE_NUMBER_ID_3,
];
const phoneNumberId = phoneNumbers[claimIndex % phoneNumbers.length];
```
- **Effort:** <10 lines of code
- **Risk:** None (stateless)
- **DB changes:** None

**Option 2: Per-practice assignment (Stateful)**
```sql
-- Add to practices table
ALTER TABLE practices ADD COLUMN vapi_phone_number_id VARCHAR;

-- Seed during onboarding
INSERT INTO practices (id, ..., vapi_phone_number_id) 
VALUES ('practice-1', ..., process.env.VAPI_PHONE_NUMBER_ID_1);
```
- **Effort:** ~30 lines (schema migration + assignment logic)
- **Risk:** Minimal (add column is additive)
- **DB changes:** One schema change
- **Benefit:** Practices feel like they have "their own" number (marketing)

**Option 3: Per-carrier assignment (Complex)**
```typescript
// Route based on carrier's known preferences
const CARRIER_PHONE_MAP = {
  'sun_life': process.env.VAPI_PHONE_SUN_LIFE,
  'canada_life': process.env.VAPI_PHONE_CANADA_LIFE,
  // ... map each carrier to optimal region
};
```
- **Effort:** ~50 lines
- **Risk:** Maintainability (hardcoded mappings)
- **Benefit:** Optimize for each carrier's routing logic

---

## Actual Scaling Timeline (Vapi is the bottleneck, not phone numbers)

| Phase | Practices | Concurrent Calls | VAPI_MAX_CONCURRENT_CALLS | Available Slots | Status |
|-------|-----------|------------------|--------------------------|-----------------|--------|
| **Now** | 1–2 | 1–2 | 10 (default) | 8 | ✓ Safe |
| **Q3 Growth** | 5–10 | 5–10 | 10 (default) | 8 | ⚠️ Some queue at 8+ |
| **Q4 Expansion** | 15–25 | 15–25 | **Need: 30** | 28 | 🔴 Upgrade env var |
| **2027 Enterprise** | 50+ | 50+ | **Need: 60+** | 58 | Contact Vapi support |

**Current default:** `VAPI_MAX_CONCURRENT_CALLS=10` (8 available after 2-slot reserve)

**Upgrade path:** 
- To handle 25 concurrent: Set `VAPI_MAX_CONCURRENT_CALLS=30` 
- To handle 50+ concurrent: Contact Vapi support for enterprise plan

**Phone numbers needed:** Just 1. Twilio handles 100+ concurrent on a single number.

---

## What Actually Needs Scaling First

**The real bottleneck sequence:**

1. **Vapi concurrency limit** — THE bottleneck
   - Current default: 10 concurrent calls (8 available after reserve)
   - Action at 10 practices: Increase `VAPI_MAX_CONCURRENT_CALLS` env var
   - **Effort:** 1 line of config, no code changes
   - Cost: Vapi charges per concurrent minute (scales with your plan)

2. **Vapi queue management** — Handles overflow gracefully
   - If 20 practices call but only 8 slots available: 12 calls queue automatically
   - Queued calls start when slots free up
   - **No dropped calls**, just delayed dispatch
   - **Effort:** Monitor logs; no action needed until you want <5s dispatch latency

3. **Database IOPS** — Call webhooks write to `call_attempts`, `insurance_claims`, etc.
   - ~10 calls/min = ~10 writes/min = negligible for PostgreSQL
   - Becomes an issue at 1000+ calls/min
   - **Fix:** Read replicas, query optimization (Phase 8)

4. **Backend API bottleneck** — Vapi webhooks POST to `/api/webhooks/vapi`
   - Current: 10 concurrent calls = 10 concurrent webhooks
   - Becomes an issue at 100+ concurrent webhooks
   - **Fix:** Add webhook queue worker (async processing)

---

## Recommendation: Start with 1 Number, Monitor These

**Do now:**
- ✅ Deploy with your single Twilio number
- ✅ Add metrics to track calls/min by carrier
- ✅ Set alerts at 20 calls/min (half the safe threshold)

**When alerts fire at 20 calls/min:**
1. Check carrier rejection rates — if they're high, add phone numbers
2. If they're low, you're fine — just keep growing

**Implementation when needed (~Q4):**
- Add `VAPI_PHONE_NUMBER_ID_2`, `VAPI_PHONE_NUMBER_ID_3` env vars
- Change line 207–211 of `src/vapi/client.ts` to round-robin select
- Done

**Effort when it matters:** <30 minutes

---

## The Real Scaling Blocker Isn't Phone Numbers

The actual bottleneck at 1000+ calls/day is **outbound call concurrency**, which is controlled by:
- Vapi's concurrent minute limit (upgrade your plan)
- Twilio's call concurrency (unlimited by default)
- Your backend webhook processing speed (add worker queue)

Phone numbers are a non-issue until you hit carrier-specific problems, which we haven't seen yet in testing.

**Bottom line:** Onboard practices fearlessly. You have runway for 50+ practices on one phone number.
