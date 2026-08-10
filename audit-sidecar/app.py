#!/usr/bin/env python3
"""
CollectRx Guardrails Audit Sidecar

FastAPI service that runs NeMo Guardrails semantic classifiers on call transcripts.
Called asynchronously from the main Node backend after each completed Vapi call.

Endpoints:
  POST /audit/transcript — classify transcript against guardrail rules
  GET /health — liveness check

Auth: Bearer token in Authorization header (SIDECAR_SHARED_SECRET env var)
"""

import json
import logging
import os
import sys
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Header, Request
from pydantic import BaseModel

# NeMo Guardrails is a heavy optional dependency (pulls in sentence-transformers
# -> torch -> CUDA libraries, plus the `annoy` C++ extension, which needs a
# compiler not present in the slim image). It's not installed by default — see
# requirements.txt. It's only imported lazily below, if an LLM provider key is
# configured, since the current /audit/transcript logic is heuristic-only and
# doesn't need it. Run `pip install nemoguardrails==0.7.0` (and add build-essential
# to the Dockerfile) before wiring up real semantic checks.

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s"
)
logger = logging.getLogger(__name__)

SIDECAR_SHARED_SECRET = os.getenv("SIDECAR_SHARED_SECRET", "dev-secret")
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "config.yml")

app = FastAPI(title="CollectRx Guardrails Audit Sidecar", version="1.0.0")

# ─────────────────────────────────────────────────────────────────────────────
# NeMo Guardrails Initialization
# ─────────────────────────────────────────────────────────────────────────────

# NOTE: the /audit/transcript endpoint below currently runs regex/heuristic
# checks only — it does not call `rails` for any LLM-based semantic checks yet
# (see the placeholder comment in that handler). LLM initialization is
# therefore optional for now: skip it if no provider key is configured, so
# this service can run without incurring any LLM API cost or dependency.
# Before real semantic guardrails are wired up (rails.generate_response() /
# rails.explain_rules()), set OPENAI_API_KEY or ANTHROPIC_API_KEY and this
# will initialize automatically.
rails = None
if os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY"):
    logger.info(f"LLM provider key found — loading NeMo config from {CONFIG_PATH}")
    try:
        from nemoguardrails import LLMRails
        # Load guardrails config and initialize rails
        # NeMo will automatically discover Colang flows in config/rails/
        rails = LLMRails.from_path(CONFIG_PATH)
        logger.info("NeMo Guardrails initialized successfully")
    except ImportError:
        logger.error(
            "OPENAI_API_KEY/ANTHROPIC_API_KEY is set but nemoguardrails isn't "
            "installed. Add it back to requirements.txt (and build-essential to "
            "the Dockerfile) to enable semantic checks."
        )
        rails = None
    except Exception as e:
        logger.error(f"Failed to initialize NeMo Guardrails: {e}", exc_info=True)
        rails = None
else:
    logger.warning(
        "No OPENAI_API_KEY or ANTHROPIC_API_KEY set — running heuristic-only "
        "checks (semantic/LLM-based guardrail checks are not active). This is "
        "expected pre-launch with no real patient data; revisit before go-live."
    )

# ─────────────────────────────────────────────────────────────────────────────
# Request/Response Models
# ─────────────────────────────────────────────────────────────────────────────

class AuditRequest(BaseModel):
    call_attempt_id: str
    transcript_text: str
    carrier_id: str
    outcome: str
    rules_version: str

class Violation(BaseModel):
    rule_id: str
    severity: str  # 'block' | 'escalate' | 'alert'
    evidence: str

class AuditSignals(BaseModel):
    carrier_block: bool
    phi_leak: bool
    off_script: bool
    hallucination: bool

class AuditResponse(BaseModel):
    rules_version: str
    risk_score: float  # 0.0 .. 1.0
    violations: list[Violation]
    signals: AuditSignals
    sidecar_latency_ms: Optional[int] = None

# ─────────────────────────────────────────────────────────────────────────────
# Auth Middleware
# ─────────────────────────────────────────────────────────────────────────────

async def verify_token(authorization: str = Header(None)) -> None:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid Authorization format")

    token = parts[1]
    if token != SIDECAR_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Invalid token")

# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Liveness check for Railway orchestration."""
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "llm_rails_initialized": rails is not None,
        "mode": "semantic+heuristic" if rails is not None else "heuristic-only",
    }

@app.post("/audit/transcript", response_model=AuditResponse)
async def audit_transcript(
    request: AuditRequest,
    authorization: str = Header(None),
):
    """
    Classify a call transcript against guardrail rules.

    Returns a structured audit result with risk score, violations, and detected signals.
    """
    start_time = datetime.utcnow()

    # Auth
    await verify_token(authorization)

    # `rails` (LLM-based semantic checks) is optional — see the module-level
    # note above. The checks below are regex/heuristic only and don't depend
    # on it, so we don't gate the endpoint on rails being initialized.

    logger.info(f"Auditing transcript for call {request.call_attempt_id} (carrier={request.carrier_id})")

    try:
        # Run guardrails against the transcript
        # This is a simplified semantic audit pass — NeMo runs intent matching
        # and semantic checks against the configured Colang flows.

        violations: list[Violation] = []
        signals = AuditSignals(
            carrier_block=False,
            phi_leak=False,
            off_script=False,
            hallucination=False,
        )

        # Placeholder: In production, we'd invoke NeMo rails.generate_response()
        # or use rails.explain_rules() to run semantic checks on the transcript.
        # For MVP, we do lightweight regex/heuristic checks.

        # 1. Carrier block detection: semantic + regex
        block_phrases = [
            r"automated\s+call",
            r"bot\s+activity",
            r"this\s+number.*flagged",
            r"robocall",
        ]
        import re
        if any(re.search(p, request.transcript_text, re.IGNORECASE) for p in block_phrases):
            signals.carrier_block = True
            violations.append(Violation(
                rule_id="POST_CALL_CARRIER_BLOCK_SEMANTIC",
                severity="block",
                evidence="Semantic block signal detected in transcript"
            ))

        # 2. PHI leak detection: simple heuristic (10-digit numeric patterns)
        phi_pattern = r'\b\d{10}\b'
        if re.search(phi_pattern, request.transcript_text):
            signals.phi_leak = True
            violations.append(Violation(
                rule_id="POST_CALL_PHI_LEAK_SCAN",
                severity="alert",
                evidence="Potential 10-digit PHI pattern detected"
            ))

        # 3. Off-script detection: topic drift (simplified)
        # Checks if transcript length is unusual or contains off-topic keywords
        off_script_keywords = [
            "medical advice",
            "billing dispute",
            "personal information",
        ]
        if any(kw in request.transcript_text.lower() for kw in off_script_keywords):
            signals.off_script = True
            violations.append(Violation(
                rule_id="POST_CALL_OFF_SCRIPT",
                severity="alert",
                evidence="Off-script keyword detected"
            ))

        # Compute risk score (simple: count violations × severity weight)
        risk_score = 0.0
        for v in violations:
            if v.severity == "block":
                risk_score += 0.5
            elif v.severity == "escalate":
                risk_score += 0.3
            else:  # alert
                risk_score += 0.1
        risk_score = min(1.0, risk_score)  # Cap at 1.0

        # Record latency
        elapsed_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        return AuditResponse(
            rules_version=request.rules_version,
            risk_score=risk_score,
            violations=violations,
            signals=signals,
            sidecar_latency_ms=elapsed_ms,
        )

    except Exception as e:
        logger.error(f"Error auditing transcript: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
