"""Construit la timeline de la vidéo (écrans + audio) et l'encode en MP4 1080x1920."""
import subprocess
from datetime import datetime
from pathlib import Path

from . import projects, tts
from .audio import FFMPEG, Mixer, _NO_WINDOW, duration, load_audio, trim_silence, write_wav
from .config import FPS
from .renderer import StageRenderer, state_key


class RenderError(RuntimeError):
    pass


def _ease_in_out(t: float) -> float:
    return t * t * (3 - 2 * t)


class Timeline:
    def __init__(self):
        self.segments = []  # [state, nb_frames]
        self.frames = 0
        self.voices = []  # (temps, chemin mp3)
        self.sfx = []  # (temps, nom)

    @property
    def t(self) -> float:
        return self.frames / FPS

    def hold(self, state: dict, seconds: float = None, frames: int = None):
        n = frames if frames is not None else max(1, round(seconds * FPS))
        if self.segments and state_key(self.segments[-1][0]) == state_key(state):
            self.segments[-1][1] += n
        else:
            self.segments.append([state, n])
        self.frames += n


class Builder:
    def __init__(self, project: dict, base_url: str, log=print):
        self.p = project
        self.base_url = base_url.rstrip("/")
        self.log = log
        self.dir = projects.project_dir(project["id"])
        self.tl = Timeline()
        self.pace = float(project.get("pace") or 1.0)
        self._durations = {}

    # --- utilitaires -------------------------------------------------------
    def url(self, ref: str) -> str:
        img = projects.find_image(self.p, ref)
        if not img:
            return ""
        return f"{self.base_url}/files/{self.p['id']}/images/{img['file']}"

    def speak(self, text: str, who: str):
        v = self.p["voices"]
        path = tts.synthesize(text, v.get(who) or v["me"], self.dir / "audio", v.get("provider", "edge"), v.get("rate", 0))
        if not path:
            return None, 0.0
        if path not in self._durations:
            self._durations[path] = duration(trim_silence(load_audio(path)))
        return path, self._durations[path]

    # --- scènes ------------------------------------------------------------
    def hook(self):
        h = self.p["hook"]
        image = self.url(h.get("image") or projects.RESULT_REF)
        if not image:
            raise RenderError("Choisis une photo pour l'accroche (importe-la ou génère-la dans « Les photos »).")
        clip, d = self.speak(h["text"], "narrator") if h.get("speak", True) else (None, 0)
        total = max(2.2, d + 0.7) if clip else 2.5
        if clip:
            self.tl.voices.append((self.tl.t + 0.15, clip))
        n = round(total * FPS)
        state = {"image": image, "text": h["text"], "style": h.get("style", "outline")}
        if not h.get("zoom", True):
            self.tl.hold({"scene": "hook", "hook": {**state, "zoom": 1}}, frames=n)
            return
        for i in range(n):
            self.tl.hold({"scene": "hook", "hook": {**state, "zoom": round(1 + 0.07 * i / n, 4)}}, frames=1)

    def ai_app(self):
        a = self.p["ai_app"]
        src = self.url(a.get("source_image", ""))
        if self.p.get("format") == "story" or not a.get("enabled", True) or not src:
            return
        res = self.url(a.get("result_image", ""))
        base = {"appName": a.get("app_name") or "Ora AI", "image": src, "resultImage": res, "mode": "prompt",
                "typed": "", "pressed": None, "sendPressed": False, "progress": 0, "reveal": 0}

        def st(**kw):
            return {"scene": "app", "app": {**base, **kw}}

        self.tl.hold(st(), 0.4)
        text = a.get("prompt_text") or "modifie la photo"
        # ~0,1 s par lettre, mais 2,2 s maximum : un long texte est tapé plus vite
        frames = max(1, round(min(2.2, 0.1 * len(text)) * FPS))
        shown, last_click = 0, -1.0
        for f in range(frames):
            count = -(-(f + 1) * len(text) // frames)  # arrondi supérieur
            if count > shown:
                ch = text[count - 1]
                if self.tl.t - last_click >= 0.065:
                    self.tl.sfx.append((self.tl.t, "key"))
                    last_click = self.tl.t
                self.tl.hold(st(typed=text[:count], pressed="space" if ch == " " else ch.lower()), frames=1)
                shown = count
            else:
                self.tl.hold(st(typed=text[:count]), frames=1)
        self.tl.hold(st(typed=text), 0.25)
        self.tl.sfx.append((self.tl.t, "send"))
        self.tl.hold(st(typed=text, sendPressed=True), 0.15)
        n = round(1.4 * FPS)
        for i in range(n):
            self.tl.hold(st(mode="generating", progress=int(_ease_in_out((i + 1) / n) * 100)), frames=1)
        if a.get("show_result") and res:
            self.tl.sfx.append((self.tl.t, "done"))
            n = round(0.7 * FPS)
            for i in range(n):
                self.tl.hold(st(mode="result", reveal=round((i + 1) / n, 3)), frames=1)
            self.tl.hold(st(mode="result", reveal=1), 1.0)

    def chat(self):
        c = self.p["chat"]
        base = {"contact": c.get("contact_name") or "Papa", "time": c.get("time") or "16:21",
                "textSize": c.get("text_size") or 14, "style": c.get("style", "modern"),
                "layout": c.get("layout", "scroll"), "carrier": c.get("carrier", "F SFR"),
                "battery": c.get("battery", 76)}
        shown = []

        def st(**kw):
            return {"scene": "chat", "chat": {**base, "messages": list(shown), "typing": False, "anim": 1,
                                              "fromTyping": False, "phase": 0, **kw}}

        self.tl.hold(st(), 0.4)
        msgs = [m for m in c.get("messages", []) if (m.get("text") or "").strip() or m.get("type") == "image"]
        if not msgs:
            raise RenderError("La conversation est vide : ajoute des messages.")
        for m in msgs:
            who = "me" if m.get("from") == "me" else "them"
            kind = m.get("type") if m.get("type") in ("image", "sticker") else "text"
            is_img = kind != "text"  # image ou sticker : pas de voix, temps d'affichage fixe
            item = {"from": who, "type": kind}
            if kind == "image":
                item["image"] = self.url(m.get("image") or projects.RESULT_REF)
                if not item["image"]:
                    raise RenderError("Un message image n'a pas d'image (génère la photo ou choisis-en une).")
            else:
                item["text"] = m["text"].strip()

            from_typing = False
            if who == "them" and c.get("typing_indicator", True):
                for f in range(4):
                    self.tl.hold(st(typing=True, anim=round((f + 1) / 4, 3)), frames=1)
                length = 0.8 if is_img else min(1.1, max(0.5, 0.45 + 0.012 * len(item["text"])))
                n = round(length * self.pace * FPS)
                for f in range(n):
                    self.tl.hold(st(typing=True, phase=(f // 5) % 3), frames=1)
                from_typing = True

            self.tl.sfx.append((self.tl.t, "send" if who == "me" else "receive"))
            clip, d = (None, 0)
            if not is_img and m.get("speak", True):
                clip, d = self.speak(item["text"], who)
                if clip:
                    self.tl.voices.append((self.tl.t + 0.12, clip))
            shown.append(item)
            for f in range(5):
                self.tl.hold(st(anim=round((f + 1) / 5, 3), fromTyping=from_typing), frames=1)
            if clip:
                hold = d + 0.25 * self.pace
            elif is_img:
                hold = (1.6 if kind == "image" else 1.1) * self.pace
            else:
                hold = (0.5 + 0.035 * len(item["text"])) * self.pace
            self.tl.hold(st(), max(0.25, hold - 5 / FPS))
        self.tl.hold(st(), 1.2)

    def build(self) -> Timeline:
        self.log("Génération des voix et de la timeline…")
        self.hook()
        self.ai_app()
        self.chat()
        return self.tl


def render_video(project: dict, base_url: str, stage_url: str, progress=lambda pct, msg: None) -> Path:
    out_dir = projects.project_dir(project["id"])
    builder = Builder(project, base_url, log=lambda m: progress(5, m))
    progress(2, "Génération des voix…")
    tl = builder.build()
    total = tl.frames / FPS

    progress(20, "Mixage audio…")
    mixer = Mixer(total)
    for at, path in tl.voices:
        mixer.add_voice(trim_silence(load_audio(path)), at)
    if project["audio"].get("sfx", True):
        for at, name in tl.sfx:
            mixer.add_sfx(name, at)
    music = project["audio"].get("music")
    music_path = out_dir / music if music else None
    wav = out_dir / "audio" / "mix.wav"
    wav.parent.mkdir(exist_ok=True)
    write_wav(wav, mixer.render(music_path, float(project["audio"].get("music_volume", 0.12))))

    unique = {}
    for state, _ in tl.segments:
        unique.setdefault(state_key(state), state)
    progress(25, f"Rendu des écrans (0/{len(unique)})…")
    images = {}
    with StageRenderer(stage_url) as r:
        for i, (key, state) in enumerate(unique.items()):
            images[key] = r.render(state)
            if i % 10 == 0:
                progress(25 + 45 * i / len(unique), f"Rendu des écrans ({i}/{len(unique)})…")

    progress(70, "Encodage de la vidéo…")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = out_dir / f"video-{stamp}.mp4"
    cmd = [FFMPEG, "-y", "-v", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-",
           "-i", str(wav), "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
           "-vf", "scale=in_range=pc:out_range=tv,format=yuv420p", "-color_range", "tv", "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", "-shortest",
           "-movflags", "+faststart", str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=_NO_WINDOW)
    done = 0
    try:
        for state, n in tl.segments:
            data = images[state_key(state)]
            for _ in range(n):
                proc.stdin.write(data)
            done += n
            progress(70 + 29 * done / tl.frames, "Encodage de la vidéo…")
        proc.stdin.close()
    except BrokenPipeError:
        pass
    err = proc.stderr.read().decode("utf-8", "replace")
    if proc.wait() != 0:
        raise RenderError(f"FFmpeg a échoué : {err[-800:]}")
    progress(100, f"Vidéo prête ({total:.1f} s)")
    return out
