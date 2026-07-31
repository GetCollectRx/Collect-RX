# Phase 7: Pre-Launch Checklist

**Status:** Ready for design-partner onboarding  
**Updated:** 2026-07-21

## Quick Summary

- [x] Code quality verified (1117 tests passed, build successful)
- [x] .env.example complete (196 variables)
- [x] CLAUDE.md accurate (port 3000)
- [x] Phase documentation updated (PRD, operations guides)
- [x] Monitoring & alerts configured
- [ ] Design-partner practice identified (NEXT)
- [ ] Compliance sign-off pending (NEXT)
- [ ] Carrier KBs hardened (IN PROGRESS)

## Go/No-Go Decision Criteria

**GO if:**
- All code tests pass (✅)
- Compliance legal review passed
- Design partner signed & onboarded
- All 6 carrier KBs tested end-to-end
- 24/7 ops rotation confirmed
- 3 assumptions clearly understood by team

**NO-GO if:**
- Any TypeScript errors blocking deployment
- Compliance concerns unresolved
- Carrier unwilling to accept AI calls
- Practice declines to participate

## Pre-Launch Verification

```bash
# Run before pilot launch (should all pass)

# 1. Code quality
npm test                # 1117 tests pass
npm run build           # Production build succeeds
npm run diagnose        # All health checks green

# 2. Environment
grep "LEARNING_LOOP_ENABLED\|NOTION_API_KEY\|VAPI_API_KEY" .env
# Verify all required vars set in Railway

# 3. Database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM practices;"
# At least 1 practice record (design partner)

# 4. Carrier KBs
find carriers/ -name "*.json" | wc -l
# Should be 6 carriers (sun-life, canada-life, manulife, green-shield, rbc, telus)

# 5. Documentation
ls -1 docs/operations/PHASE{6,7}-*.md
# Both guides present

# 6. Monitoring
curl http://localhost:3000/api/health/metrics -H "Authorization: Bearer $HEALTH_METRICS_TOKEN"
# Confirms /health endpoint responds
```

## Rollout Sequence

**Week 0:**
- [ ] Design partner practice onboarded
- [ ] First 5–10 test claims imported
- [ ] Staff trained (dashboard, escalation procedure)

**Week 1:**
- [ ] Queue enabled; first batch of 20 claims queued
- [ ] Monitor for CARRIER_BLOCK alerts
- [ ] Daily resolution rate tracking begins

**Week 2–4:**
- [ ] Scale to 50+ claims/week
- [ ] Analyze call failure patterns
- [ ] Harden system prompt based on real data

**Week 5–8:**
- [ ] Target 60%+ resolution rate
- [ ] Begin 2nd practice onboarding (if data looks good)
- [ ] Prepare board update (assumptions validation progress)

## Sign-Off

| Role | Name | Date | Sign-Off |
|------|------|------|----------|
| CTO / Engineering | Khalid | 2026-07-21 | Code ready ✅ |
| Legal / Compliance | [TBD] | TBD | Compliance reviewed ☐ |
| Operations | [TBD] | TBD | Ops procedures ready ☐ |
| Design Partner | [TBD] | TBD | Practice onboarded ☐ |
| Board | [TBD] | TBD | Assumption criteria confirmed ☐ |

---

**Next:** Confirm design partner + legal sign-off → Launch pilot
