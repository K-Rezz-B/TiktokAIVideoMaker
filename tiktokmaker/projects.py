"""Stockage des projets : un dossier par vidéo dans projects/<id>/project.json."""
import json
import re
import secrets
import shutil
from datetime import datetime
from pathlib import Path

from .config import PROJECTS_DIR

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Références d'images "symboliques" utilisables partout (accroche, messages)
SOURCE_REF = "@source"
RESULT_REF = "@result"


def new_id(prefix: str = "") -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{prefix}{stamp}-{secrets.token_hex(3)}"


def default_project(title: str = "Nouvelle vidéo") -> dict:
    return {
        "id": new_id(),
        "title": title,
        "created": datetime.now().isoformat(timespec="seconds"),
        "idea": "",
        "character": "mon père",
        "youtube_title": "",
        "hook": {"text": "", "image": RESULT_REF, "speak": True, "zoom": True},
        "ai_app": {
            "enabled": True,
            "app_name": "Ora AI",
            "prompt_text": "",
            "edit_prompt": "",
            "photo_prompt": "",
            "source_image": "",
            "result_image": "",
            "show_result": False,
        },
        "chat": {
            "contact_name": "Papa",
            "time": "16:21",
            "typing_indicator": True,
            "text_size": 13.5,
            "messages": [],
        },
        "images": [],
        "voices": {
            "provider": "edge",
            "narrator": "fr-FR-HenriNeural",
            "me": "fr-FR-HenriNeural",
            "them": "fr-FR-RemyMultilingualNeural",
            "rate": 10,
        },
        "audio": {"music": "", "music_volume": 0.12, "sfx": True},
        "pace": 1.0,
        "output": "",
    }


def project_dir(pid: str) -> Path:
    if not ID_RE.match(pid or ""):
        raise ValueError("Identifiant de projet invalide")
    return PROJECTS_DIR / pid


def _merge_defaults(data: dict, defaults: dict) -> dict:
    for key, value in defaults.items():
        if key not in data:
            data[key] = value
        elif isinstance(value, dict) and isinstance(data[key], dict):
            _merge_defaults(data[key], value)
    return data


def load(pid: str) -> dict:
    path = project_dir(pid) / "project.json"
    if not path.exists():
        raise FileNotFoundError(f"Projet introuvable : {pid}")
    data = json.loads(path.read_text(encoding="utf-8"))
    defaults = default_project()
    defaults.pop("id")
    return _merge_defaults(data, defaults)


def save(project: dict) -> dict:
    d = project_dir(project["id"])
    (d / "images").mkdir(parents=True, exist_ok=True)
    tmp = d / "project.json.tmp"
    tmp.write_text(json.dumps(project, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(d / "project.json")
    return project


def create(title: str = "Nouvelle vidéo") -> dict:
    return save(default_project(title))


def list_all() -> list:
    PROJECTS_DIR.mkdir(exist_ok=True)
    out = []
    for d in sorted(PROJECTS_DIR.iterdir(), reverse=True):
        f = d / "project.json"
        if f.exists():
            try:
                p = json.loads(f.read_text(encoding="utf-8"))
                out.append({"id": p["id"], "title": p.get("title", ""), "created": p.get("created", "")})
            except (OSError, ValueError, KeyError):
                continue
    return out


def delete(pid: str) -> None:
    shutil.rmtree(project_dir(pid), ignore_errors=True)


def add_image(project: dict, data: bytes, name: str, origin: str, prompt: str = "", ext: str = ".png") -> dict:
    img_id = new_id("img-")
    filename = f"{img_id}{ext}"
    d = project_dir(project["id"]) / "images"
    d.mkdir(parents=True, exist_ok=True)
    (d / filename).write_bytes(data)
    entry = {"id": img_id, "name": name, "file": filename, "origin": origin, "prompt": prompt}
    project["images"].append(entry)
    return entry


def find_image(project: dict, ref: str):
    """Résout une référence (@source, @result ou id) vers l'entrée image."""
    if ref == SOURCE_REF:
        ref = project["ai_app"].get("source_image", "")
    elif ref == RESULT_REF:
        ref = project["ai_app"].get("result_image", "")
    for img in project["images"]:
        if img["id"] == ref:
            return img
    return None


def image_path(project: dict, ref: str):
    img = find_image(project, ref)
    return project_dir(project["id"]) / "images" / img["file"] if img else None
