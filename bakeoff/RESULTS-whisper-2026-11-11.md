# Offline results: Silero VAD plus a Whisper phrase gate (free, local)

Run 2026-11-11, seed 1. **Quick run only:** 20 scripted pickups, 40 announcements, 5 hold hours per mode. Raw numbers in `results-quick-whisper.json`. The PRD-size run was not done: UNVERIFIED. No network, no telephony, no spend. Recogniser: Whisper small.en (int8) through sherpa-onnx, free and local. It is a stand-in for the PRD's Deepgram Nova-3, not the same engine.

**Read first:** the corpus is a synthetic proxy (see `README.md`). The phrase gate is a hand-written word list, and I wrote it after reading the synthetic announcements, so it is partly tuned to this corpus. Real carrier recordings would likely do worse.

## Result

| Detector | Pickups within 2 s (of 20) | Announcements that fired (of 40) | False pickups, music only (per 100 hold hours) | False pickups with announcements (per 100 hold hours) |
|---|---|---|---|---|
| Production energy (earlier full baseline) | 2% of 100 | 200 of 200 | about 5,035 | about 5,705 |
| Silero VAD only | 8 | 35 | 40 | 3,180 |
| VAD plus pocketsphinx gate | 3 | 35 | 40 | 3,200 |
| VAD plus Whisper gate, 1.5 s window | 5 (7 late) | 30 | 40 | 2,980 |
| VAD plus Whisper gate, 3.0 s window | 0 (14 late) | 17 | 40 | 2,580 |
| PRD threshold | 95% | at most 2% | 1 | n/a |

## What this shows

1. **Better recognition helps only a little.** Whisper transcribes clean announcements almost word for word, but the gate still lets 30 of 40 announcements through at 1.5 s and 17 of 40 at 3.0 s. Without music under the announcement the 3.0 s gate misses only 1 of 7. With music underneath, Whisper degrades and the gate misses more.
2. **There is a latency versus accuracy trade-off with no good point.** Short windows catch too little of the phrase ("Your call is important" is one strong word, "Thank you for phoning" is none). A 3.0 s window fits the PRD's 2 s pickup target badly: no pickup was within 2 s.
3. **Vocabulary overlap is the core problem.** "Thank you for holding" and "thank you for calling" are said by recordings and by reps. A word-list gate cannot separate them. Some announcements carry no hold words in the first seconds ("Did you know you can check your claim status online").
4. **Music was solved earlier, not here.** The 40 per 100 hold hours on music alone comes from the VAD stage and is unchanged by the gate.

## Conclusion

No free detector tested clears the PRD thresholds on this proxy corpus. A word-based gate on the opening words is not sufficient evidence of a human, so the PRD's "speech recognition plus hold-phrase matching" idea needs more than keywords. The remaining ideas are untested:

| Idea | Needs |
|---|---|
| A production recogniser with streaming partials (Deepgram Nova-3) | Key and spend cap. May improve accuracy under music. Will not remove the vocabulary overlap. |
| Fingerprint repeated announcements (carriers play identical audio) | Real calls in a pilot, in shadow mode |
| Acoustic cues around pickup (music cuts abruptly, line noise, tone change) | Real calls in a pilot, in shadow mode |
| A fixed, content-free prompt that a person answers and a recording does not | A product and compliance decision. The PRD allows one fixed line only in the autonomous ending. |
| Longer decision windows with the missed-call path as the safety net | A product decision on how many seconds a rep will wait |
