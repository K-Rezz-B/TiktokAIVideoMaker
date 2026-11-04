import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECTS_DIR = ROOT / "projects"
SETTINGS_FILE = ROOT / "settings.json"
STAGE_DIR = ROOT / "stage"
WEB_DIR = ROOT / "web"

FPS = 30

DEFAULT_SETTINGS = {
    "gemini_api_key": "",
    "gemini_image_model": "gemini-2.5-flash-image",
    "gemini_text_model": "gemini-2.5-flash",
    "elevenlabs_api_key": "",
    "export_dir": "",  # vide = ~/Videos/ShortMakers
}


def load_settings() -> dict:
    data = dict(DEFAULT_SETTINGS)
    if SETTINGS_FILE.exists():
        try:
            data.update(json.loads(SETTINGS_FILE.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    return data


def save_settings(values: dict) -> dict:
    data = load_settings()
    for key in DEFAULT_SETTINGS:
        if key in values and values[key] is not None:
            data[key] = str(values[key]).strip()
    SETTINGS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return data
