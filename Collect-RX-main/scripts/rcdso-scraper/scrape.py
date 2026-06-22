#!/usr/bin/env python3
"""
RCDSO public register scraper for CollectRx prospect generation.

Searches the RCDSO member directory (rcdso.org/en-ca/find-a-dentist) by Ontario
city, filters for active general dentists, scores each prospect, and outputs a CSV.

Usage:
    python3 scrape.py                        # all cities in cities.txt
    python3 scrape.py --cities Toronto,Mississauga
    python3 scrape.py --output prospects.csv
    python3 scrape.py --dry-run              # print rows, no file written

Requirements:
    pip install requests beautifulsoup4 lxml

SELECTOR NOTES (update if RCDSO changes their markup):
    The RCDSO register is server-rendered HTML at:
        POST https://www.rcdso.org/en-ca/find-a-dentist
    Search fields:
        city (text), specialty (select), status (defaults to Active)
    Result rows are in <table class="member-results"> or similar.
    Run scrape.py --dump-html to see raw HTML for calibration.
"""

import argparse
import csv
import os
import sys
import time
import re
import json
import logging
from dataclasses import dataclass, fields, asdict
from typing import Optional
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Missing dependencies. Run: pip install requests beautifulsoup4 lxml")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

RCDSO_BASE = "https://www.rcdso.org"
RCDSO_SEARCH_URL = f"{RCDSO_BASE}/en-ca/find-a-dentist"

# Seconds between requests — stay polite to avoid IP blocks
REQUEST_DELAY = 2.5

# Max pages per city search (RCDSO paginates at ~25 results/page)
MAX_PAGES = 20

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-CA,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

ONTARIO_CITIES = [
    "Toronto", "Mississauga", "Brampton", "Hamilton", "London",
    "Markham", "Vaughan", "Kitchener", "Windsor", "Burlington",
    "Oakville", "Richmond Hill", "Oshawa", "Barrie", "St. Catharines",
    "Cambridge", "Kingston", "Guelph", "Thunder Bay", "Waterloo",
    "Pickering", "Ajax", "Whitby", "Newmarket", "Aurora",
    "Georgina", "Clarington", "Halton Hills", "Milton", "Caledon",
]

# Specialties that indicate a general practice (most insurance AR volume)
GP_PATTERNS = re.compile(
    r"general|family|gp|comprehensive|cosmetic",
    re.IGNORECASE,
)

# Patterns that flag a specialist — lower priority, different workflow
SPECIALIST_PATTERNS = re.compile(
    r"orthodont|periodon|endodon|oral surgeon|oral pathol|pediat|prosthodon|"
    r"dental public|dental anesthes|oral medicine",
    re.IGNORECASE,
)

# High-density markets get a scoring boost
HIGH_DENSITY_CITIES = {
    "Toronto", "Mississauga", "Brampton", "Hamilton", "London",
    "Markham", "Vaughan", "Kitchener", "Oakville", "Burlington",
    "Richmond Hill", "Oshawa",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("rcdso-scraper")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class Prospect:
    practiceName: str
    contactName: str
    email: str
    phone: str
    city: str
    province: str
    website: str
    pmsHint: str
    score: int
    source: str
    registrationNumber: str
    specialty: str
    address: str
    notes: str


# ---------------------------------------------------------------------------
# RCDSO search
# ---------------------------------------------------------------------------

def build_search_payload(city: str, page: int = 1) -> dict:
    """
    Form fields submitted to RCDSO member search.

    CALIBRATION NOTE: open the Network tab in Chrome DevTools on
    https://www.rcdso.org/en-ca/find-a-dentist, run a search, and
    capture the POST payload. Update field names here if they differ.
    Common field name patterns: 'City', 'city', 'MemberCity', 'txtCity'.
    """
    return {
        # Adjust these field names to match the live form:
        "City": city,
        "Status": "Active",
        "PageNumber": str(page),
        # Uncomment if the form requires these:
        # "Specialty": "",
        # "__RequestVerificationToken": _get_csrf(session),
    }


def get_csrf_token(session: requests.Session) -> Optional[str]:
    """
    Fetch the search page and extract CSRF token if present.
    Returns None if the form has no CSRF protection.
    """
    try:
        r = session.get(RCDSO_SEARCH_URL, headers=HEADERS, timeout=20)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        token_input = (
            soup.find("input", {"name": "__RequestVerificationToken"})
            or soup.find("input", {"name": "_token"})
        )
        if token_input:
            return token_input.get("value")
    except Exception as exc:
        log.warning("Could not fetch CSRF token: %s", exc)
    return None


def parse_results_page(html: str, city: str) -> list[Prospect]:
    """
    Parse one RCDSO search results page.

    CALIBRATION NOTE: inspect the actual HTML to confirm:
    - The results container selector (table, ul, div)
    - The fields available per row (name, address, phone, specialty)
    Update ROW_SELECTOR, NAME_SEL, ADDR_SEL, PHONE_SEL, SPEC_SEL below.
    """
    soup = BeautifulSoup(html, "lxml")

    # --- adjust these selectors to match live HTML ---
    # Try a few common patterns; first match wins
    rows = (
        soup.select("table.member-results tbody tr")
        or soup.select("table.search-results tbody tr")
        or soup.select(".member-listing .member-row")
        or soup.select(".dentist-listing li")
        or soup.select("tr.member")
    )

    if not rows:
        # Dump a snippet to help calibration
        log.debug("No rows found. Page snippet:\n%s", html[:2000])
        return []

    prospects = []
    for row in rows:
        text = lambda sel: (row.select_one(sel) or type("", (), {"get_text": lambda *a, **k: ""})()).get_text(strip=True)

        raw_name   = text("td.member-name, .member-name, td:nth-child(1)")
        raw_addr   = text("td.member-address, .member-address, td:nth-child(3)")
        raw_phone  = text("td.member-phone, .member-phone, td:nth-child(4)")
        raw_spec   = text("td.member-specialty, .member-specialty, td:nth-child(5)")
        raw_status = text("td.member-status, .member-status, td:nth-child(6)")
        reg_no     = text("td.member-reg, .registration-number, td:nth-child(2)")

        # Skip non-active or empty rows
        if raw_status and "active" not in raw_status.lower():
            continue
        if not raw_name:
            continue

        # Parse name — RCDSO lists "LAST, First Middle" or "First Last"
        contact_name = _normalize_name(raw_name)

        # Practice name: RCDSO does not always list separately; fall back to
        # "Dr. [Name] Dentistry" as a placeholder. CSV import lets you correct.
        practice_name = _infer_practice_name(raw_name, raw_addr)

        phone = _clean_phone(raw_phone)
        city_from_addr, province = _parse_city_province(raw_addr, city)
        score = compute_score(
            city=city_from_addr or city,
            specialty=raw_spec,
            has_phone=bool(phone),
        )

        prospects.append(Prospect(
            practiceName=practice_name,
            contactName=contact_name,
            email="",
            phone=phone,
            city=city_from_addr or city,
            province=province or "ON",
            website="",
            pmsHint="",
            score=score,
            source="rcdso",
            registrationNumber=reg_no,
            specialty=raw_spec,
            address=raw_addr,
            notes="",
        ))

    return prospects


def has_next_page(html: str) -> bool:
    """Return True if a 'Next' pagination link exists on the page."""
    soup = BeautifulSoup(html, "lxml")
    return bool(
        soup.select_one("a.next, a[rel='next'], .pagination .next:not(.disabled)")
    )


def scrape_city(session: requests.Session, city: str, csrf: Optional[str]) -> list[Prospect]:
    """Scrape all pages for a given city. Returns deduplicated prospects."""
    results: list[Prospect] = []
    seen_reg_nos: set[str] = set()

    for page in range(1, MAX_PAGES + 1):
        payload = build_search_payload(city, page)
        if csrf:
            payload["__RequestVerificationToken"] = csrf

        log.info("  city=%s page=%d", city, page)
        try:
            r = session.post(
                RCDSO_SEARCH_URL,
                data=payload,
                headers={**HEADERS, "Referer": RCDSO_SEARCH_URL},
                timeout=30,
            )
            r.raise_for_status()
        except requests.RequestException as exc:
            log.warning("  Request failed (city=%s page=%d): %s", city, page, exc)
            break

        html = r.text
        page_prospects = parse_results_page(html, city)

        for p in page_prospects:
            if p.registrationNumber and p.registrationNumber in seen_reg_nos:
                continue
            if p.registrationNumber:
                seen_reg_nos.add(p.registrationNumber)
            results.append(p)

        if not page_prospects or not has_next_page(html):
            break

        time.sleep(REQUEST_DELAY)

    return results


# ---------------------------------------------------------------------------
# Scoring rubric
# ---------------------------------------------------------------------------

def compute_score(city: str, specialty: str, has_phone: bool) -> int:
    """
    Score 0-100. Higher = more likely to have insurance AR burden
    and fewer internal resources to handle it.

    Rubric:
      Base:                          50
      GP / general dentist:         +15
      High-density Ontario market:  +10
      Has phone on record:          +5
      Specialist:                   -15
    """
    score = 50

    if specialty and GP_PATTERNS.search(specialty):
        score += 15
    elif specialty and SPECIALIST_PATTERNS.search(specialty):
        score -= 15

    if city.strip().title() in HIGH_DENSITY_CITIES:
        score += 10

    if has_phone:
        score += 5

    return max(0, min(100, score))


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def _normalize_name(raw: str) -> str:
    """Convert 'SMITH, John A' or 'Dr. John Smith' to 'John Smith'."""
    raw = raw.strip()
    # Remove titles
    raw = re.sub(r"^(Dr\.?\s+|Dr\s+)", "", raw, flags=re.IGNORECASE)
    # Handle "LAST, First" format
    if "," in raw:
        parts = raw.split(",", 1)
        last = parts[0].strip().title()
        first = parts[1].strip().title()
        return f"{first} {last}".strip()
    return raw.strip().title()


def _infer_practice_name(raw_name: str, raw_addr: str) -> str:
    """
    RCDSO does not always list the practice name separately.
    Use the normalized dentist name as a stand-in; the import step
    lets the user correct this before sending emails.
    """
    name = _normalize_name(raw_name)
    if name:
        return f"Dr. {name.split()[-1]} Dentistry"
    return "Dental Practice"


def _clean_phone(raw: str) -> str:
    """Strip formatting; return 10-digit number or empty string."""
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits[0] == "1":
        digits = digits[1:]
    return digits if len(digits) == 10 else ""


def _parse_city_province(raw_addr: str, fallback_city: str) -> tuple[str, str]:
    """
    Extract city and province from an address string.
    E.g. "123 Main St, Toronto, ON  M5V 1A1" -> ("Toronto", "ON")
    """
    # Match "City, ON" or "City ON" near end of string
    m = re.search(r",\s*([A-Za-z\s.]+),\s*(ON|AB|BC|MB|NB|NL|NS|NT|NU|PE|QC|SK|YT)\b", raw_addr)
    if m:
        return m.group(1).strip().title(), m.group(2).strip()
    m = re.search(r"\b([A-Za-z\s.]{3,}),?\s+(ON)\b", raw_addr)
    if m:
        return m.group(1).strip().title(), "ON"
    return fallback_city, "ON"


# ---------------------------------------------------------------------------
# CSV output
# ---------------------------------------------------------------------------

CSV_FIELDS = [f.name for f in fields(Prospect)]


def write_csv(prospects: list[Prospect], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for p in prospects:
            w.writerow(asdict(p))
    log.info("Wrote %d prospects to %s", len(prospects), path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Scrape RCDSO public register for CollectRx prospects")
    p.add_argument("--cities", help="Comma-separated city list (default: cities.txt)")
    p.add_argument("--output", default="prospects.csv", help="Output CSV path")
    p.add_argument("--dry-run", action="store_true", help="Print rows without writing file")
    p.add_argument("--dump-html", action="store_true", help="Dump raw HTML of first search and exit (for calibration)")
    p.add_argument("--delay", type=float, default=REQUEST_DELAY, help="Seconds between requests")
    return p.parse_args()


def load_cities(args: argparse.Namespace) -> list[str]:
    if args.cities:
        return [c.strip() for c in args.cities.split(",") if c.strip()]
    cities_file = Path(__file__).parent / "cities.txt"
    if cities_file.exists():
        return [l.strip() for l in cities_file.read_text().splitlines() if l.strip() and not l.startswith("#")]
    return ONTARIO_CITIES


def main() -> None:
    args = parse_args()
    global REQUEST_DELAY
    REQUEST_DELAY = args.delay

    cities = load_cities(args)
    log.info("Scraping %d cities: %s", len(cities), ", ".join(cities[:5]) + ("..." if len(cities) > 5 else ""))

    session = requests.Session()
    csrf = get_csrf_token(session)
    if csrf:
        log.info("CSRF token obtained")
    time.sleep(REQUEST_DELAY)

    if args.dump_html:
        payload = build_search_payload(cities[0], 1)
        if csrf:
            payload["__RequestVerificationToken"] = csrf
        r = session.post(RCDSO_SEARCH_URL, data=payload, headers=HEADERS, timeout=30)
        print(r.text[:5000])
        return

    all_prospects: list[Prospect] = []
    seen_reg: set[str] = set()

    for city in cities:
        log.info("Scraping city: %s", city)
        city_prospects = scrape_city(session, city, csrf)
        # Deduplicate across cities by registration number
        for p in city_prospects:
            if p.registrationNumber and p.registrationNumber in seen_reg:
                continue
            if p.registrationNumber:
                seen_reg.add(p.registrationNumber)
            all_prospects.append(p)
        log.info("  Found %d prospects in %s (running total: %d)", len(city_prospects), city, len(all_prospects))
        time.sleep(REQUEST_DELAY)

    # Sort descending by score
    all_prospects.sort(key=lambda x: x.score, reverse=True)

    if args.dry_run:
        for p in all_prospects[:20]:
            print(json.dumps(asdict(p), ensure_ascii=False))
        log.info("Dry run: %d total prospects", len(all_prospects))
        return

    write_csv(all_prospects, args.output)
    log.info("Done. Top prospect: %s (%d)", all_prospects[0].practiceName if all_prospects else "none", all_prospects[0].score if all_prospects else 0)


if __name__ == "__main__":
    main()
