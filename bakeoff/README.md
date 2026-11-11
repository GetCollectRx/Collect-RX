# Bake-off offline corpus (Option A versus Option B)

Throwaway harness. Python only, outside the shipped app, no network, no telephony, no spend.
Written 2026-11-11 for Phase 1 of `docs/operations/OPTION-B-BAKEOFF-PLAN.md`.

## What it does

`corpus.py` generates hold audio from a seed: chord-progression "hold music", machine announcements
and rep greetings (espeak-ng speech), room noise, all band-limited to the telephone band and run
through G.711 mu-law, which is what a Twilio Media Stream carries. `evaluate.py` scores a detector
against the PRD thresholds. `detectors.py` holds the detectors under test.

```bash
python3 evaluate.py --quick                       # about a minute
python3 evaluate.py --hours 20                    # baseline run used in the results note
python3 evaluate.py --hours 100                   # the PRD figure; slow
python3 evaluate.py --export-samples              # writes WAVs to corpus-sample/ to listen to
```

Needs `numpy`, `ffmpeg`, `espeak-ng`.

## Limits, stated first

| Limit | Effect |
|---|---|
| No real carrier audio has been recorded. Music is synthesised and speech is machine speech. | A detector that passes here is NOT shown to pass on real lines. A detector that fails here probably fails there, but the margins are not real. |
| Music loudness (-50 to -14 dBFS) and announcement loudness (-30 to -18 dBFS) are assumed. | Results are reported by level so the dependence is visible. |
| Machine announcements and rep greetings are both espeak speech, so they sound alike to a spectral detector. Real recorded announcements often differ from live speech (compression, fixed prosody). | This may make the announcement test harder than reality. A real corpus is needed before trusting it. |
| Pickup is labelled at the start of the greeting audio. Real calls have clicks, tone changes and partial words before it. | Latency figures are optimistic. |
| The "per 100 hold hours" figure is scaled from the hours actually run. | Fewer hours means a coarse estimate. |

## Adding a detector

Implement `detect(mulaw_frames) -> list[float]` in `detectors.py`, add it to `DETECTORS`, rerun.
The PRD's intended hold layer uses streaming speech recognition, which needs an ASR engine and
real or TTS audio. That is the next detector to add, not part of this baseline.
