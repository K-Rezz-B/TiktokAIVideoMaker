"""Synthèse vocale : Edge TTS (gratuit, sans clé) ou ElevenLabs (clé API)."""
import asyncio
import hashlib
import re
import time
from pathlib import Path

import edge_tts
import requests

from .config import load_settings

EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF️‍⭐⬆↔-↪]+"
)

_edge_voices_cache = None


def clean_text(text: str) -> str:
    t = EMOJI_RE.sub(" ", text or "")
    letters = [c for c in t if c.isalpha()]
    # Les messages en MAJUSCULES sont parfois épelés : on les remet en casse normale
    if len(letters) > 3 and sum(c.isupper() for c in letters) / len(letters) > 0.7:
        t = t.lower()
        t = t[:1].upper() + t[1:]
    t = re.sub(r"([?!.])\1+", r"\1", t)
    return re.sub(r"\s+", " ", t).strip()


def _rate_str(rate) -> str:
    r = int(rate or 0)
    return f"{'+' if r >= 0 else ''}{r}%"


async def _edge_save(text: str, voice: str, rate: str, out: Path):
    await edge_tts.Communicate(text, voice, rate=rate).save(str(out))


def _edge(text: str, voice: str, rate, out: Path):
    last = None
    for attempt in range(3):
        try:
            asyncio.run(_edge_save(text, voice, _rate_str(rate), out))
            if out.exists() and out.stat().st_size > 0:
                return
        except Exception as exc:  # erreurs réseau ponctuelles
            last = exc
        time.sleep(1 + attempt)
    raise RuntimeError(f"Edge TTS a échoué pour la voix {voice} : {last}")


def _elevenlabs(text: str, voice: str, rate, out: Path):
    key = load_settings().get("elevenlabs_api_key", "")
    if not key:
        raise RuntimeError("Clé API ElevenLabs manquante : ajoute-la dans ⚙️ Réglages.")
    speed = max(0.7, min(1.2, 1 + int(rate or 0) / 100))
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
        headers={"xi-api-key": key, "accept": "audio/mpeg"},
        json={"text": text, "model_id": "eleven_multilingual_v2", "voice_settings": {"speed": speed}},
        timeout=120,
    )
    if r.status_code != 200:
        raise RuntimeError(f"ElevenLabs a refusé la requête ({r.status_code}) : {r.text[:200]}")
    out.write_bytes(r.content)


def synthesize(text: str, voice: str, out_dir: Path, provider: str = "edge", rate=0):
    """Retourne le chemin d'un mp3 (mis en cache), ou None s'il n'y a rien à dire."""
    t = clean_text(text)
    if not any(c.isalnum() for c in t):
        return None
    key = hashlib.sha1(f"{provider}|{voice}|{rate}|{t}".encode("utf-8")).hexdigest()[:16]
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"tts_{key}.mp3"
    if out.exists() and out.stat().st_size > 0:
        return out
    if provider == "elevenlabs":
        _elevenlabs(t, voice, rate, out)
    else:
        _edge(t, voice, rate, out)
    return out


def list_voices(provider: str = "edge") -> list:
    global _edge_voices_cache
    if provider == "elevenlabs":
        key = load_settings().get("elevenlabs_api_key", "")
        if not key:
            raise RuntimeError("Clé API ElevenLabs manquante : ajoute-la dans ⚙️ Réglages.")
        r = requests.get("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": key}, timeout=30)
        r.raise_for_status()
        return [
            {"id": v["voice_id"], "name": v["name"], "locale": "multi",
             "gender": (v.get("labels") or {}).get("gender", "")}
            for v in r.json().get("voices", [])
        ]
    if _edge_voices_cache is None:
        voices = asyncio.run(edge_tts.list_voices())
        _edge_voices_cache = sorted(
            ({"id": v["ShortName"], "name": v["ShortName"].split("-", 2)[-1].replace("Neural", ""),
              "locale": v["Locale"], "gender": v["Gender"]} for v in voices),
            key=lambda v: (not v["locale"].startswith("fr"), v["locale"], v["name"]),
        )
    return _edge_voices_cache
