# Offline baseline: the production hold-park detector against the synthetic corpus

Run 2026-11-11, seed 1, `python3 evaluate.py --hours 20`. Wall time 260 s. No network, no telephony, no spend.
Detector: `production-energy`, a port of the trigger in `src/webhooks/holdParkAudioStream.ts`.

**Read first:** the corpus is a synthetic proxy (synthesised music, espeak-ng speech, assumed loudness). It is not real carrier audio. See `README.md` for every limit. These numbers show the design is unsuitable. They are not a measurement of how it behaves on a real line.

## Result against the PRD thresholds

| PRD measure | PRD threshold | Result | Verdict |
|---|---|---|---|
| Scripted pickups detected within 2 s | at least 100 runs, 95% | 100 runs, 2% (98 fired before the pickup) | FAIL |
| False pickups on hold audio | at most 1 per 100 hold hours | about 5,035 per 100 hold hours (music only, 20 h run) | FAIL |
| False pickups with machine announcements | at most 2% of 200 | 200 of 200 (100%) | FAIL |
| Missed pickups | 0 of 100 | 0 of 100 | Pass, but meaningless: it fires on everything |
| Rep wait within limit | 95% of runs | Not measured. Needs the live path. | UNVERIFIED |
| Option B cost per hold minute | $0.035 or less | Not measured. Needs vendor bills. | UNVERIFIED |

## Why it fails

The detector triggers when 8 of the last 15 frames (20 ms each) exceed an RMS of 400, about -38 dBFS. It measures loudness, so it cannot tell music or a recorded announcement from a person.

| Probe | Triggers per 120 s of music |
|---|---|
| Music at -60 and -50 dBFS | 0 |
| Music at -44 dBFS and louder | 2 (the 60 s refractory window caps it) |

So any hold music above about -44 dBFS fires it, and a line carrying music fires it immediately. The code comment says hold music "sat at 0"; the likely cause is that the engineering test parked a call that carried silence, not carrier music.

## What this means

1. The current listener cannot serve as the PRD's hold layer. It is labelled "engineering test only" in the source, and this confirms it.
2. A loudness trigger is not enough for any design. Option B needs a detector that separates music, machine announcements and live speech.
3. The PRD's intended approach (streaming speech recognition plus hold-phrase matching) is the next detector to test. It needs an ASR engine and real or TTS-based audio. It is not in this baseline.
4. The hardest case will be a rep greeting that sounds like an automated line ("thank you for calling"). The corpus includes that overlap on purpose.

## Next steps

| Step | Needs |
|---|---|
| Validate on real staff-handled calls in shadow mode during a pilot: the detector logs decisions, timestamps and numeric features, no audio retained, compared with the staff-transfer time and Claims_Scribe's record. Needs a live pilot. | A live call path and a pilot practice. Not started. |
| Add an ASR-based detector and rerun | An ASR engine and a spend decision if it is a paid service |
| Raise the run to the full 100 hold hours for any detector that passes at 20 | Time only |
