#!/usr/bin/env python3
"""
Import prospects from scrape.py CSV into the CollectRx API.

Reads the CSV written by scrape.py and POSTs each row to
POST /api/partnerships/prospects. Skips rows already in the API
(matched by practiceName + city).

Usage:
    python3 import_csv.py --file prospects.csv --api-url https://your-railway-url.railway.app
    python3 import_csv.py --file prospects.csv --api-url http://localhost:3001 --dry-run

Environment variables (alternative to CLI flags):
    COLLECTRX_API_URL    Base URL of your deployed Railway app
    COLLECTRX_API_TOKEN  Bearer token for a platform admin account

Security: never hardcode the token. Pass it via env var or --token flag.
The token is a JWT from the CollectRx login endpoint, belonging to a
platform-admin account. Do not commit it to source control.
"""

import argparse
import csv
import json
import os
import sys
import time
import logging
from pathlib import Path

try:
    import requests
except ImportError:
    print("Missing dependency. Run: pip install requests")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("rcdso-import")

REQUEST_DELAY = 0.3  # seconds between API calls
BULK_BATCH_SIZE = 100  # rows per bulk-import request


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Import RCDSO prospects CSV into CollectRx API")
    p.add_argument("--file", required=True, help="Path to prospects.csv from scrape.py")
    p.add_argument("--api-url", default=os.environ.get("COLLECTRX_API_URL", ""), help="Base URL of CollectRx API")
    p.add_argument("--token", default=os.environ.get("COLLECTRX_API_TOKEN", ""), help="Bearer token for platform admin")
    p.add_argument("--min-score", type=int, default=55, help="Only import prospects at or above this score (default: 55)")
    p.add_argument("--limit", type=int, default=0, help="Max prospects to import (0 = all)")
    p.add_argument("--dry-run", action="store_true", help="Print what would be imported without POSTing")
    p.add_argument("--delay", type=float, default=REQUEST_DELAY, help="Seconds between API requests")
    return p.parse_args()


def load_csv(path: str) -> list[dict]:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def build_prospect_payload(row: dict) -> dict:
    """Map CSV columns to the POST /api/partnerships/prospects body."""
    score = int(row.get("score", 50) or 50)
    return {
        "practiceName": row.get("practiceName", "").strip() or "Unknown Practice",
        "contactName":  row.get("contactName", "").strip() or None,
        "email":        row.get("email", "").strip() or None,
        "phone":        row.get("phone", "").strip() or None,
        "city":         row.get("city", "").strip() or None,
        "province":     row.get("province", "ON").strip() or "ON",
        "website":      row.get("website", "").strip() or None,
        "pmsHint":      row.get("pmsHint", "").strip() or None,
        "score":        score,
        "source":       "rcdso",
    }


def import_prospects(
    rows: list[dict],
    api_url: str,
    token: str,
    min_score: int,
    limit: int,
    dry_run: bool,
    delay: float,
) -> None:
    bulk_endpoint = f"{api_url.rstrip('/')}/api/partnerships/prospects/bulk-import"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    eligible = [r for r in rows if int(r.get("score", 0) or 0) >= min_score]
    eligible.sort(key=lambda r: int(r.get("score", 0) or 0), reverse=True)

    if limit:
        eligible = eligible[:limit]

    log.info(
        "Importing %d prospects (min_score=%d, limit=%d)",
        len(eligible), min_score, limit or len(eligible),
    )

    if dry_run:
        for row in eligible[:20]:
            print(json.dumps(build_prospect_payload(row), ensure_ascii=False))
        log.info("Dry run: %d eligible prospects", len(eligible))
        return

    total_created = 0
    total_skipped = 0
    total_errors: list[str] = []

    # Send in batches of BULK_BATCH_SIZE
    for batch_start in range(0, len(eligible), BULK_BATCH_SIZE):
        batch = eligible[batch_start:batch_start + BULK_BATCH_SIZE]
        payloads = [build_prospect_payload(r) for r in batch]

        try:
            resp = requests.post(
                bulk_endpoint,
                json={"prospects": payloads},
                headers=headers,
                timeout=60,
            )
            resp.raise_for_status()
            data = resp.json().get("data", {})
            created = data.get("created", 0)
            skipped = data.get("skipped", 0)
            errs = data.get("errors", [])
            total_created += created
            total_skipped += skipped
            total_errors.extend(errs)
            log.info(
                "  Batch %d-%d: created=%d skipped=%d errors=%d",
                batch_start + 1, batch_start + len(batch), created, skipped, len(errs),
            )
        except requests.RequestException as exc:
            log.warning("  Batch %d-%d failed: %s", batch_start + 1, batch_start + len(batch), exc)
            total_errors.append(str(exc))

        time.sleep(delay)

    log.info("Done. created=%d skipped=%d errors=%d", total_created, total_skipped, len(total_errors))
    if total_errors:
        log.warning("First errors: %s", "; ".join(total_errors[:5]))


def main() -> None:
    args = parse_args()

    if not Path(args.file).exists():
        log.error("CSV file not found: %s", args.file)
        sys.exit(1)

    if not args.dry_run:
        if not args.api_url:
            log.error("--api-url or COLLECTRX_API_URL required")
            sys.exit(1)
        if not args.token:
            log.error("--token or COLLECTRX_API_TOKEN required")
            sys.exit(1)

    rows = load_csv(args.file)
    log.info("Loaded %d rows from %s", len(rows), args.file)

    import_prospects(
        rows=rows,
        api_url=args.api_url,
        token=args.token,
        min_score=args.min_score,
        limit=args.limit,
        dry_run=args.dry_run,
        delay=args.delay,
    )


if __name__ == "__main__":
    main()
