# Guardrail audit sidecar — Fly deployment

The sidecar is a Python/FastAPI service (`app.py`, uvicorn on `:8000`) that runs
NeMo Guardrails checks (`phi_leak`, `carrier_block`, `off_script`) over completed
call transcripts. The main app's guardrail worker POSTs to `POST /audit/transcript`;
a non-`SIDECAR_URL` environment disables it (the outbox then accumulates unaudited —
see the boot warning in `src/server/index.ts`).

It previously ran as a Railway service. Railway is decommissioned; it now runs as
its own Fly app, reached by the main app over the Fly private network.

## Data residency & PHI

- Transcript text is **PHI**. The app is pinned to `yyz` and is **internal-only**
  (no public IP; see `fly.toml`). Reach it only via
  `http://collect-rx-audit-sidecar.internal:8000`.
- **As of Aug 2026, the `/audit/transcript` endpoint in `app.py` is a regex/heuristic
  MVP — it does not actually call the LLM.** `LLMRails` initialization (and the
  `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` it needs) is optional and only attempted if
  one of those env vars is set; without one, the service runs heuristic-only checks
  and logs a warning at boot. This was done deliberately to deploy the sidecar
  without an LLM dependency while there's no real patient data yet.
- **Before going live with real patient data**, decide on a real semantic-check
  implementation (wire up `rails.generate_response()` / `rails.explain_rules()` in
  `app.py`), pick a provider, and confirm a zero-retention / DPA posture with
  whichever LLM vendor is used before transcript text is sent to it.

## First deploy

```bash
cd audit-sidecar

# Create the app without deploying, and validate the committed fly.toml.
fly launch --no-deploy --name collect-rx-audit-sidecar --region yyz --copy-config
fly config validate

# Only secret required for the current heuristic-only mode:
fly secrets set -a collect-rx-audit-sidecar \
  SIDECAR_SHARED_SECRET="<same value used on the main app>"

# Optional — only needed once real LLM-based checks are wired up in app.py:
# fly secrets set -a collect-rx-audit-sidecar OPENAI_API_KEY="..."   # or ANTHROPIC_API_KEY="..."

fly deploy -a collect-rx-audit-sidecar
```

## Wire the main app to it

Set on the main `collect-rx` app so the worker starts draining the audit outbox:

```bash
fly secrets set -a collect-rx \
  SIDECAR_URL="http://collect-rx-audit-sidecar.internal:8000" \
  SIDECAR_SHARED_SECRET="<same value as the sidecar>"
```

`SIDECAR_SHARED_SECRET` must match on both apps — the worker sends it as a Bearer
token and the sidecar rejects mismatches with 401.

## Verify

```bash
fly status -a collect-rx-audit-sidecar
# From a main-app machine (private network), the health check should return ok:
fly ssh console -a collect-rx -C "curl -fs http://collect-rx-audit-sidecar.internal:8000/health"
```

After `SIDECAR_URL` is set, the main app logs `[server] Guardrail audit worker started`
instead of the CRITICAL "guardrail audit is DISABLED" warning.
