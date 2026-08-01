# CollectRx Market Intelligence Agent

**Purpose:** Maintain a living picture of the Canadian dental insurance AR market, track macro trends, identify tailwinds and threats, and surface insights that inform product direction and sales positioning. Run monthly. Feeds directly into: Product Manager, Client Acquisition, Competitive Intelligence.

---

## Market Context

CollectRx operates in Canadian dental insurance AR automation. The addressable market is every dental practice in Canada that bills private insurance — approximately 16,000 dental practices, of which ~85% accept private insurance. The six carriers supported (Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare) cover ~78% of the private dental market.

The pain: manual insurance follow-up averages 6-10 hours per week per practice at $25-35/hr billed to dental office staff. At $32/hr × 8 hours × 50 weeks = $12,800/year in staff cost per practice just for hold time.

---

## Monthly Research Agenda

### Canadian Dental Market

Search for recent data on:

- [ ] Total number of licensed dental practices in Canada (CDA, provincial dental associations)
- [ ] Growth rate of dental practice count (new practices, consolidation into DSOs)
- [ ] Percentage of practices billing private insurance vs. provincial
- [ ] Average outstanding AR per practice (CDA Practice Survey if available)
- [ ] DSO (Dental Service Organization) growth in Canada — these are high-value targets (multi-location = higher tier)
- [ ] Any news on Canadian Dental Care Plan (CDCP) expansion and its impact on AR workflows

### Insurance Carrier Landscape

- [ ] Any carrier consolidations or partnerships announced (e.g., carrier X acquiring Y)
- [ ] Any carrier portal upgrades that affect phone inquiry workflows (could change IVR structure)
- [ ] Any news about carriers increasing/decreasing claim processing times
- [ ] Sun Life, Canada Life, Manulife quarterly results — claims volume, dental segment performance
- [ ] TELUS Health / TELUS AdjudiCare product announcements (they actively build provider tools)

### Regulatory Environment

- [ ] CRTC 2026-132 status update (AI voice consultation — existential regulatory risk)
- [ ] Any OPC (Office of the Privacy Commissioner) guidance on AI and healthcare data
- [ ] Any CDA or dental association policy statements on AI in dental practice

### Macroeconomic Signals

- [ ] Canadian small business health (dental practices are mostly small businesses)
- [ ] Dental staff hiring market — if dental admin staff are scarce, AI automation is more valuable
- [ ] Canadian healthcare tech investment landscape (are competitors getting funded?)

---

## Output: Monthly Market Brief

```
## CollectRx Market Intelligence — [MONTH YEAR]

### Market Sizing (update quarterly)

Baseline TAM/SAM/SOM figures live in `docs/strategy/CollectRx_Strategic_Analysis.md` §4 — treat that doc as canonical and reconcile against it here rather than re-deriving numbers independently each month (two independently-maintained TAM/SAM estimates is exactly the kind of drift AA-23 found and fixed once already). If this month's research changes an assumption, update the strategic analysis doc directly and note the change here.

- Licensed dental practices in Canada: [n] (strategic analysis §4 TAM: ~16,000 dentists / ~10,000+ clinics)
- TAM (all practices billing private insurance): [n practices × $X avg contract value] — cross-check against strategic analysis §4 before publishing a different number
- SAM (practices accessible via CSV or AbelDent): [estimate] — cross-check against strategic analysis §4's SAM (~8,000–9,000 billing clinics, ~2,500–3,000 at 30% adoption ceiling)

### Key Developments This Month
- [Event] — [Implication for CollectRx]

### Carrier Intelligence
- [Any changes affecting IVR, processing times, portal availability]

### Regulatory Watch
- CRTC 2026-132: [status update]
- [Any other regulatory movement]

### Tailwinds (factors increasing demand for CollectRx)
- [List]

### Threats (factors reducing demand or creating risk)
- [List]

### Feeds Into
- Product Manager: [what market signals should change roadmap priority]
- Client Acquisition: [which segments to prioritize this month]
- Competitive Intelligence: [new entrants or competitor moves to watch]
```

---

## How to Run This Agent

```
"Run the CollectRx monthly market intelligence brief for [MONTH YEAR]. Search for: Canadian dental practice count, carrier news (Sun Life, Canada Life, Manulife, Green Shield, RBC, TELUS), CRTC 2026-132 status, Canadian dental staff market, DSO growth. Produce the report in the format defined in agents/market-intelligence.md. Flag any findings that should change near-term product or sales strategy."
```
