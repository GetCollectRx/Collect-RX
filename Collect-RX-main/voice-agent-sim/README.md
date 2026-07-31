# Voice agent scenario master spreadsheet

**Cannot edit Google Sheets directly from the repo** — import these CSVs instead.

## Files

| File | Purpose |
|------|---------|
| `SCENARIO-MASTER.csv` | **Main catalog** — every planned scenario with tier, layer, harness, status |
| `COVERAGE-MATRIX.csv` | Carrier × category counts + P0/P1 pass tracking columns |
| `TIER-SUMMARY.csv` | Counts by P0 / P1 / P2 |
| `generate-scenario-master.mjs` | Regenerate after adding rows in code |

## Open in Google Sheets

1. [Google Sheets](https://sheets.google.com) → **Blank spreadsheet**
2. **File → Import → Upload** → `SCENARIO-MASTER.csv`
3. **Import location:** Replace current sheet (or append as new sheet)
4. Repeat for `COVERAGE-MATRIX.csv` and `TIER-SUMMARY.csv` as **additional sheets**

Or open in **Excel / Numbers** locally.

## Columns (SCENARIO-MASTER)

| Column | Use |
|--------|-----|
| `scenario_id` | Stable ID (S001, O-A-sun_life, IVR-HP-manulife, …) |
| `tier` | **P0** = before live dial · **P1** = before 2nd practice · **P2** = regression |
| `layer` | dispatch · ivr · conversation · handoff · post_call · ops |
| `harness` | How to run: `vitest_agents`, `eval_conversation`, `ivr_research_call`, `manual_pilot` |
| `status` | `planned` → `pass` / `fail` / `blocked` (edit in Sheets as you run) |
| `automation_ref` | Repo script or test path |

## Regenerate

```bash
node Collect-RX-main/voice-agent-sim/generate-scenario-master.mjs
```

Edit `generate-scenario-master.mjs` to add carriers, categories, or combinatorial blocks — then re-run.

## “Every scenario possible”

Literal infinity (reps say anything). This catalog is the **closed-world matrix**:

- Scratchpad S001–S025 + error recovery E001–E010  
- Trainer T001–T010  
- Robustness R001–R010 (wired to `eval:conversation-robustness`)  
- Outcome taxonomy A–J × 6 carriers (60 rows)  
- IVR types × carriers (~46 rows)  
- Dispatch D001–D020  
- Handoffs H001–H015  
- Post-call fixtures P001–P030  
- Ops pilot X001–X010  
- Carrier-specific extras  

Add rows weekly from real pilot calls; keep `status` updated in Sheets.
