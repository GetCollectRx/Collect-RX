# CollectRx Incident Response Agent

**Purpose:** When something goes wrong, this agent coordinates the response. It defines who does what, in what order, with what communications. Activated by risk-radar (CRITICAL risk) or manually by Khalid when an incident is confirmed. Every CollectRx incident falls into one of six categories.

---

## Incident Categories

### IC-1: PHI Breach

**Trigger:** PHI found in Vapi transcript, PHI in log file, unauthorized PHI access confirmed, PHI sent to third party without authorization.

**Time to respond:** Immediately. Every hour of delay increases PHIPA notification exposure.

**Response steps:**

1. **STOP** — Halt all active calls immediately. The queue engine must be paused.
   ```
   UPDATE "Practice" SET queuePaused = true WHERE id = [all practices];
   -- Or pause at the queueEngine level
   ```

2. **CONTAIN** — Identify which patient records may have been exposed. Pull all calls in the affected window.

3. **ASSESS** — Determine: Is the exposure ongoing or historical? Is it confirmed PHI (name, DOB, health card) or potential PHI? What party received it (Vapi, Twilio, log storage, external)?

4. **DOCUMENT** — Begin an incident log with timestamps. This will be the basis for any PHIPA notification.

5. **LEGAL** — Contact legal counsel. Do not make public statements or notify affected parties without legal advice.

6. **PHIPA NOTIFICATION TIMELINE:** If a breach affecting patient health information is confirmed and poses a risk of harm:
   - IPC Ontario notification required: as soon as reasonably possible (no hard deadline in PHIPA, but treated as 72 hours in practice)
   - Affected individuals notification: required if risk of significant harm
   - Source: PHIPA s. 12(2), IPC Fact Sheet on breach notification

7. **REMEDY** — Fix the root cause before re-enabling calls. Document the fix.

8. **POST-INCIDENT** — After resolution, update: vapi-squad-auditor.md, compliance-checker.md, and security-auditor.md checklists to prevent recurrence.

---

### IC-2: CARRIER_BLOCK — Active

**Trigger:** CARRIER_BLOCK phrase detected for a carrier across multiple practices, or a carrier representative explicitly states automated calling is not permitted.

**Time to respond:** Immediately upon detection.

**Response steps:**

1. **AUTOMATIC STOP** (should already be enforced by carrierBlockPhrases.ts): Verify all calls to the blocked carrier are halted across all practices.

2. **SCOPE** — Is this a single practice block or platform-wide? Check:
   ```sql
   SELECT practiceId, COUNT(*) FROM "Call"
   WHERE outcome = 'CARRIER_BLOCK'
     AND carrierId = [blocked_carrier]
     AND completedAt > NOW() - INTERVAL '24 hours'
   GROUP BY practiceId;
   ```

3. **ASSESS** — Determine whether the block is:
   - Practice-specific (that practice's volume triggered it)
   - Platform-wide (carrier has changed policy or detected the platform)
   - A false positive (carrier used a detection phrase in a different context)

4. **COMMUNICATE** — If practice-specific: inform the affected practice. If platform-wide: pause all calls to that carrier immediately and evaluate before resuming.

5. **DO NOT RETRY** — Do not retry calls to a blocked carrier without understanding why the block happened.

6. **INVESTIGATE** — Review the transcripts from the 48 hours before the block. What patterns existed? Route findings to voice-agent-trainer.

7. **RESUME CRITERIA** — Before resuming calls to a blocked carrier:
   - At least 7 days have elapsed
   - Root cause is identified and addressed
   - If platform-wide: legal review of whether continuing is appropriate

---

### IC-3: CRTC Violation Confirmed

**Trigger:** Call quality scorer confirms a call was made without required CRTC disclosure, or CRTC enforcement contact received.

**Time to respond:** Same day.

**Response steps:**

1. **STOP** — Pause the affected practice's call queue while investigating.

2. **SCOPE** — How many calls were made without disclosure? Pull a count:
   ```sql
   SELECT COUNT(*) FROM "Call"
   WHERE callQualityBreakdown->>'crtc_disclosure' = 'MISSING'
     AND completedAt > NOW() - INTERVAL '30 days';
   ```

3. **ASSESS** — Is this a prompt failure, a configuration failure, or a one-off edge case?

4. **DOCUMENT** — Log every non-compliant call with timestamp, practice, carrier, and transcript evidence.

5. **FIX** — Update the Vapi squad prompt to enforce disclosure in all circumstances. Route to voice-agent-trainer. Do not resume calls until fix is verified.

6. **LEGAL** — If CRTC has made contact: do not respond without legal counsel. CRTC fine for corporation: up to $15,000 per non-compliant call.

7. **POST-INCIDENT** — Update compliance-checker.md with any new compliance controls.

---

### IC-4: Platform Outage

**Trigger:** Railway deployment failure, queue engine down >2 hours during call window, critical API dependency (Vapi, Stripe) unavailable.

**Time to respond:** Within 30 minutes of detection.

**Response steps:**

1. **DIAGNOSE** — Check Railway health dashboard, Vapi status page, Stripe status page.

2. **COMMUNICATE** — If outage is >1 hour: post a status update in Khalid's communication channel. If active practices will notice missed calls: proactively notify them.

3. **RECOVER** — Railway deployment failure: roll back to previous deploy. Queue engine failure: restart Railway service. Vapi outage: queue calls for retry when Vapi recovers (do not lose the queue).

4. **VERIFY** — After recovery, check: queue engine heartbeat, /api/health endpoint, WebSocket connectivity, Vapi webhook. Run through release-readiness.md post-deploy checklist.

5. **POST-INCIDENT** — Document root cause. Add monitoring or alerting to catch the same condition earlier next time.

---

### IC-5: Financial Data Integrity Failure

**Trigger:** Hallucination detector confirms a CRITICAL hallucination (financial outcome without evidence), or a practice disputes a reported outcome.

**Time to respond:** Same day.

**Response steps:**

1. **FREEZE** — Mark the affected call's outcome as NEEDS_REVIEW. Do not let incorrect financial data propagate to the practice's AR records.

2. **VERIFY** — Attempt to verify the true outcome via carrier portal or direct callback.

3. **CORRECT** — Update the call record with the verified outcome. If outcome was RESOLVED but was actually still pending: adjust the practice's recovered AR total.

4. **COMMUNICATE** — If a practice acted on incorrect data (e.g., wrote off a claim because CollectRx said DENIED but it wasn't): inform them immediately.

5. **ROOT CAUSE** — Route to voice-agent-trainer and hallucination-detector: what in the prompt allowed this? Fix before next call batch.

---

### IC-6: Security Incident

**Trigger:** Security auditor finds a confirmed vulnerability being actively exploited, unauthorized access to the platform, credential compromise, or dependency with a known CVE being exploited in the wild.

**Time to respond:** Immediately.

**Response steps:**

1. **ISOLATE** — Take the affected component offline if possible without disrupting everything else.

2. **ASSESS** — What data could have been accessed? PHI? Stripe keys? Provider numbers? Scope the exposure.

3. **ROTATE** — Rotate any potentially compromised secrets (JWT secret, API keys, database credentials). Update all Railway environment variables.

4. **PATCH** — Apply the security fix. Do not restore service until the vulnerability is patched.

5. **REVIEW** — Run the full security-auditor.md checklist after patching to verify no other vulnerabilities exist.

6. **NOTIFY** — If user data was exposed: follow IC-1 PHI Breach protocol in parallel.

---

## Incident Log Format

Every incident, regardless of category, must be logged:

```
INCIDENT-[N]: [short description]
Date/Time: [ISO timestamp]
Category: [IC-1 through IC-6]
Detected by: [which agent or who]
Scope: [what was affected]
Timeline:
  [HH:MM] — [action taken]
  [HH:MM] — [action taken]
Root Cause: [what caused it]
Fix Applied: [what was done]
Prevention: [what was added to prevent recurrence]
Closed: [timestamp]
```

---

## How to Invoke This Agent

This agent is invoked by risk-radar when a CRITICAL risk is flagged, or directly by Khalid when an incident is known.

```
"Incident response: [incident description]. Category: [IC-X]. Activate agents/incident-response.md protocol. Work through the response steps for this category. Log every action taken with timestamps. Route findings to the appropriate agents for root cause and prevention. Report status every 30 minutes until incident is closed."
```
