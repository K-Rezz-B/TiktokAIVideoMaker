"""TiktokMaker — serveur local. Lancer : python app.py (ou start_windows.bat / start_mac.command)."""
import os
import socket
import threading
import traceback
import uuid
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from tiktokmaker import export, gemini, ideas, pipeline, projects, tts
from tiktokmaker.config import PROJECTS_DIR, STAGE_DIR, WEB_DIR, load_settings, save_settings

HOST = "127.0.0.1"
PORT = 8765

app = FastAPI(title="TiktokMaker")
PROJECTS_DIR.mkdir(exist_ok=True)
app.mount("/web", StaticFiles(directory=WEB_DIR), name="web")
app.mount("/stage", StaticFiles(directory=STAGE_DIR), name="stage")
app.mount("/files", StaticFiles(directory=PROJECTS_DIR), name="files")

JOBS: dict = {}
RENDER_LOCK = threading.Lock()


def base_url() -> str:
    return f"http://{HOST}:{PORT}"


def _load(pid: str) -> dict:
    try:
        return projects.load(pid)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(404, str(exc))


def _fail(exc: Exception):
    raise HTTPException(400, str(exc))


@app.get("/")
def index():
    return RedirectResponse("/web/index.html")


# ------------------------------- Réglages -------------------------------
def _mask(v: str) -> str:
    return f"••••{v[-4:]}" if v else ""


@app.get("/api/settings")
def get_settings():
    s = load_settings()
    return {**s, "gemini_api_key": _mask(s["gemini_api_key"]), "elevenlabs_api_key": _mask(s["elevenlabs_api_key"]),
            "export_root": str(export.export_root())}


@app.put("/api/settings")
def put_settings(values: dict):
    # Les champs masqués non modifiés ne sont pas réécrits
    clean = {k: v for k, v in values.items() if not (isinstance(v, str) and v.startswith("••••"))}
    save_settings(clean)
    return get_settings()


@app.get("/api/models")
def get_models():
    try:
        return gemini.list_models()
    except Exception as exc:
        _fail(exc)


@app.get("/api/voices")
def get_voices(provider: str = "edge"):
    try:
        return tts.list_voices(provider)
    except Exception as exc:
        _fail(exc)


class TTSPreview(BaseModel):
    text: str
    voice: str
    provider: str = "edge"
    rate: int = 0


@app.post("/api/tts/preview")
def tts_preview(body: TTSPreview):
    try:
        path = tts.synthesize(body.text, body.voice, PROJECTS_DIR / "_tts_preview", body.provider, body.rate)
    except Exception as exc:
        _fail(exc)
    if not path:
        raise HTTPException(400, "Texte vide")
    return FileResponse(path, media_type="audio/mpeg")


# ------------------------------- Projets --------------------------------
@app.get("/api/projects")
def list_projects():
    return projects.list_all()


@app.post("/api/projects")
def create_project(fmt: str = "prank"):
    return projects.create(fmt=fmt)


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    return _load(pid)


@app.put("/api/projects/{pid}")
def put_project(pid: str, data: dict):
    current = _load(pid)
    data["id"] = pid
    data["images"] = current["images"]  # gérées par les routes dédiées
    data["output"] = current.get("output", "")
    data["export_folder"] = current.get("export_folder", "")
    return projects.save(data)


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    _load(pid)
    projects.delete(pid)
    return {"ok": True}


# ------------------------------- Images ---------------------------------
EXT_BY_MIME = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


@app.post("/api/projects/{pid}/images/upload")
async def upload_image(pid: str, file: UploadFile = File(...), role: str = ""):
    p = _load(pid)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(400, "Format accepté : JPG, PNG ou WEBP")
    img = projects.add_image(p, await file.read(), Path(file.filename).stem[:40] or "Photo", "upload", ext=ext)
    _assign_role(p, img, role)
    return projects.save(p)


def _assign_role(p: dict, img: dict, role: str):
    if role == "source":
        p["ai_app"]["source_image"] = img["id"]
    elif role == "result":
        p["ai_app"]["result_image"] = img["id"]


class ImageRequest(BaseModel):
    prompt: str
    name: str = ""
    source: str = ""  # vide = création, sinon retouche de cette image
    role: str = ""  # "source" / "result" : assigne l'image à la scène IA


@app.post("/api/projects/{pid}/images/generate")
def generate_image(pid: str, body: ImageRequest):
    p = _load(pid)
    try:
        if body.source:
            src = projects.image_path(p, body.source)
            if not src:
                raise ValueError("Image source introuvable")
            data, mime = gemini.edit_photo(src, body.prompt)
            origin = "edited"
        else:
            data, mime = gemini.create_photo(body.prompt)
            origin = "generated"
    except Exception as exc:
        _fail(exc)
    p = _load(pid)  # recharge : l'utilisateur a pu modifier pendant la génération
    name = body.name or ("Photo modifiée" if body.source else "Photo générée")
    img = projects.add_image(p, data, name, origin, body.prompt, ext=EXT_BY_MIME.get(mime, ".png"))
    _assign_role(p, img, body.role)
    return projects.save(p)


@app.delete("/api/projects/{pid}/images/{img_id}")
def delete_image(pid: str, img_id: str):
    p = _load(pid)
    img = next((i for i in p["images"] if i["id"] == img_id), None)
    if img:
        (projects.project_dir(pid) / "images" / img["file"]).unlink(missing_ok=True)
        p["images"].remove(img)
        for key in ("source_image", "result_image"):
            if p["ai_app"].get(key) == img_id:
                p["ai_app"][key] = ""
    return projects.save(p)


# ------------------------------- Musique --------------------------------
@app.post("/api/projects/{pid}/music")
async def upload_music(pid: str, file: UploadFile = File(...)):
    p = _load(pid)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".mp3", ".wav", ".m4a", ".aac", ".ogg"):
        raise HTTPException(400, "Format accepté : MP3, WAV, M4A, AAC ou OGG")
    d = projects.project_dir(pid)
    if p["audio"].get("music"):
        (d / p["audio"]["music"]).unlink(missing_ok=True)
    name = f"music{ext}"
    (d / name).write_bytes(await file.read())
    p["audio"]["music"] = name
    p["audio"]["music_name"] = file.filename
    return projects.save(p)


@app.delete("/api/projects/{pid}/music")
def delete_music(pid: str):
    p = _load(pid)
    if p["audio"].get("music"):
        (projects.project_dir(pid) / p["audio"]["music"]).unlink(missing_ok=True)
    p["audio"]["music"] = ""
    p["audio"]["music_name"] = ""
    return projects.save(p)


# ------------------------------- Script ---------------------------------
class ScriptRequest(BaseModel):
    idea: str
    character: str = "mon père"


def apply_script(p: dict, s: dict) -> dict:
    # Seuls les champs présents dans la réponse remplacent l'existant
    for src, (section, key) in {
        "title": (None, "title"), "youtube_title": (None, "youtube_title"), "hook_text": ("hook", "text"),
        "contact_name": ("chat", "contact_name"), "app_prompt": ("ai_app", "prompt_text"),
        "edit_prompt": ("ai_app", "edit_prompt"), "photo_prompt": ("ai_app", "photo_prompt"),
    }.items():
        value = str(s.get(src) or "").strip()
        if value:
            (p[section] if section else p)[key] = value
    msgs = []
    for m in s.get("messages", []):
        who = "me" if m.get("from") == "me" else "them"
        if m.get("type") == "image":
            ref = projects.SOURCE_REF if m.get("image") == "source" else projects.RESULT_REF
            msgs.append({"from": who, "type": "image", "image": ref, "text": "", "speak": False})
        elif m.get("type") == "sticker" and (m.get("text") or "").strip():
            msgs.append({"from": who, "type": "sticker", "text": m["text"].strip(), "speak": False})
        elif (m.get("text") or "").strip():
            msgs.append({"from": who, "type": "text", "text": m["text"].strip(), "speak": True})
    p["chat"]["messages"] = msgs
    return p


@app.post("/api/projects/{pid}/script")
def write_script(pid: str, body: ScriptRequest):
    p = _load(pid)
    try:
        s = gemini.write_script(body.idea, body.character, projects.image_path(p, projects.SOURCE_REF), p["format"])
    except Exception as exc:
        _fail(exc)
    p = _load(pid)
    p["idea"], p["character"] = body.idea, body.character
    return projects.save(apply_script(p, s))


# --------------------------------- Idées ---------------------------------
@app.get("/api/ideas")
def list_ideas():
    known = {p["id"]: p["title"] for p in projects.list_all()}
    out = []
    for idea in ideas.list_all():
        pid = idea.get("project_id", "")
        out.append({**idea, "project_exists": pid in known, "project_title": known.get(pid, "")})
    return out


class IdeaIn(BaseModel):
    text: str = ""
    character: str = ""
    notes: str = ""
    format: str = "prank"
    views: int = 0
    bulk: str = ""  # plusieurs idées, une par ligne


@app.post("/api/ideas")
def add_ideas(body: IdeaIn):
    try:
        if body.bulk.strip():
            return ideas.add_many(body.bulk, body.character, body.format)
        return [ideas.add(body.text, body.character, body.notes, body.format, body.views)]
    except ValueError as exc:
        _fail(exc)


@app.put("/api/ideas/{idea_id}")
def update_idea(idea_id: str, changes: dict):
    try:
        return ideas.update(idea_id, changes)
    except KeyError as exc:
        raise HTTPException(404, str(exc))


@app.delete("/api/ideas/{idea_id}")
def delete_idea(idea_id: str):
    ideas.delete(idea_id)
    return {"ok": True}


@app.post("/api/ideas/{idea_id}/project")
def project_from_idea(idea_id: str):
    """Crée le projet vidéo à partir de l'idée (ou renvoie celui déjà lié)."""
    idea = next((i for i in ideas.list_all() if i["id"] == idea_id), None)
    if not idea:
        raise HTTPException(404, "Idée introuvable")
    if idea.get("project_id") and idea["project_id"] in {p["id"] for p in projects.list_all()}:
        return {"project_id": idea["project_id"]}
    p = projects.apply_format(projects.default_project(idea["text"][:60]), idea.get("format", "prank"))
    p["idea"] = idea["text"]
    p["character"] = idea["character"] or ("" if p["format"] == "story" else p["character"])
    projects.save(p)
    ideas.update(idea_id, {"project_id": p["id"], "status": "doing" if idea["status"] == "todo" else idea["status"]})
    return {"project_id": p["id"]}


@app.get("/api/ideas/prompt")
def ideas_prompt(fmt: str = "prank"):
    return {"prompt": ideas.suggest_prompt(fmt)}


# ------------------ Mode manuel (Gemini gratuit, sans clé) ----------------
@app.get("/api/projects/{pid}/prompts")
def get_prompts(pid: str):
    """Prompts prêts à coller dans l'appli ou le site Gemini."""
    p = _load(pid)
    a = p["ai_app"]
    return {
        "script": gemini.story_prompt(p.get("idea", "")) if p["format"] == "story"
        else gemini.script_prompt(p.get("idea", ""), p.get("character", "")),
        "edit": gemini.edit_prompt(a["edit_prompt"]) if a.get("edit_prompt") else "",
        "photo": gemini.photo_prompt(a.get("photo_prompt") or p.get("idea", "")) if (a.get("photo_prompt") or p.get("idea")) else "",
    }


class ScriptImport(BaseModel):
    text: str


@app.post("/api/projects/{pid}/script/import")
def import_script(pid: str, body: ScriptImport):
    p = _load(pid)
    try:
        s = gemini.parse_script(body.text)
    except Exception as exc:
        _fail(exc)
    return projects.save(apply_script(p, s))


# --------------------------- Tâches de fond -----------------------------
def start_job(kind: str, pid: str, fn) -> dict:
    job = {"id": uuid.uuid4().hex[:10], "kind": kind, "project": pid, "status": "running",
           "progress": 0, "message": "Démarrage…", "error": "", "result": None}
    JOBS[job["id"]] = job

    def progress(pct, msg):
        job["progress"] = round(float(pct), 1)
        job["message"] = msg

    def run():
        try:
            job["result"] = fn(progress)
            job["status"] = "done"
            job["progress"] = 100
        except Exception as exc:
            traceback.print_exc()
            job["status"] = "error"
            job["error"] = str(exc)

    threading.Thread(target=run, daemon=True).start()
    return job


def _render(pid: str, progress) -> dict:
    with RENDER_LOCK:
        p = projects.load(pid)
        out = pipeline.render_video(p, base_url(), f"{base_url()}/stage/stage.html", progress)
        p = projects.load(pid)
        p["output"] = out.name
        projects.save(p)
        ideas.mark_done_for_project(pid)
        return {"video": f"/files/{pid}/{out.name}"}


@app.post("/api/projects/{pid}/render")
def render(pid: str):
    _load(pid)
    return start_job("render", pid, lambda progress: _render(pid, progress))


class AutoRequest(BaseModel):
    idea: str
    character: str = "mon père"
    render: bool = True


@app.post("/api/projects/{pid}/auto")
def auto(pid: str, body: AutoRequest):
    """Tout en un : script -> photo d'origine (si absente) -> photo modifiée -> vidéo."""
    _load(pid)

    def run(progress):
        p = projects.load(pid)
        p["idea"], p["character"] = body.idea, body.character
        progress(3, "Écriture du script avec Gemini…")
        src = projects.image_path(p, projects.SOURCE_REF)
        story = p["format"] == "story"
        script = gemini.write_script(body.idea, body.character, src, p["format"])
        apply_script(p, script)
        projects.save(p)
        if not src:
            progress(15, "Création de la photo d'accroche…" if story else "Création de la photo d'origine…")
            data, mime = gemini.create_photo(p["ai_app"]["photo_prompt"] or body.idea)
            img = projects.add_image(p, data, "Photo d'accroche" if story else "Photo originale", "generated",
                                     p["ai_app"]["photo_prompt"], ext=EXT_BY_MIME.get(mime, ".png"))
            p["ai_app"]["source_image"] = img["id"]
            projects.save(p)
            src = projects.image_path(p, projects.SOURCE_REF)
        if story:  # pas de retouche dans le format POV
            return _render(pid, lambda pct, msg: progress(30 + pct * 0.7, msg)) if body.render else {"video": None}
        progress(30, "Retouche de la photo avec Gemini…")
        data, mime = gemini.edit_photo(src, p["ai_app"]["edit_prompt"] or body.idea)
        img = projects.add_image(p, data, "Photo modifiée", "edited", p["ai_app"]["edit_prompt"],
                                 ext=EXT_BY_MIME.get(mime, ".png"))
        p["ai_app"]["result_image"] = img["id"]
        projects.save(p)
        if not body.render:
            return {"video": None}
        return _render(pid, lambda pct, msg: progress(45 + pct * 0.55, msg))

    return start_job("auto", pid, run)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Tâche inconnue")
    return job


# ------------------------------- Série ----------------------------------
@app.get("/api/series")
def series_overview():
    """Tous les projets avec leur état : prêt, à compléter (et pourquoi), vidéo déjà faite."""
    out = []
    for meta in projects.list_all():
        try:
            p = projects.load(meta["id"])
        except (OSError, ValueError):
            continue
        video = p.get("output", "")
        exists = bool(video) and (projects.project_dir(p["id"]) / video).exists()
        out.append({
            "id": p["id"], "title": p["title"], "format": p.get("format", "prank"), "created": p.get("created", ""),
            "problems": pipeline.problems(p), "messages": len(p["chat"].get("messages", [])),
            "video": f"/files/{p['id']}/{video}" if exists else "", "youtube_title": p.get("youtube_title", ""),
            "hook_text": p["hook"].get("text", ""),
            "source": _img_url(p, projects.SOURCE_REF), "result": _img_url(p, projects.RESULT_REF),
            "has_edit_prompt": bool(p["ai_app"].get("edit_prompt")),
            "caption": export.caption(p), "yt_title": export.youtube_title(p),
            "exported": bool(p.get("export_folder")) and (export.export_root() / p["export_folder"]).exists(),
            "export_name": p.get("export_folder", ""),
        })
    return out


# ------------------------------- Export ---------------------------------
def _export(pid: str) -> dict:
    p = _load(pid)
    try:
        folder = export.export_project(p)
    except (FileNotFoundError, OSError) as exc:
        _fail(exc)
    projects.save(p)
    return {"folder": str(folder), "name": folder.name}


@app.post("/api/projects/{pid}/export")
def export_one(pid: str):
    """Copie vidéo + image + légende dans <dossier d'export>/<titre de la vidéo>/."""
    return _export(pid)


@app.post("/api/series/export-all")
def export_all(body: dict):
    done, errors = [], []
    for pid in body.get("ids") or []:
        try:
            done.append(_export(pid)["name"])
        except HTTPException as exc:
            errors.append(f"{pid} : {exc.detail}")
    return {"exported": done, "errors": errors, "root": str(export.export_root())}


@app.post("/api/open-folder")
def open_folder(body: dict):
    """Ouvre le dossier d'export (ou un de ses sous-dossiers) dans l'explorateur."""
    root = export.export_root().resolve()
    target = (root / (body.get("name") or "")).resolve()
    if root != target and root not in target.parents:
        raise HTTPException(400, "Dossier hors du dossier d'export")
    target.mkdir(parents=True, exist_ok=True)
    export.open_folder(target)
    return {"ok": True, "path": str(target)}


def _img_url(p: dict, ref: str) -> str:
    img = projects.find_image(p, ref)
    return f"/files/{p['id']}/images/{img['file']}" if img else ""


class BatchIdeas(BaseModel):
    idea_ids: list
    format: str = "prank"
    text: str = ""


def _batch_ideas(body: BatchIdeas) -> list:
    known = {i["id"]: i for i in ideas.list_all()}
    chosen = [known[i] for i in body.idea_ids if i in known]
    if not chosen:
        raise HTTPException(400, "Choisis au moins une idée.")
    return chosen


@app.post("/api/series/batch-prompt")
def batch_prompt(body: BatchIdeas):
    """Un seul prompt Gemini pour écrire les scripts de plusieurs idées d'un coup."""
    return {"prompt": gemini.batch_prompt(_batch_ideas(body), body.format)}


@app.post("/api/series/batch-import")
def batch_import(body: BatchIdeas):
    """Crée (ou réutilise) le projet de chaque idée et y applique le script correspondant, dans l'ordre."""
    chosen = _batch_ideas(body)
    try:
        scripts = gemini.parse_batch(body.text)
    except Exception as exc:
        _fail(exc)
    created = []
    for idea, script in zip(chosen, scripts):
        ideas.update(idea["id"], {"format": body.format})
        pid = project_from_idea(idea["id"])["project_id"]
        p = projects.load(pid)
        if p.get("format") != body.format:
            projects.apply_format(p, body.format)
        projects.save(apply_script(p, script))
        created.append(pid)
    return {"project_ids": created, "scripts": len(scripts), "ideas": len(chosen)}


class SeriesRequest(BaseModel):
    ids: list


SERIES = {"job": None, "cancel": False}


@app.post("/api/series/render")
def series_render(body: SeriesRequest):
    current = SERIES["job"]
    if current and current["status"] == "running":
        raise HTTPException(409, "Une série est déjà en cours.")
    ids = [i for i in body.ids if isinstance(i, str)]
    if not ids:
        raise HTTPException(400, "Coche au moins un projet.")
    items = []
    for pid in ids:
        p = _load(pid)
        items.append({"id": pid, "title": p["title"], "status": "waiting", "progress": 0, "message": "En attente",
                      "video": "", "error": ""})
    SERIES["cancel"] = False

    def run(progress):
        for n, item in enumerate(items):
            if SERIES["cancel"]:
                item.update(status="cancelled", message="Annulée")
                continue
            item.update(status="running", message="Démarrage…")

            def step(pct, msg, item=item, n=n):
                item.update(progress=round(float(pct), 1), message=msg)
                progress((n + pct / 100) / len(items) * 100, f"Vidéo {n + 1}/{len(items)} : {item['title']}")

            try:
                item["video"] = _render(item["id"], step)["video"]
                item.update(status="done", progress=100, message="Vidéo prête")
            except Exception as exc:
                traceback.print_exc()
                item.update(status="error", message="Échec", error=str(exc))
        done = sum(i["status"] == "done" for i in items)
        progress(100, f"Série terminée : {done}/{len(items)} vidéo(s)")
        return {"done": done}

    job = start_job("series", "", run)
    job["items"] = items
    SERIES["job"] = job
    return job


@app.get("/api/series/job")
def series_job():
    return SERIES["job"] or {}


@app.post("/api/series/cancel")
def series_cancel():
    SERIES["cancel"] = True
    return {"ok": True}


def _free_port(start: int) -> int:
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex((HOST, port)) != 0:
                return port
    return start


if __name__ == "__main__":
    PORT = _free_port(PORT)
    url = f"{base_url()}/"
    print(f"\n  TiktokMaker est lancé : {url}\n  (ferme cette fenêtre pour l'arrêter)\n")
    if not os.environ.get("TIKTOKMAKER_NO_BROWSER"):
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
