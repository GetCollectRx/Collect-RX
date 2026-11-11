# Offline results: Silero VAD and a speech-recognition phrase gate

Run 2026-11-11, seed 1. **Quick run only:** 20 scripted pickups, 40 announcements, 5 hold hours per mode. Raw numbers in `results-quick-vad-asr.json`. The PRD-size run (100 pickups, 200 announcements, 100 hold hours) was not done: UNVERIFIED. No network, no telephony, no spend.

**Read first:** the corpus is a synthetic proxy (see `README.md`). The recogniser used, pocketsphinx, is free and weak on telephone speech. It is a stand-in so the pipeline can be exercised, and it says nothing about a production recogniser such as Deepgram Nova-3, which was not tested because no key or spend cap exists.

## Result

| Detector | Pickups within 2 s (of 20) | False pickups, hold music only (per 100 hold hours) | False pickups with announcements (per 100 hold hours) | Announcements that fired (of 40) |
|---|---|---|---|---|
| Production energy (baseline, earlier 100/200/20 h run) | 2% of 100 | about 5,035 | about 5,705 | 200 of 200 |
| Silero VAD only | 8 | 40 | 3,180 | 35 |
| Silero VAD plus pocketsphinx phrase gate | 3 (6 late) | 40 | 3,200 | 35 |
| PRD threshold | 95% | 1 | n/a | at most 2% |

## What this shows

1. **Silero VAD fixes the music problem.** False pickups on music alone fall from about 5,035 to 40 per 100 hold hours, because it separates speech from music where a loudness trigger cannot. 40 is still far above the PRD's 1, and my music is synthetic and has no vocals. Real hold music with singing or spoken passages may fire it more. UNVERIFIED on real audio.
2. **A speech detector cannot tell a recording from a person.** Both Silero variants fire on 35 of 40 announcements, because an announcement is speech. This is the case the PRD calls human-sounding announcements, and it needs a second signal.
3. **The free recogniser does not provide that signal.** Pocketsphinx transcribed telephone-band speech badly (for example "your call is important to us" came back as "your colleague people are going to leave the guy"), so the phrase gate rarely recognised an announcement. It also delayed decisions: 6 of 20 pickups came late.
4. **Whether a production recogniser fixes it is unknown.** That needs a measurement, and an overlap risk remains: a rep greeting ("thank you for calling") shares words with automated lines.

## What I did not test

| Item | Why |
|---|---|
| A production recogniser (Deepgram Nova-3, PRD cost basis) | No key, no spend cap. The backend is a stub in `asr.py`. |
| Another free recogniser | Whisper and Vosk models are hosted on sites the sandbox proxy blocks. |
| Cues other than words (recorded-audio signatures, repetition across calls, fixed prosody) | Not built. Worth testing: carrier announcements repeat identically, which a fingerprint could exploit with real recordings. |
| Full-size runs | Quick run only. |

## Next steps, in order

| Step | Needs |
|---|---|
| Decide the ASR backend: a Deepgram key and a spend cap (the cost is small per minute), or a local whisper-class model brought in another way | Khalid |
| Run the phrase gate with that backend on the same corpus | The above |
| Test an announcement fingerprint (repeated identical audio) | Real recordings, so the carrier terms check first |
