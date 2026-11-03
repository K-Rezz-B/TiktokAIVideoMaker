"""Appels à l'API Gemini : génération / retouche d'images et écriture du script."""
import json
import re
from pathlib import Path

from google import genai
from google.genai import types

from .config import load_settings

REALISM_SUFFIX = (
    " The result must look like a genuine, unedited amateur smartphone photo: same camera angle, "
    "same framing, same lighting and weather, natural colors, realistic textures and shadows. "
    "No text, no watermark, no borders."
)


class GeminiError(RuntimeError):
    pass


def _client() -> genai.Client:
    key = load_settings().get("gemini_api_key", "")
    if not key:
        raise GeminiError("Clé API Gemini manquante : ajoute-la dans ⚙️ Réglages.")
    return genai.Client(api_key=key)


def _mime(path: Path) -> str:
    ext = path.suffix.lower()
    return {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(ext, "image/png")


def _extract_image(resp):
    texts = []
    for cand in resp.candidates or []:
        for part in (cand.content.parts if cand.content else None) or []:
            if part.inline_data and part.inline_data.data:
                return part.inline_data.data, part.inline_data.mime_type or "image/png"
            if part.text:
                texts.append(part.text)
    reason = ""
    if resp.candidates:
        reason = str(resp.candidates[0].finish_reason or "")
    detail = " ".join(texts).strip() or reason or "réponse vide"
    raise GeminiError(f"Gemini n'a pas renvoyé d'image ({detail}). Reformule la demande ou change de modèle.")


def generate_image(prompt: str, refs: list = None, aspect_ratio: str = None):
    """Génère (ou retouche si refs fournies) une image. Retourne (bytes, mime)."""
    settings = load_settings()
    model = settings["gemini_image_model"]
    contents = []
    for ref in refs or []:
        contents.append(types.Part.from_bytes(data=Path(ref).read_bytes(), mime_type=_mime(Path(ref))))
    contents.append(prompt)

    client = _client()
    base = dict(response_modalities=["TEXT", "IMAGE"])
    configs = []
    if aspect_ratio:
        configs.append(types.GenerateContentConfig(**base, image_config=types.ImageConfig(aspect_ratio=aspect_ratio)))
    configs.append(types.GenerateContentConfig(**base))

    last_err = None
    for config in configs:
        try:
            resp = client.models.generate_content(model=model, contents=contents, config=config)
            return _extract_image(resp)
        except GeminiError:
            raise
        except Exception as exc:  # image_config non supporté par certains modèles -> on réessaie sans
            last_err = exc
    raise GeminiError(f"Erreur Gemini ({model}) : {last_err}")


def edit_prompt(instruction: str) -> str:
    return f"Edit this photo. {instruction.strip()}{REALISM_SUFFIX}"


def photo_prompt(description: str) -> str:
    return (
        f"A realistic amateur photo taken with a smartphone, portrait orientation (3:4): {description.strip()}. "
        "Everyday, slightly imperfect framing, natural light, looks 100% real, not AI, no people posing, "
        "no text, no watermark."
    )


def edit_photo(source: Path, instruction: str):
    return generate_image(edit_prompt(instruction), refs=[source])


def create_photo(description: str):
    return generate_image(photo_prompt(description), aspect_ratio="3:4")


SCRIPT_PROMPT = """Tu es scénariste de vidéos TikTok/Shorts françaises virales au format « Je fais croire à {character} que … ».

Le concept : on prend une vraie photo (maison, jardin, voiture, cuisine…), on la modifie avec une IA pour créer une situation absurde, puis on l'envoie par SMS au proche pour le faire paniquer. La vidéo montre la fausse conversation iMessage.

Règles d'écriture :
- "me" = moi (le farceur). Calme, pince-sans-rire, justifications absurdes, phrases courtes, minuscules, peu de ponctuation.
- "them" = {character}. Réagit de plus en plus fort : MAJUSCULES quand il/elle s'énerve, « ?? », jurons légers (putain, bordel), comparaisons drôles.
- Le proche commence souvent la conversation par une question banale liée au sujet, AVANT que la photo modifiée soit envoyée.
- Envoie la photo modifiée tôt (message de type "image" avec "image": "result"). Le proche peut renvoyer la photo d'origine pour comparer ("image": "source").
- 20 à 30 messages au total, chaque message fait 1 à 15 mots. Escalade jusqu'à une chute drôle à la fin.
- Français familier naturel, comme de vrais SMS. Pas d'émojis dans les messages.
- hook_text : la phrase d'accroche affichée au début, format « Je fais croire à {character} que … » + 1 ou 2 émojis à la fin (ex : 😨💀🤣).
- app_prompt : ce que je tape dans l'appli d'IA, très court et familier (ex : « transforme l'allée »).
- edit_prompt : instruction EN ANGLAIS, précise, pour retoucher la photo d'origine avec une IA d'image (ce qu'il faut changer, en gardant tout le reste identique).
- photo_prompt : description EN ANGLAIS de la photo d'origine (utile si on doit la générer), réaliste et banale.
- contact_name : le nom du contact dans le téléphone, drôle et réaliste (ex : « Papa 🌱 jardinier du dimanche »).
- youtube_title : titre court et drôle + 4 ou 5 hashtags.

Exemple réussi (idée : l'ouvrier a trop rallongé l'allée du jardin) :
them: Les gars de l'allée sont passés ?
me: Oui
them: Je leur ai tout expliqué, 1m20 et pas un centimètre en plus
me: Ils ont déjà fini
them: C'est mieux maintenant que c'est rallongé ?
me: [image result]
them: PUTAIN C'EST QUOI ÇA
them: OÙ EST PASSÉE MA PELOUSE ??
me: L'allée a été rallongée
them: J'ai dit de 1m20
me: Je crois qu'ils ont oublié ce passage
them: ILS ONT RAJOUTÉ 1 KILOMÈTRE BORDEL
them: [image source]
them: C'est tout ce que je voulais
me: C'est ce que je leur ai montré
them: ALORS POURQUOI IL Y A DES PUTAIN DE PLACES DE PARKING ??
me: Ils ont dit que sinon ça faisait vide
them: C'est une allée c'est fait pour être vide
them: On dirait le parking d'un Leclerc
me: Au moins on peut garer plus de voitures
them: ON A QUE 2 VOITURES
me: maintenant on peut en mettre 18 de plus
them: DIS LUI DE ME RENDRE MA PELOUSE

Idée de la vidéo : {idea}
{photo_hint}
Réponds UNIQUEMENT avec un objet JSON de cette forme :
{{
  "title": "titre interne court",
  "youtube_title": "…",
  "hook_text": "…",
  "contact_name": "…",
  "app_prompt": "…",
  "edit_prompt": "…",
  "photo_prompt": "…",
  "messages": [
    {{"from": "them", "type": "text", "text": "…"}},
    {{"from": "me", "type": "image", "image": "result"}}
  ]
}}"""


PHOTO_HINTS = {
    True: "La photo d'origine est jointe : base le scénario et edit_prompt sur ce qu'on voit dessus.",
    False: "Aucune photo fournie : invente une photo d'origine banale adaptée (photo_prompt).",
    None: "Si une photo est jointe, base le scénario et edit_prompt sur ce qu'on voit dessus ; "
          "sinon invente une photo d'origine banale adaptée (photo_prompt).",
}


def script_prompt(idea: str, character: str, has_photo=None) -> str:
    return SCRIPT_PROMPT.format(idea=idea.strip() or "(à toi de trouver une idée drôle)",
                                character=character.strip() or "mon père", photo_hint=PHOTO_HINTS[has_photo])


LINE_RE = re.compile(r"^\s*[-*]?\s*\**(them|me|lui|elle|moi|papa|maman)\**\s*:\s*(.+)$", re.I)


def parse_script(text: str) -> dict:
    """Lit la réponse de Gemini : JSON (même entouré de ```json) ou lignes « them: … / me: … »."""
    text = (text or "").strip()
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            data = json.loads(m.group(0))
            if data.get("messages"):
                return data
        except ValueError:
            pass
    messages = []
    for line in text.splitlines():
        lm = LINE_RE.match(line)
        if not lm:
            continue
        who = "me" if lm.group(1).lower() in ("me", "moi") else "them"
        body = lm.group(2).strip().strip('"')
        img = re.fullmatch(r"\[?\s*(image|photo)\s*(result|source|modifiée|originale)?\s*\]?", body, re.I)
        if img:
            kind = (img.group(2) or "result").lower()
            messages.append({"from": who, "type": "image", "image": "source" if kind in ("source", "originale") else "result"})
        else:
            messages.append({"from": who, "type": "text", "text": body})
    if not messages:
        raise GeminiError("Impossible de lire le script : colle toute la réponse de Gemini (le bloc JSON).")
    return {"messages": messages}


def write_script(idea: str, character: str, source_photo: Path = None) -> dict:
    settings = load_settings()
    prompt = script_prompt(idea, character, bool(source_photo))
    contents = []
    if source_photo:
        contents.append(types.Part.from_bytes(data=source_photo.read_bytes(), mime_type=_mime(source_photo)))
    contents.append(prompt)
    try:
        resp = _client().models.generate_content(
            model=settings["gemini_text_model"],
            contents=contents,
            config=types.GenerateContentConfig(response_mime_type="application/json", temperature=1.0),
        )
    except GeminiError:
        raise
    except Exception as exc:
        raise GeminiError(f"Erreur Gemini ({settings['gemini_text_model']}) : {exc}") from exc
    return parse_script(resp.text or "")


def list_models() -> list:
    out = []
    for m in _client().models.list():
        actions = list(getattr(m, "supported_actions", None) or [])
        if actions and "generateContent" not in actions:
            continue
        name = m.name.removeprefix("models/")
        out.append({"id": name, "label": getattr(m, "display_name", None) or name, "image": "image" in name})
    return sorted(out, key=lambda x: x["id"])
