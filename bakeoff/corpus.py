"""Synthetic hold-audio corpus for the Option A versus B bake-off (offline, no telephony, no spend).

Everything is generated from a seed. Audio is 8 kHz mono, run through G.711 mu-law and back,
which is what a Twilio Media Stream delivers. Speech is espeak-ng (machine speech), music is
synthesised chords. Both are PROXIES: real carrier hold audio has not been recorded. Levels and
phrases are assumptions, stated in README.md, and results must be read with that limit.
"""
from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

import numpy as np

SR = 8000
FRAME = 160  # 20 ms, Twilio Media Streams frame
CACHE = Path(__file__).parent / ".speech-cache"

HOLD_ANNOUNCEMENTS = [
    "Your call is important to us. Please stay on the line and a representative will be with you shortly.",
    "All of our representatives are currently assisting other callers. Your estimated wait time is eleven minutes.",
    "Thank you for holding. Your call will be answered in the order it was received.",
    "For faster service, visit our website at any time. Please continue to hold.",
    "This call may be recorded for quality and training purposes.",
    "Thank you for calling. Please continue to hold for the next available agent.",
    "We appreciate your patience. A claims specialist will be with you as soon as possible.",
    "Did you know you can check your claim status online? Please continue to hold.",
]

# What a person says on picking up. Some overlap in wording with automated lines on purpose.
REP_GREETINGS = [
    "Hello, thank you for calling, this is Alex, how can I help you?",
    "Provider services, this is Sam speaking.",
    "Good morning, claims department, you are speaking with Jordan.",
    "Thanks for holding. This is Riley. Who am I speaking with?",
    "Hi, this is Casey. Can I get your provider number please?",
    "Thank you for calling, this is Morgan. How may I direct your call?",
]

VOICES = ["en-us", "en-us+f3", "en-us+m3", "en-gb", "en-us+f5", "en-us+m7"]


def mulaw_encode(pcm16: np.ndarray) -> np.ndarray:
    """ITU G.711 mu-law encode of int16 samples."""
    BIAS, CLIP = 0x84, 32635
    s = pcm16.astype(np.int32)
    sign = np.where(s < 0, 0x80, 0)
    s = np.minimum(np.abs(s), CLIP) + BIAS
    exp = np.floor(np.log2(np.maximum(s, 1))).astype(np.int32) - 7
    exp = np.clip(exp, 0, 7)
    mant = (s >> (exp + 3)) & 0x0F
    return (~(sign | (exp << 4) | mant) & 0xFF).astype(np.uint8)


def _decode(b: np.ndarray) -> np.ndarray:
    inv = (~b.astype(np.int32)) & 0xFF
    sign = inv & 0x80
    exp = (inv >> 4) & 0x07
    mant = inv & 0x0F
    sample = (((mant << 3) + 0x84) << exp) - 0x84
    return np.where(sign != 0, -sample, sample)


def mulaw_decode_production(b: np.ndarray) -> np.ndarray:
    """The decode in src/webhooks/holdParkAudioStream.ts. With bias 0x84 it is the full 16-bit G.711 decode
    (maximum magnitude 32124), checked by round trip in self_check()."""
    return _decode(b)


def self_check() -> None:
    x = np.array([0, 100, -100, 5000, -5000, 30000, -30000], dtype=np.int16)
    d = mulaw_decode_production(mulaw_encode(x))
    assert np.all(np.abs(d - x.astype(np.int32)) <= np.maximum(8, np.abs(x.astype(np.int32)) // 16)), d


def bandpass_telephone(x: np.ndarray, lo: float = 300.0, hi: float = 3400.0) -> np.ndarray:
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1.0 / SR)
    spec[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(spec, n=len(x))


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x.astype(np.float64))))) if len(x) else 0.0


def scale_to_dbfs(x: np.ndarray, dbfs: float) -> np.ndarray:
    r = rms(x)
    if r == 0:
        return x
    target = 32768.0 * (10 ** (dbfs / 20.0))
    return x * (target / r)


def music_track(seed: int, seconds: float, dbfs: float) -> np.ndarray:
    """Chord-progression 'hold music': plucked harmonic tones, telephone band, scaled to dbfs."""
    rng = np.random.default_rng(seed)
    bpm = float(rng.uniform(66, 124))
    beat = 60.0 / bpm
    n = int(seconds * SR)
    out = np.zeros(n)
    root = float(rng.uniform(110, 220))
    scale = np.array([0, 2, 4, 5, 7, 9, 11])
    pos = 0.0
    harmonics = int(rng.integers(2, 6))
    arp = bool(rng.integers(0, 2))
    while pos < seconds:
        degree = int(rng.integers(0, 7))
        notes = [scale[(degree + k) % 7] + 12 * ((degree + k) // 7) for k in (0, 2, 4)]
        dur = beat * float(rng.choice([1, 2, 2, 4]))
        for i, semis in enumerate(notes):
            start = pos + (i * beat / 3 if arp else 0.0)
            f0 = root * (2 ** (semis / 12.0))
            i0 = int(start * SR)
            i1 = min(n, int((start + dur) * SR))
            if i1 <= i0:
                continue
            t = np.arange(i1 - i0) / SR
            env = np.exp(-t * float(rng.uniform(1.0, 3.0))) * np.minimum(1.0, t * 80)
            tone = sum(np.sin(2 * np.pi * f0 * h * t) / h for h in range(1, harmonics + 1))
            out[i0:i1] += tone * env
        pos += dur
    out = bandpass_telephone(out)
    return scale_to_dbfs(out, dbfs)


def room_noise(seed: int, seconds: float, dbfs: float) -> np.ndarray:
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(int(seconds * SR))
    x = bandpass_telephone(x, 200, 3000)
    return scale_to_dbfs(x, dbfs)


def _speech_raw(text: str, voice: str, wpm: int, pitch: int) -> np.ndarray:
    CACHE.mkdir(exist_ok=True)
    key = hashlib.sha256(f"{text}|{voice}|{wpm}|{pitch}".encode()).hexdigest()[:20]
    path = CACHE / f"{key}.s16"
    if not path.exists():
        wav = subprocess.run(
            ["espeak-ng", "--stdout", "-v", voice, "-s", str(wpm), "-p", str(pitch), text],
            check=True, capture_output=True,
        ).stdout
        pcm = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-ar", str(SR), "-ac", "1", "-f", "s16le", "pipe:1"],
            input=wav, check=True, capture_output=True,
        ).stdout
        path.write_bytes(pcm)
    return np.frombuffer(path.read_bytes(), dtype=np.int16).astype(np.float64)


def speech(text: str, seed: int, dbfs: float) -> np.ndarray:
    rng = np.random.default_rng(seed)
    voice = VOICES[int(rng.integers(0, len(VOICES)))]
    wpm = int(rng.integers(130, 190))
    pitch = int(rng.integers(30, 70))
    x = bandpass_telephone(_speech_raw(text, voice, wpm, pitch))
    return scale_to_dbfs(x, dbfs)


def through_mulaw(pcm: np.ndarray) -> np.ndarray:
    """Quantise to int16, encode to mu-law bytes (what the stream carries)."""
    clipped = np.clip(np.round(pcm), -32768, 32767).astype(np.int16)
    return mulaw_encode(clipped)


def frames(mulaw: np.ndarray) -> np.ndarray:
    n = len(mulaw) // FRAME
    return mulaw[: n * FRAME].reshape(n, FRAME)
