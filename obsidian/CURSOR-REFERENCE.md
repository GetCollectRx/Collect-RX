# Cursor ↔ Obsidian — reference map

**Purpose:** Give agents and humans a single place to see **what exists in this vault** and **what to open first**. Persistent behavior is also defined in **`.cursor/rules/obsidian-vault-context.mdc`** (`alwaysApply: true`).

**Vault root (repo-relative):** `obsidian/`

---

## Tier 1 — open before ambiguous product or architecture work

| File | Role |
|------|------|
| `obsidian/CLAUDE.md` | Handoff: stack, P1–P9 summary, canonical **`Collect-RX-main`**, legacy caveats |
| `obsidian/_MOC_COMMUNITY_Modules.md` | Thin hub: infra, pages, UI primitives, **triangle** habits |
| `OUTSTANDING-FIXES-PRODUCT-READY.md` | Repo root: phased backlog, **implementation truth** for “what’s next” |
| `docs/adr/0001-primary-application-stack.md` | Canonical stack ADR |
| `Collect-RX-main/README.md` | Run, seed, test, env |

---

## Tier 2 — `_COMMUNITY_*` module hubs (19)

Each file is `obsidian/<name>.md` and includes **`## Intentional links`**.

| Module note | Focus |
|-------------|--------|
| `_COMMUNITY_Server Module.md` | HTTP, jobs, auth, routes, desktop/electron touchpoints |
| `_COMMUNITY_Schema Module.md` | Benefits `schema` / `calculator` |
| `_COMMUNITY_Encryption Module.md` | `encryption.ts` |
| `_COMMUNITY_Connect Module.md` | Stripe Connect |
| `_COMMUNITY_Seedcdtcodes Module.md` | CDT seed |
| `_COMMUNITY_Preload Module.md` | Desktop preload / IPC |
| `_COMMUNITY_Login Module.md` | Login page cluster |
| `_COMMUNITY_Dashboard Module.md` | Dashboard page cluster |
| `_COMMUNITY_Pretreatmentestimate Module.md` | Pre-treatment estimate UI |
| `_COMMUNITY_Users Module.md` | Collect-RX dashboard / `MetricCard` slice |
| `_COMMUNITY_Modal Module.md` | Modal / stories |
| `_COMMUNITY_Bottomsheet Module.md` | Bottom sheet |
| `_COMMUNITY_Confirmmodal Module.md` | Confirm modal |
| `_COMMUNITY_Table Module.md` | Table |
| `_COMMUNITY_Card Module.md` | Card |
| `_COMMUNITY_Badge Module.md` | Badge |
| `_COMMUNITY_Label Module.md` | Label |
| `_COMMUNITY_Skeletonloader Module.md` | Skeleton loader |
| `_COMMUNITY_Coveragebreakdown Module.md` | Coverage breakdown |

---

## Tier 3 — graph snapshot

| File | Role |
|------|------|
| `obsidian/GRAPH_REPORT.md` | Point-in-time graphify report; may reference **older** corpus / `_COMMUNITY_Community N` notes not present in this folder — treat as **historical** |

---

## Tier 4 — leaf notes (auto-generated)

- **300+** symbol/file notes at vault root (plus hubs and reports): see count in `VAULT-FILE-INDEX.txt`.
- **Wikilink rule:** `[[Foo]]` → `obsidian/Foo.md` if that basename exists.
- **Stale paths:** Leaf `source_file` paths may point outside **`Collect-RX-main`**; validate against current tree before editing the wrong repo.

**Complete alphabetical list:** `obsidian/VAULT-FILE-INDEX.txt` — refresh from repo root with: `(cd obsidian && ls -1 *.md | sort > VAULT-FILE-INDEX.txt)`.

---

## Repo docs often used with the vault

- `docs/product/PHASE9-GTM.md`, `docs/product/MVP-SCOPE.md`
- `AUDIT-REPORT.md` (audit snapshot; verify dates)
