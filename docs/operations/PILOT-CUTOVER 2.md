# Pilot cutover — Group G

**Prerequisite:** Groups C–F complete enough for a supervised pilot (staging proven; integrations live; compliance risk accepted or closed).

Product: Practice → Insurance only. **Do not** onboard patient pay / Connect.

## Day −1

- [ ] Staging smoke green (`npm run smoke:staging`)
- [ ] Prod secrets audited ([SECRETS-GO-LIVE.md](SECRETS-GO-LIVE.md))
- [ ] [PHASE4-GO-LIVE.md](PHASE4-GO-LIVE.md) checkboxes for prod
- [ ] Pilot practice credentials + CSV template ready
- [ ] On-call / escalation phone known for day 1

## Day 0 — onboard

1. [ ] Create / confirm practice in prod  
2. [ ] Import claims CSV (insurance outstanding only — not patient balances)  
3. [ ] Verify claims appear in work queue / AR command center  
4. [ ] Admin → Integrations all expected greens  
5. [ ] Confirm `/billing` if subscription required for pilot  

## Day 0 — supervised call path

1. [ ] Pick one eligible claim (age / attempts / hours rules OK)  
2. [ ] Confirm **no CARRIER_BLOCK** for that carrier  
3. [ ] Dispatch / observe Vapi call  
4. [ ] Verify metadata path: UUID tokens only (no patient name/DOB in Vapi metadata)  
5. [ ] Outcome lands on claim (status / notes / escalation as designed)  

## CARRIER_BLOCK drill

- [ ] Know how to confirm a block in Admin / DB  
- [ ] Confirm dispatch refuses that carrier while blocked  
- [ ] Document who can clear a block and when  

## Week 1

| Day | Review |
|-----|--------|
| Daily | Calls placed, failures, carrier blocks, queue depth |
| End of week | Claims moved, staff time saved notes, open incidents |

## Exit criteria (pilot success)

- [ ] At least one full supervised insurance follow-up loop  
- [ ] Zero unexplained PHI boundary violations  
- [ ] Zero unacknowledged CARRIER_BLOCK events  
- [ ] Backups + uptime still green  
- [ ] Written go / no-go for broader rollout  

## Sign-off

| Role | Name | Date |
|------|------|------|
| Engineering | | |
| Ops / on-call | | |
| Pilot practice contact | | |
