# Internationalization (i18n) — v1 decision (P7-08)

**Decision (2026):** CollectRx **v1 ships in English only**.

## Rationale

- Target market and operator workflows in the current pilot are **English-primary**.
- Shipping one locale keeps copy, support, and compliance review (P5) tractable.
- A future locale (e.g. Canadian French) should be a **dedicated** milestone: extract strings, choose an i18n layer (e.g. react-i18next or similar), legal review of patient-facing text, and QA of formatted dates/currency.

## What is *not* blocked

- **Locale-aware formatting** where it already makes sense (e.g. `Intl` for dates/currency in the UI) does not require a second language pack.
- **API messages** in English for v1 are acceptable; avoid hardcoding in multiple places to ease a later i18n pass.

## Revisit when

- A second locale is committed for a customer or region, *or* regulatory/marketing requires localized patient communications at scale.
