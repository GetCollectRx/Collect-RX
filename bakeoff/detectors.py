"""Pickup detectors under test. Each takes mu-law frames (n, 160) and returns trigger times in seconds.

A detector fires when it believes a live person has started talking on a hold line. The bake-off
compares detectors on the same synthetic corpus. Add new detectors here and list them in DETECTORS.
"""
from __future__ import annotations

from typing import Protocol

import numpy as np

from corpus import FRAME, SR, mulaw_decode_production

FRAME_SECONDS = FRAME / SR


class Detector(Protocol):
    name: str

    def detect(self, mulaw_frames: np.ndarray) -> list[float]: ...


class ProductionEnergyDetector:
    """Faithful port of the trigger in src/webhooks/holdParkAudioStream.ts (read 2026-11-11).

    Constants copied: WINDOW_FRAMES=15, ACTIVE_FRACTION_NEEDED=0.5, MIN_ACTIVE_RMS=400. The RMS
    uses that file's mu-law decode, which with bias 0x84 is the full 16-bit decode, so the floor of
    400 is about -38.3 dBFS. First trigger only, as in production;
    this port reports every trigger so false-pickup rates can be counted with a refractory window.
    """

    name = "production-energy"
    WINDOW = 15
    FRACTION = 0.5
    MIN_RMS = 400.0

    def __init__(self, refractory_seconds: float = 60.0) -> None:
        self.refractory = refractory_seconds

    def detect(self, mulaw_frames: np.ndarray) -> list[float]:
        pcm = mulaw_decode_production(mulaw_frames.reshape(-1)).reshape(mulaw_frames.shape).astype(np.float64)
        frame_rms = np.sqrt(np.mean(pcm * pcm, axis=1))
        active = (frame_rms > self.MIN_RMS).astype(np.int32)
        csum = np.concatenate([[0], np.cumsum(active)])
        window_active = csum[self.WINDOW:] - csum[: -self.WINDOW]  # window ending at frame i+WINDOW-1
        hits = np.nonzero(window_active / self.WINDOW >= self.FRACTION)[0]
        triggers: list[float] = []
        last = -1e18
        for h in hits:
            t = (h + self.WINDOW) * FRAME_SECONDS  # time at the end of the window's last frame
            if t - last >= self.refractory:
                triggers.append(float(t))
                last = t
        return triggers


HOLD_WORDS = {
    "important", "stay", "line", "hold", "representative", "representatives", "assisting", "estimated",
    "wait", "recorded", "quality", "training", "patience", "answered", "order", "website", "continue",
    "available", "agent", "specialist", "visit", "moment", "minutes", "shortly",
}
GATE_SECONDS = 1.5  # decide on the first 1.5 s of a speech segment, as a streaming recogniser's partial would


class SileroVad:
    """Silero VAD (ONNX, bundled in the silero-vad wheel) run at 8 kHz, stateful, 32 ms chunks."""

    CHUNK = 256
    CONTEXT = 32

    def __init__(self) -> None:
        import onnxruntime as ort
        from pathlib import Path

        self._sess = ort.InferenceSession(str(Path(__file__).parent / "models" / "silero_vad.onnx"), providers=["CPUExecutionProvider"])

    def probs(self, pcm: np.ndarray) -> np.ndarray:
        x = (pcm / 32768.0).astype(np.float32)
        state = np.zeros((2, 1, 128), dtype=np.float32)
        ctx = np.zeros((1, self.CONTEXT), dtype=np.float32)
        sr = np.array(SR, dtype=np.int64)
        out = np.empty(len(x) // self.CHUNK, dtype=np.float32)
        for k in range(len(out)):
            inp = np.concatenate([ctx, x[k * self.CHUNK:(k + 1) * self.CHUNK][None, :]], axis=1)
            o, state = self._sess.run(None, {"input": inp, "state": state, "sr": sr})
            ctx = inp[:, -self.CONTEXT:]
            out[k] = o[0][0]
        return out


def speech_segments(probs: np.ndarray, chunk_seconds: float, start_chunks: int = 5, hang_chunks: int = 15, hi: float = 0.5, lo: float = 0.35) -> list[tuple[float, float]]:
    """Speech starts after start_chunks consecutive chunks above hi, ends after hang_chunks below lo."""
    segs: list[tuple[float, float]] = []
    run = 0
    in_seg = False
    seg_start = 0
    quiet = 0
    for k, p in enumerate(probs):
        if not in_seg:
            run = run + 1 if p > hi else 0
            if run >= start_chunks:
                in_seg, seg_start, quiet = True, k - start_chunks + 1, 0
        else:
            quiet = quiet + 1 if p < lo else 0
            if quiet >= hang_chunks:
                segs.append((seg_start * chunk_seconds, (k - hang_chunks + 1) * chunk_seconds))
                in_seg, run = False, 0
    if in_seg:
        segs.append((seg_start * chunk_seconds, len(probs) * chunk_seconds))
    return segs


class VadOnlyDetector:
    """Stage 1 alone: fires when speech starts. Separates music from speech, cannot separate an announcement from a person."""

    name = "silero-vad-only"
    hour_cap: float | None = None
    START_CHUNKS = 5

    def __init__(self, refractory_seconds: float = 60.0) -> None:
        self.vad = SileroVad()
        self.refractory = refractory_seconds

    def _segments(self, mulaw_frames: np.ndarray) -> tuple[np.ndarray, list[tuple[float, float]]]:
        pcm = mulaw_decode_production(mulaw_frames.reshape(-1)).astype(np.float64)
        chunk_s = SileroVad.CHUNK / SR
        return pcm, speech_segments(self.vad.probs(pcm), chunk_s, self.START_CHUNKS)

    def detect(self, mulaw_frames: np.ndarray) -> list[float]:
        _pcm, segs = self._segments(mulaw_frames)
        out: list[float] = []
        last = -1e18
        for start, _end in segs:
            t = start + self.START_CHUNKS * SileroVad.CHUNK / SR
            if t - last >= self.refractory:
                out.append(t)
                last = t
        return out


class VadAsrPhraseDetector(VadOnlyDetector):
    """Two stages: VAD finds speech, then an ASR backend transcribes the first 1.5 s and a hold-phrase gate decides.

    A segment whose transcript holds at least two hold-line words is treated as a recording and ignored.
    Anything else counts as a person. ASR compute time is NOT added to latency (a streaming recogniser
    returns partials as audio arrives); the 1.5 s gate window is.
    """

    hour_cap: float | None = 5.0  # local ASR is slow; keep the hold-hours run short

    def __init__(self, asr, refractory_seconds: float = 60.0) -> None:
        super().__init__(refractory_seconds)
        self.asr = asr
        self.name = f"silero-vad+{asr.name}-phrase-gate"

    def detect(self, mulaw_frames: np.ndarray) -> list[float]:
        pcm, segs = self._segments(mulaw_frames)
        out: list[float] = []
        last = -1e18
        for start, end in segs:
            gate_end = min(end, start + GATE_SECONDS)
            text = self.asr.transcribe(pcm[int(start * SR): int(gate_end * SR)])
            words = set(text.lower().split())
            is_recording = len(words & HOLD_WORDS) >= 2
            t = gate_end
            if not is_recording and t - last >= self.refractory:
                out.append(t)
                last = t
        return out


def _asr_detector() -> Detector:
    from asr import PocketSphinxBackend

    return VadAsrPhraseDetector(PocketSphinxBackend())


DETECTORS: list[Detector] = [ProductionEnergyDetector(), VadOnlyDetector(), _asr_detector()]
