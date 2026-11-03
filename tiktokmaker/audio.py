"""Décodage, bruitages synthétiques et mixage audio (numpy + ffmpeg embarqué)."""
import subprocess
import wave
from pathlib import Path

import imageio_ffmpeg
import numpy as np

SR = 44100
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def load_audio(path: Path) -> np.ndarray:
    cmd = [FFMPEG, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"]
    out = subprocess.run(cmd, capture_output=True, check=True, creationflags=_NO_WINDOW).stdout
    return np.frombuffer(out, dtype=np.float32).reshape(-1, 2).copy()


def trim_silence(a: np.ndarray, threshold: float = 0.01, pad: float = 0.03) -> np.ndarray:
    level = np.abs(a).max(axis=1)
    idx = np.nonzero(level > threshold)[0]
    if not len(idx):
        return a[:0]
    p = int(pad * SR)
    return a[max(0, idx[0] - p): min(len(a), idx[-1] + p)]


def duration(a: np.ndarray) -> float:
    return len(a) / SR


def write_wav(path: Path, a: np.ndarray) -> None:
    pcm = (np.clip(a, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# --- Bruitages générés (pas de fichiers sous droits) ------------------------

def _stereo(x: np.ndarray) -> np.ndarray:
    return np.stack([x, x], axis=1).astype(np.float32)


def _note(freq: float, dur: float, decay: float, vol: float) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * decay) * np.minimum(1, t / 0.003)
    sig = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(4 * np.pi * freq * t)
    return sig * env * vol


def _place(parts) -> np.ndarray:
    length = max(int(off * SR) + len(x) for off, x in parts)
    out = np.zeros(length)
    for off, x in parts:
        s = int(off * SR)
        out[s:s + len(x)] += x
    return _stereo(out)


def sfx_receive() -> np.ndarray:
    return _place([(0, _note(1318.5, 0.25, 18, 0.22)), (0.075, _note(1760, 0.35, 12, 0.2))])


def sfx_send() -> np.ndarray:
    dur = 0.16
    t = np.arange(int(dur * SR)) / SR
    freq = 420 + 1300 * (t / dur) ** 1.5
    phase = 2 * np.pi * np.cumsum(freq) / SR
    env = np.sin(np.pi * t / dur) ** 2
    return _stereo(np.sin(phase) * env * 0.16)


def sfx_key() -> np.ndarray:
    rng = np.random.default_rng(7)
    t = np.arange(int(0.025 * SR)) / SR
    noise = np.diff(rng.standard_normal(len(t) + 1))
    return _stereo(noise * np.exp(-t * 320) * 0.05 + _note(2200, 0.025, 300, 0.04))


def sfx_done() -> np.ndarray:
    return _place([(0, _note(880, 0.4, 9, 0.12)), (0.09, _note(1108.7, 0.4, 9, 0.12)),
                   (0.18, _note(1318.5, 0.6, 7, 0.12))])


SFX = {"receive": sfx_receive, "send": sfx_send, "key": sfx_key, "done": sfx_done}


class Mixer:
    def __init__(self, total_seconds: float):
        n = int(total_seconds * SR)
        self.voice = np.zeros((n, 2), np.float32)
        self.fx = np.zeros((n, 2), np.float32)
        self._sfx_cache = {}

    def _add(self, buf: np.ndarray, clip: np.ndarray, at: float, gain: float):
        s = int(at * SR)
        if s >= len(buf) or not len(clip):
            return
        e = min(len(buf), s + len(clip))
        buf[s:e] += clip[: e - s] * gain

    def add_voice(self, clip: np.ndarray, at: float, gain: float = 1.0):
        self._add(self.voice, clip, at, gain)

    def add_sfx(self, name: str, at: float, gain: float = 1.0):
        if name not in self._sfx_cache:
            self._sfx_cache[name] = SFX[name]()
        self._add(self.fx, self._sfx_cache[name], at, gain)

    def render(self, music_path: Path = None, music_volume: float = 0.12) -> np.ndarray:
        mix = self.voice + self.fx
        n = len(mix)
        if music_path and Path(music_path).exists() and music_volume > 0:
            music = load_audio(Path(music_path))
            if len(music):
                reps = int(np.ceil(n / len(music)))
                music = np.tile(music, (reps, 1))[:n]
                t = np.arange(n) / SR
                fade = np.minimum(1, t / 0.4) * np.clip((n / SR - t) / 1.5, 0, 1)
                # "ducking" : la musique baisse quand une voix parle
                level = np.abs(self.voice).max(axis=1)
                win = int(0.25 * SR)
                c = np.cumsum(np.concatenate([[0], level]))
                smooth = (c[win:] - c[:-win]) / win
                smooth = np.concatenate([smooth, np.full(n - len(smooth), smooth[-1] if len(smooth) else 0)])
                duck = 1 - 0.55 * np.clip(smooth / 0.04, 0, 1)
                mix = mix + music * (music_volume * fade * duck)[:, None]
        # Normalisation : crête à -1 dB (les voix TTS sortent souvent trop faibles)
        peak = float(np.abs(mix).max()) if n else 0
        if peak > 0:
            mix = mix * (0.89 / peak)
        return mix
