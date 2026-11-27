"""Offline bake-off evaluation. No network, no telephony, no spend.

  python3 evaluate.py --pickups 100 --announcements 200 --hours 100 --seed 1
  python3 evaluate.py --quick            (small run, about a minute)
  python3 evaluate.py --export-samples   (writes a few WAV files to corpus-sample/ to listen to)

Thresholds are the PRD's starting figures (Hybrid Call Flow and Expansion, bake-off table).
"""
from __future__ import annotations

import argparse
import json
import time
import wave
from pathlib import Path

import numpy as np

from corpus import FRAME, HOLD_ANNOUNCEMENTS, REP_GREETINGS, SR, frames, music_track, rms, room_noise, scale_to_dbfs, speech, through_mulaw
from detectors import DETECTORS, Detector

LEVEL_BUCKETS = [(-50.0, -38.0), (-38.0, -28.0), (-28.0, -22.0), (-22.0, -14.0)]
HERE = Path(__file__).parent


def trim(x: np.ndarray, floor_dbfs: float = -50.0) -> np.ndarray:
    thr = 32768.0 * 10 ** (floor_dbfs / 20.0)
    idx = np.nonzero(np.abs(x) > thr)[0]
    return x[idx[0]: idx[-1] + 1] if len(idx) else x


def pickup_clip(seed: int) -> tuple[np.ndarray, float, dict]:
    rng = np.random.default_rng(seed)
    hold_s = float(rng.uniform(20, 120))
    music_db = float(rng.uniform(-50, -14))
    noise_db = float(rng.uniform(-55, -45))
    gap_s = float(rng.uniform(0.0, 1.5))
    greet_db = float(rng.uniform(-30, -18))
    n_hold = int(hold_s * SR)
    music = music_track(int(rng.integers(0, 2**31)), hold_s, music_db)
    # a couple of machine announcements during the hold, on top of the music
    for _ in range(int(rng.integers(0, 3))):
        ann = trim(speech(HOLD_ANNOUNCEMENTS[int(rng.integers(0, len(HOLD_ANNOUNCEMENTS)))], int(rng.integers(0, 2**31)), float(rng.uniform(-30, -18))))
        if len(ann) + SR < n_hold - 5 * SR:
            at = int(rng.integers(SR, n_hold - len(ann) - 5 * SR))
            music[at: at + len(ann)] += ann
    greet = trim(speech(REP_GREETINGS[int(rng.integers(0, len(REP_GREETINGS)))], int(rng.integers(0, 2**31)), greet_db))
    tail = int(2.5 * SR)
    total = n_hold + int(gap_s * SR) + len(greet) + tail
    sig = room_noise(int(rng.integers(0, 2**31)), total / SR, noise_db)[:total].copy()
    sig[:n_hold] += music
    start = n_hold + int(gap_s * SR)
    sig[start: start + len(greet)] += greet
    return sig, start / SR, {"holdSeconds": round(hold_s, 1), "musicDbfs": round(music_db, 1), "gapSeconds": round(gap_s, 2), "greetingDbfs": round(greet_db, 1)}


def announcement_clip(seed: int) -> tuple[np.ndarray, float, dict]:
    rng = np.random.default_rng(seed)
    music_db = float(rng.uniform(-50, -14)) if rng.random() < 0.8 else -90.0  # some lines carry speech with no music
    ann_db = float(rng.uniform(-30, -18))
    lead = float(rng.uniform(5, 30))
    ann = trim(speech(HOLD_ANNOUNCEMENTS[int(rng.integers(0, len(HOLD_ANNOUNCEMENTS)))], int(rng.integers(0, 2**31)), ann_db))
    total = int((lead + len(ann) / SR + 4.0) * SR)
    sig = room_noise(int(rng.integers(0, 2**31)), total / SR, float(rng.uniform(-55, -45)))[:total].copy()
    if music_db > -80:
        sig += music_track(int(rng.integers(0, 2**31)), total / SR, music_db)[:total]
    at = int(lead * SR)
    sig[at: at + len(ann)] += ann
    return sig, lead, {"musicDbfs": round(music_db, 1), "announcementDbfs": round(ann_db, 1)}


def run_pickups(det: Detector, n: int, seed: int) -> dict:
    results = {"detected_within_2s": 0, "late": 0, "missed": 0, "false_before_pickup": 0, "latencies": []}
    by_bucket: dict[str, dict[str, int]] = {}
    for i in range(n):
        sig, start, meta = pickup_clip(seed * 100003 + i)
        trig = det.detect(frames(through_mulaw(sig)))
        label = "ok"
        if any(t < start for t in trig):
            results["false_before_pickup"] += 1
            label = "false_before_pickup"
        else:
            after = [t for t in trig if t >= start]
            if not after:
                results["missed"] += 1
                label = "missed"
            elif after[0] - start <= 2.0:
                results["detected_within_2s"] += 1
                results["latencies"].append(after[0] - start)
            else:
                results["late"] += 1
                label = "late"
        for lo, hi in LEVEL_BUCKETS:
            if lo <= meta["musicDbfs"] < hi or (hi == -14.0 and meta["musicDbfs"] == hi):
                key = f"music {lo:.0f} to {hi:.0f} dBFS"
                b = by_bucket.setdefault(key, {"n": 0, "pass": 0})
                b["n"] += 1
                b["pass"] += 1 if label == "ok" else 0
    lat = results.pop("latencies")
    results["latencyMedianSeconds"] = round(float(np.median(lat)), 2) if lat else None
    results["n"] = n
    results["passRate"] = round(results["detected_within_2s"] / n, 3)
    results["byMusicLevel"] = by_bucket
    return results


def run_announcements(det: Detector, n: int, seed: int) -> dict:
    false = 0
    by_bucket: dict[str, dict[str, int]] = {}
    for i in range(n):
        sig, _lead, meta = announcement_clip(seed * 7919 + i)
        fired = len(det.detect(frames(through_mulaw(sig)))) > 0
        false += 1 if fired else 0
        db = meta["musicDbfs"]
        key = "no music" if db < -80 else next((f"music {lo:.0f} to {hi:.0f} dBFS" for lo, hi in LEVEL_BUCKETS if lo <= db <= hi), "other")
        b = by_bucket.setdefault(key, {"n": 0, "false": 0})
        b["n"] += 1
        b["false"] += 1 if fired else 0
    return {"n": n, "falsePickups": false, "falseRate": round(false / n, 3), "byMusicLevel": by_bucket}


def run_hold_hours(det: Detector, hours: float, seed: int, announcements: bool = True) -> dict:
    rng = np.random.default_rng(seed)
    seg_s = 600
    n_seg = max(1, int(round(hours * 3600 / seg_s)))
    base = [music_track(int(rng.integers(0, 2**31)), 300, -20.0) for _ in range(8)]
    anns = [trim(speech(t, 1000 + k, -22.0)) for k, t in enumerate(HOLD_ANNOUNCEMENTS)]
    false = 0
    by_bucket: dict[str, dict[str, float]] = {}
    for s in range(n_seg):
        db = float(rng.uniform(-50, -14))
        track = np.roll(base[int(rng.integers(0, len(base)))], int(rng.integers(0, 300 * SR)))
        music = scale_to_dbfs(np.tile(track, 2), db)[: seg_s * SR]
        noise = room_noise(int(rng.integers(0, 2**31)), seg_s, float(rng.uniform(-55, -45)))[: seg_s * SR]
        sig = music + noise
        t = float(rng.uniform(10, 60))
        while announcements and t < seg_s - 15:  # machine announcements every 30 to 120 s
            a = anns[int(rng.integers(0, len(anns)))] * float(10 ** (rng.uniform(-6, 4) / 20))
            i0 = int(t * SR)
            sig[i0: i0 + len(a)] += a
            t += float(rng.uniform(30, 120))
        n_fire = len(det.detect(frames(through_mulaw(sig))))
        false += n_fire
        key = next((f"music {lo:.0f} to {hi:.0f} dBFS" for lo, hi in LEVEL_BUCKETS if lo <= db <= hi), "other")
        b = by_bucket.setdefault(key, {"hours": 0.0, "falsePickups": 0})
        b["hours"] = round(b["hours"] + seg_s / 3600, 2)
        b["falsePickups"] += n_fire
    total_h = n_seg * seg_s / 3600
    return {"holdHours": round(total_h, 1), "falsePickups": false, "per100Hours": round(false * 100 / total_h, 1), "byMusicLevel": by_bucket}


def export_samples(seed: int) -> None:
    out = HERE / "corpus-sample"
    out.mkdir(exist_ok=True)
    def write(name: str, sig: np.ndarray) -> None:
        pcm = np.clip(np.round(sig), -32768, 32767).astype("<i2")
        with wave.open(str(out / name), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    for i in range(3):
        sig, start, meta = pickup_clip(seed + i)
        write(f"pickup-{i}-at-{start:.1f}s.wav", sig)
        (out / f"pickup-{i}.json").write_text(json.dumps({"pickupSeconds": round(start, 2), **meta}, indent=2))
    for i in range(3):
        sig, lead, meta = announcement_clip(seed + 50 + i)
        write(f"announcement-{i}-at-{lead:.1f}s.wav", sig)
    print(f"wrote samples to {out}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pickups", type=int, default=100)
    ap.add_argument("--announcements", type=int, default=200)
    ap.add_argument("--hours", type=float, default=100.0)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--export-samples", action="store_true")
    ap.add_argument("--out", default=str(HERE / "results.json"))
    ap.add_argument("--only", default="", help="run only detectors whose name contains this text")
    a = ap.parse_args()
    if a.export_samples:
        export_samples(a.seed)
        return
    if a.quick:
        a.pickups, a.announcements, a.hours = 20, 40, 5.0
    report: dict = {"seed": a.seed, "corpus": "synthetic proxy (espeak-ng speech, synthesised chords); see README", "detectors": {}}
    for det in [d for d in DETECTORS if a.only in d.name]:
        t0 = time.time()
        cap = getattr(det, "hour_cap", None)
        hours = min(a.hours, cap) if cap else a.hours
        report["detectors"][det.name] = {
            "pickups": run_pickups(det, a.pickups, a.seed),
            "announcements": run_announcements(det, a.announcements, a.seed),
            "holdHoursMusicOnly": run_hold_hours(det, hours, a.seed, announcements=False),
            "holdHoursWithAnnouncements": run_hold_hours(det, hours, a.seed, announcements=True),
            "wallSeconds": round(time.time() - t0, 1),
        }
        print(json.dumps({det.name: report["detectors"][det.name]}, indent=2))
    Path(a.out).write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
