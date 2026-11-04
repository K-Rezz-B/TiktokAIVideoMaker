"""Export de publication : un dossier par vidéo (titre), avec la vidéo, l'image et la légende."""
import ctypes
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

from . import projects
from .config import load_settings

INVALID = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def export_root() -> Path:
    custom = load_settings().get("export_dir", "").strip()
    return Path(custom).expanduser() if custom else Path.home() / "Videos" / "ShortMakers"


def safe_name(text: str, max_len: int = 150) -> str:
    """Nom de dossier valide sous Windows et macOS (les émojis sont conservés)."""
    name = re.sub(r"\s+", " ", INVALID.sub(" ", text or "")).strip().rstrip(". ")
    return name[:max_len].rstrip(". ") or "video"


def slug(text: str) -> str:
    t = unicodedata.normalize("NFD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:60] or "video"


def caption(p: dict) -> str:
    """Légende TikTok / Instagram : le titre généré (avec hashtags), sinon l'accroche."""
    c = (p.get("youtube_title") or p["hook"].get("text") or p.get("title") or "").strip()
    if "#" not in c:
        c += " #sms #message #humour"
    return c


def youtube_title(p: dict) -> str:
    """Titre YouTube Shorts : 100 caractères max, avec #shorts (on retire les derniers hashtags si besoin)."""
    words = caption(p).split()
    if not any(w.lower() == "#shorts" for w in words):
        words.append("#shorts")
    while len(" ".join(words)) > 100:
        tags = [i for i, w in enumerate(words) if w.startswith("#") and w.lower() != "#shorts"]
        if not tags:
            break
        del words[tags[-1]]
    return " ".join(words)[:100]


MARKER = ".tiktokmaker"


def _owned(folder: Path, pid: str) -> bool:
    try:
        return (folder / MARKER).read_text(encoding="utf-8").strip() == pid
    except OSError:
        return False


def _mark(folder: Path, pid: str) -> None:
    marker = folder / MARKER
    if sys.platform.startswith("win") and marker.exists():
        ctypes.windll.kernel32.SetFileAttributesW(str(marker), 0x80)  # caché -> normal pour pouvoir réécrire
    marker.write_text(pid, encoding="utf-8")
    if sys.platform.startswith("win"):
        ctypes.windll.kernel32.SetFileAttributesW(str(marker), 0x02)  # fichier caché


def export_project(p: dict) -> Path:
    video = p.get("output", "")
    video_path = projects.project_dir(p["id"]) / video if video else None
    if not video_path or not video_path.exists():
        raise FileNotFoundError("Génère d'abord la vidéo de ce projet.")
    root = export_root()
    root.mkdir(parents=True, exist_ok=True)

    # On ne réutilise que les dossiers créés par l'outil pour CE projet : un dossier rempli à la main
    # ou par une autre vidéo du même titre n'est jamais modifié, on prend « titre (2) » à la place.
    base_name = safe_name(youtube_title(p))  # même convention que les dossiers faits à la main : titre YouTube
    name, n = base_name, 2
    while (root / name).exists() and not _owned(root / name, p["id"]):
        name = f"{base_name} ({n})"
        n += 1
    folder = root / name
    folder.mkdir(parents=True, exist_ok=True)
    _mark(folder, p["id"])

    base = slug(p.get("title"))
    for old in folder.glob("*.mp4"):  # une ré-exportation remplace l'ancienne vidéo
        old.unlink()
    shutil.copy2(video_path, folder / f"{base}.mp4")
    img = projects.find_image(p, p["hook"].get("image") or projects.RESULT_REF)
    if img:
        src = projects.project_dir(p["id"]) / "images" / img["file"]
        shutil.copy2(src, folder / f"{base}{src.suffix}")
    (folder / "légende.txt").write_text(
        f"Légende TikTok / Instagram :\n{caption(p)}\n\nTitre YouTube Shorts :\n{youtube_title(p)}\n", encoding="utf-8")
    p["export_folder"] = name
    return folder


def open_folder(path: Path) -> None:
    if sys.platform.startswith("win"):
        os.startfile(str(path))  # noqa: S606 - dossier local choisi par l'utilisateur
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])
