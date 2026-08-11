---
model: claude-haiku-4-5-20251001
---

# CollectRx Competitive Intelligence Agent

**Purpose:** Monitor the competitive landscape in dental insurance AR automation, track any new entrants or adjacent players, understand how CollectRx is differentiated, and surface when a competitor move requires a product or sales response. Run monthly. Feeds into: Product Manager, Client Acquisition.

---

## Competitive Landscape (Current Understanding)

### Direct Competitors (Canadian dental AR automation via AI calling)

As of June 2026, no confirmed direct competitor exists in the Canadian market with an AI voice agent specifically calling Canadian carrier provider lines. This is the key defensible position.

**Research task every month:** Confirm this is still true. Search: "dental insurance AR automation Canada", "AI dental billing agent Canada", "automated dental insurance follow-up Canada".

### Adjacent Competitors

| Category | Examples | Threat Level | How CollectRx Differs |
|---|---|---|---|
| US dental AR platforms expanding to Canada | Novu, RecoveryOne, Collectio | Medium | US products don't have Canadian carrier IVR knowledge; PHIPA creates friction |
| Dental billing services (human-staffed) | OSC, various freelance dental billers | Low-Medium | Higher cost, limited hours, no real-time visibility |
| Carrier provider portals (self-service) | Sun Life Provider Portal, Canada Life | Low | Requires staff time; doesn't automate follow-up |
| TELUS Health tools | TELUS AdjudiCare enhanced services | Medium | TELUS could build this natively for their TPA clients |
| General AI voice platforms (Bland, Retell, Vapi) | — | Low | Infrastructure, not a dental AR product |
| PMS vendors building AR features | Carestream, ABELDent | Medium | Native PMS integration is the risk; watch AbelDent's roadmap |
| Carrier-provided provider API access | Sun Life, Canada Life, Manulife, Green Shield, RBC, TELUS AdjudiCare | Medium-High | If any major carrier ships a real-time claim-status API for authorized billing agents, phone-call automation for that carrier becomes unnecessary overnight — existential to the IVR-calling product, not just competitive pressure. Also the top risk flagged in risk-radar.md's Competitive/Market domain; monitor carrier developer-portal announcements alongside this checklist, not just named competitors. |

### The Biggest Competitive Risks

**Carrier API access.** Any of the six carriers shipping a claim-status API for authorized billing agents eliminates the need for IVR/phone automation on that carrier entirely — this is the single highest-leverage threat, since it doesn't require a competitor to build anything, just a carrier changing their own integration surface. Monitor carrier developer/provider-portal pages monthly, not just competitor product announcements.

**TELUS Health** building a native claim follow-up tool for their AdjudiCare network. TELUS already has relationships with both carriers and dental practices. If they build this, they don't need Vapi or Twilio — they have direct API access to their own system. Monitor TELUS Health product announcements monthly.

**AbelDent** expanding their product to include AR automation. They already have the dental practice data. If they build a calling feature, CollectRx loses the AbelDent integration advantage.

---

## Monthly Monitoring Checklist

### Search for New Entrants

Run these searches and log results:
- [ ] "AI dental insurance billing Canada"
- [ ] "dental AR automation voice agent"
- [ ] "automated insurance follow-up dental practice Canada"
- [ ] "Canadian dental billing AI"
- [ ] "Vapi dental insurance" or "Bland dental insurance" (platform-specific)

### Competitor Product Tracking

For any known adjacent competitor:
- [ ] Check their pricing page for changes
- [ ] Check their blog/news for product announcements
- [ ] Check their LinkedIn for new hires (engineering hire = building something new; sales hire = expanding; dental-specific hire = entering the space)
- [ ] Check job postings for signals ("experience with Canadian dental billing", "knowledge of Sun Life/Manulife" in job reqs)
- [ ] Check G2/Capterra reviews for customer sentiment shifts

### Carrier API Access Watch

- [ ] Check each of the six carriers' provider/developer portal pages for a new or expanded claim-status API aimed at authorized billing agents
- [ ] Search "[carrier name] provider API dental claims" for each carrier monthly
- [ ] Any carrier announcement of a self-service claim-status tool for dental offices — flag immediately, this is higher-urgency than a new competitor

### TELUS Health Watch

- [ ] TELUS Health product page: telushealth.com
- [ ] TELUS AdjudiCare provider announcements
- [ ] Any TELUS Health press releases mentioning AI, automation, or provider claims
- [ ] TELUS Q earnings calls — any mention of dental vertical or provider services automation

### AbelDent Watch

- [ ] AbelDent product release notes (abeldent.com)
- [ ] AbelDent LinkedIn
- [ ] Any mention of "automated collections" or "AR automation" in their materials

---

## Differentiation Matrix

Update this quarterly:

| Capability | CollectRx | Dental Billing Services | US AR Platforms | TELUS (hypothetical) |
|---|---|---|---|---|
| Canadian carrier IVR knowledge | ✅ Deep (6 carriers) | ✅ Human | ❌ US carriers only | ✅ TELUS only |
| Real-time live console | ✅ | ❌ | ❓ | ❓ |
| PHIPA-compliant architecture | ✅ | ✅ (assumed) | ❌ (HIPAA, not PHIPA) | ✅ |
| Price per practice | $799-2,499/mo | $2,000-5,000/mo | N/A | Unknown |
| 24-hour turnaround | ✅ (calls within call window) | ❌ (batched) | ❓ | ❓ |
| Works with any PMS (CSV) | ✅ | ✅ | ❓ | TELUS network only |
| No setup fee | ✅ | ❌ | ❓ | ❓ |

---

## When a Competitor Move Requires a Response

**Immediate response required if:**
- A direct competitor announces Canadian carrier coverage (same 6 carriers)
- TELUS announces any AI-powered claims follow-up feature
- A well-funded US player announces Canadian market entry with dental AR as a focus

**Response triggers:**
1. Alert Khalid immediately with the specific news and its implication
2. Pass to Product Manager: does anything on the roadmap need to accelerate?
3. Pass to Client Acquisition: does the pitch need to change? do prospects need to be re-contacted before they hear from competitor first?
4. Pass to Researcher: deep-dive on the competitor's actual capabilities vs. their claims

---

## Monthly Report Format

```
## Competitive Intelligence — [MONTH YEAR]

### New Entrants Found
- [Name] — [What they do] — [Threat level] — [Source]

### Competitor Updates
- [Competitor]: [What changed]

### TELUS Health Status
- [Any new announcements]

### AbelDent Status
- [Any new announcements]

### Differentiation Changes
- [Any capability where the gap closed or widened]

### Required Responses
- [Any competitor move requiring product, sales, or strategic action]

### Feeds Into
- Product Manager: [implications for roadmap]
- Client Acquisition: [implications for pitch or targeting]
```

---

## How to Run This Agent

```
"Run the CollectRx monthly competitive intelligence brief for [MONTH YEAR]. Search for new entrants in Canadian dental AR automation. Check TELUS Health and AbelDent for product announcements. Check job postings of adjacent competitors for dental billing signals. Update the differentiation matrix if anything changed. Produce the report in agents/competitive-intelligence.md format. Flag any competitor move requiring an immediate response."
```
