"""Speech recognition backends for the phrase gate. Swap the backend to change the recogniser.

PocketSphinxBackend is free and local, and it is WEAK on telephone speech (see RESULTS notes). It stands
in so the pipeline and its timing can be exercised offline. It says nothing about a production
recogniser such as Deepgram Nova-3, which is what the PRD costs. DeepgramBackend is a stub and needs
a key; it is not wired because no spend cap has been set.
"""
from __future__ import annotations

from typing import Protocol

import numpy as np


class AsrBackend(Protocol):
    name: str

    def transcribe(self, pcm8k: np.ndarray) -> str: ...


class PocketSphinxBackend:
    name = "pocketsphinx"

    def __init__(self) -> None:
        from pocketsphinx import Decoder

        self._decoder = Decoder(samprate=16000, loglevel="FATAL")

    def transcribe(self, pcm8k: np.ndarray) -> str:
        n = len(pcm8k)
        up = np.interp(np.arange(0, n, 0.5), np.arange(n), pcm8k)
        raw = np.clip(up, -32768, 32767).astype("<i2").tobytes()
        self._decoder.start_utt()
        self._decoder.process_raw(raw, False, True)
        self._decoder.end_utt()
        hyp = self._decoder.hyp()
        return hyp.hypstr if hyp else ""


class SherpaWhisperBackend:
    """Whisper small.en (int8) through sherpa-onnx. Free, local, CPU. Model from bakeoff/fetch_models.sh."""

    name = "whisper-small.en"

    def __init__(self) -> None:
        import sherpa_onnx
        from pathlib import Path

        d = Path(__file__).parent / "models" / "whisper-small.en"
        enc, dec, tok = d / "small.en-encoder.int8.onnx", d / "small.en-decoder.int8.onnx", d / "small.en-tokens.txt"
        if not (enc.exists() and dec.exists() and tok.exists()):
            raise FileNotFoundError("Whisper model missing; run bash bakeoff/fetch_models.sh")
        self._rec = sherpa_onnx.OfflineRecognizer.from_whisper(
            encoder=str(enc), decoder=str(dec), tokens=str(tok), language="en", task="transcribe", num_threads=4
        )

    def transcribe(self, pcm8k: np.ndarray) -> str:
        stream = self._rec.create_stream()
        stream.accept_waveform(8000, (pcm8k / 32768.0).astype(np.float32))
        self._rec.decode_stream(stream)
        return stream.result.text.strip()


class DeepgramBackend:
    name = "deepgram-nova-3"

    def transcribe(self, pcm8k: np.ndarray) -> str:
        raise NotImplementedError("No Deepgram key and no spend cap. Wire this only after both are set.")
