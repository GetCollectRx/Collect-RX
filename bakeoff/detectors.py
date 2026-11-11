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


DETECTORS: list[Detector] = [ProductionEnergyDetector()]
