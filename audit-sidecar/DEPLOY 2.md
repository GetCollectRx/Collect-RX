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
- The NeMo config (`config/config.yml`) uses **OpenAI `gpt-4`**, so transcript text
  is sent to OpenAI. Confirm a zero-retention / DPA posture with OpenAI before
  processing real patient transcripts, or swap the model in `config.yml`.

## First deploy

```bash
cd audit-sidecar

# Create the app without deploying, and validate the committed fly.toml.
fly launch --no-deploy --name collect-rx-audit-sidecar --region yyz --copy-config
fly config validate

# Secrets on the sidecar:
fly secrets set -a collect-rx-audit-sidecar \
  SIDECAR_SHARED_SECRET="<same value used on the main app>" \
  OPENAI_API_KEY="<openai key>"

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
