"""Liste d'idées de vidéos (projects/ideas.json) : à faire, en cours, réalisées."""
import json
import re
import threading
from datetime import datetime

from .config import PROJECTS_DIR
from .projects import new_id

IDEAS_FILE = PROJECTS_DIR / "ideas.json"
STATUSES = ("todo", "doing", "done")
_lock = threading.Lock()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _read() -> list:
    if not IDEAS_FILE.exists():
        return []
    try:
        return json.loads(IDEAS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def _write(ideas: list) -> None:
    PROJECTS_DIR.mkdir(exist_ok=True)
    tmp = IDEAS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(ideas, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(IDEAS_FILE)


def list_all() -> list:
    return _read()


FORMATS = ("prank", "story")


def add(text: str, character: str = "", notes: str = "", fmt: str = "prank", views: int = 0) -> dict:
    text = (text or "").strip()
    if not text:
        raise ValueError("L'idée est vide")
    idea = {"id": new_id("idea-"), "text": text, "character": (character or "").strip(), "notes": (notes or "").strip(),
            "format": fmt if fmt in FORMATS else "prank",
            "views": max(0, int(views or 0)),  # vues de la vidéo d'origine (idées reprises d'une chaîne)
            "status": "todo", "project_id": "", "created": _now(), "done_at": ""}
    with _lock:
        ideas = _read()
        ideas.append(idea)
        _write(ideas)
    return idea


LINE_PREFIX = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s*")


def add_many(block: str, default_character: str = "", fmt: str = "prank") -> list:
    """Une idée par ligne. Format accepté : « idée » ou « idée | à qui »."""
    added = []
    for line in (block or "").splitlines():
        line = LINE_PREFIX.sub("", line).strip().strip("*").strip()
        if len(line) < 4:
            continue
        text, _, character = line.partition("|")
        added.append(add(text.strip(), character.strip() or default_character, fmt=fmt))
    if not added:
        raise ValueError("Aucune idée trouvée : écris une idée par ligne.")
    return added


def update(idea_id: str, changes: dict) -> dict:
    with _lock:
        ideas = _read()
        idea = next((i for i in ideas if i["id"] == idea_id), None)
        if not idea:
            raise KeyError("Idée introuvable")
        for key in ("text", "character", "notes", "project_id"):
            if key in changes and changes[key] is not None:
                idea[key] = str(changes[key]).strip()
        if changes.get("format") in FORMATS:
            idea["format"] = changes["format"]
        if "views" in changes:
            idea["views"] = max(0, int(changes["views"] or 0))
        status = changes.get("status")
        if status in STATUSES and status != idea["status"]:
            idea["status"] = status
            idea["done_at"] = _now() if status == "done" else ""
        _write(ideas)
        return idea


def delete(idea_id: str) -> None:
    with _lock:
        _write([i for i in _read() if i["id"] != idea_id])


def mark_done_for_project(project_id: str) -> None:
    """Appelé après le rendu d'une vidéo : l'idée liée passe en « réalisée »."""
    with _lock:
        ideas = _read()
        changed = False
        for idea in ideas:
            if idea.get("project_id") == project_id and idea["status"] != "done":
                idea["status"], idea["done_at"] = "done", _now()
                changed = True
        if changed:
            _write(ideas)


SUGGEST_PROMPT = """Propose-moi 10 nouvelles idées de vidéos TikTok au format « Je fais croire à [un proche] que … ».

Le principe : je prends une vraie photo banale (maison, jardin, voiture, cuisine, chambre, animal…), une IA la modifie pour créer une situation absurde mais crédible, et je l'envoie par SMS au proche pour le faire paniquer.

Les bonnes idées :
- partent d'un objet ou d'un lieu facile à prendre en photo chez soi ;
- ont une modification visuelle énorme mais réaliste (un ouvrier qui en fait trop, un achat délirant, un animal, des travaux ratés…) ;
- visent un proche qui va réagir fort (père, mère, copine, coloc, grand-mère…).
{existing}
Réponds UNIQUEMENT avec 10 lignes, une idée par ligne, sans numéro, au format :
idée courte | à qui je fais la blague
Exemple :
l'ouvrier a transformé la pelouse en parking de supermarché | mon père"""


SUGGEST_STORY_PROMPT = """Propose-moi 10 nouvelles idées de vidéos TikTok au format « histoire POV par SMS ».

Le principe : une accroche « POV : … » s'affiche sur un selfie, puis on lit une fausse conversation SMS pleine de drama, de malaise ou d'humour, avec une chute à la fin.

Les bonnes idées :
- parlent de crush, couple, ex, tromperie, famille (frère, sœur, mère, belle-mère), potes, lycée, travail ;
- tiennent en une phrase qui donne envie de connaître la fin ;
- reposent sur un défi, un test, un quiproquo, une révélation ou une réaction choquante.
{existing}
Réponds UNIQUEMENT avec 10 lignes, une idée par ligne, sans numéro et sans « POV : », par exemple :
t'as perdu à un défi, tu dois DM ton crush uniquement avec des photos"""


def suggest_prompt(fmt: str = "prank") -> str:
    current = [i["text"] for i in _read() if i.get("format", "prank") == fmt][-30:]
    existing = ""
    if current:
        existing = "\nÉvite ces idées que j'ai déjà :\n" + "\n".join(f"- {t}" for t in current) + "\n"
    return (SUGGEST_STORY_PROMPT if fmt == "story" else SUGGEST_PROMPT).format(existing=existing)
