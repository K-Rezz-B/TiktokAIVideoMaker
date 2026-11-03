# 🎬 TiktokMaker

Crée automatiquement des vidéos verticales (TikTok / Shorts / Reels) au format
**« Je fais croire à mon père que… »** :

1. **Accroche** : la photo modifiée en plein écran + le texte d'accroche lu à voix haute
2. **Fausse appli d'IA** : on tape la demande au clavier, puis la génération se lance (barre de progression)
3. **Fausse conversation iMessage** : les messages arrivent un par un (bulle « en train d'écrire », bruitages, voix off pour chaque message)

Un second format, **💬 Histoire POV** (l'ancien format de la chaîne), est aussi disponible :
un selfie avec l'accroche « POV : … » encadrée de blanc, puis une conversation SMS sur un ancien iPhone
(opérateur, batterie en %), affichée par pages, avec des émojis envoyés en grand comme stickers.
Le format se choisit en haut de l'étape « 1. L'idée ».

L'outil prépare les prompts pour Gemini (script + retouche photo, utilisable gratuitement par copier-coller), puis fait tout le reste tout seul : voix (Edge TTS ou ElevenLabs), écrans et montage (MP4 1080×1920, 30 i/s).

## Installation et lancement

Il faut **Python 3.10 ou plus** ([python.org](https://www.python.org/downloads/)).
FFmpeg et le navigateur de rendu sont installés automatiquement.

- **Windows** : double-clic sur `start_windows.bat`
- **macOS** : la première fois, dans le Terminal :
  ```bash
  chmod +x start_mac.command
  ```
  puis double-clic sur `start_mac.command` (si macOS bloque : clic droit → Ouvrir).

Le premier lancement installe les dépendances (quelques minutes), puis l'outil s'ouvre dans ton navigateur sur `http://127.0.0.1:8765`.

## Utilisation avec Gemini gratuit (sans clé API)

Gemini s'utilise depuis son appli ou [gemini.google.com](https://gemini.google.com/app) par copier-coller :

1. **Importe ta vraie photo** (maison, jardin, voiture…) dans « Photo originale ».
   Pas de photo ? Clique « 📋 Copier le prompt de la photo », colle-le dans Gemini et réimporte l'image.
2. Écris l'**idée** et à qui tu fais la blague → **📋 Copier le prompt du script**.
   Dans Gemini : joins ta photo originale, colle le prompt, envoie.
3. Copie **toute** la réponse de Gemini, colle-la dans le cadre B → **📥 Importer le script**.
   Les messages, l'accroche, le nom du contact et la consigne de retouche se remplissent.
4. **📋 Copier la consigne de retouche** → dans Gemini : joins la photo originale, colle la consigne.
   Télécharge l'image obtenue et glisse-la dans le cadre « Photo modifiée » (ou copie-la puis <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>V</kbd> dans l'outil).
5. Ajuste ce que tu veux (messages, voix, accroche…) : l'aperçu à droite se met à jour en direct.
   Puis **🎬 Générer la vidéo** et télécharge le MP4. Cette étape n'a besoin d'aucune clé.

## 💡 Liste d'idées

L'onglet **💡 Idées** (en haut de l'outil) sert à suivre tes idées de vidéos en 3 colonnes : **À faire**, **En cours**, **Réalisées**.

- Chaque idée a un format (⚡ Je fais croire à… ou 💬 Histoire POV) ; un filtre permet de n'afficher qu'un format.
- Ajoute une idée (et à qui tu fais la blague) avec le formulaire, ou colle-en plusieurs d'un coup, une par ligne : `l'ouvrier a peint la maison en rose | ma mère`.
- Pas d'inspiration ? « 📋 Copier un prompt pour que Gemini me propose 10 idées » : colle-le dans Gemini, puis recolle sa réponse dans le même cadre.
- **🎬 Créer la vidéo** crée le projet avec l'idée déjà remplie et ouvre l'éditeur. L'idée passe en « En cours », puis en « Réalisée » automatiquement dès que sa vidéo est générée.
- Tu peux aussi glisser une carte d'une colonne à l'autre.

Les idées sont enregistrées dans `projects/ideas.json`, qui est suivi par git (contrairement aux vidéos et images) :
committe et pousse après avoir modifié tes idées, puis `git pull` sur l'autre PC pour les retrouver.

## 🎞️ Mode série (plusieurs vidéos d'un coup)

L'onglet **🎞️ Série** liste tous tes projets avec leur état : ✅ prêt, ⚠️ à compléter (avec la raison) ou 🎬 vidéo déjà faite.

1. Prépare plusieurs projets dans l'éditeur (script importé, photos).
2. Dans **Série**, clique « Cocher les projets prêts sans vidéo » puis **▶ Lancer la série** : les vidéos sont rendues l'une après l'autre (≈ 1 min 30 chacune). Tu peux arrêter après la vidéo en cours.
3. Le **kit de publication** donne, pour chaque vidéo, la légende TikTok / Instagram et le titre YouTube Shorts (100 caractères max, avec #shorts) à copier, et le MP4 à télécharger avec un nom propre.

Astuce : prépare 10 à 15 projets le week-end, lance la série, puis programme les publications (YouTube Studio, TikTok sur ordinateur, Meta Business Suite pour Instagram).

## Utilisation avec une clé API (facultatif)

Dans **⚙️ Réglages**, colle une clé API Gemini ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)) :
des boutons « API » apparaissent, dont **⚡ Tout générer** (script, photo modifiée et vidéo en un clic).
Le bouton « Charger la liste des modèles » affiche les modèles disponibles pour ta clé.

Les vidéos et images sont enregistrées dans `projects/<id-du-projet>/`.

## Voix

| Moteur | Prix | Remarque |
|---|---|---|
| **Edge TTS** (par défaut) | gratuit, sans clé | très bonnes voix françaises (Henri, Remy, Denise, Vivienne…) |
| **ElevenLabs** | payant (clé API) | voix plus expressives, voix clonées de ton compte |

Le moteur de voix est dans `tiktokmaker/tts.py` : on peut y brancher un modèle local (Kokoro, XTTS…) en ajoutant une branche dans `synthesize()`.

## Musique et bruitages

- Ajoute une musique de fond (MP3/WAV…) dans « Voix & son » : elle baisse automatiquement quand quelqu'un parle.
- Les bruitages (envoi, réception, clavier) sont synthétisés par l'outil : aucun fichier sous droits n'est utilisé.

## Bon à savoir

- Sur Mac, les écrans utilisent la police et les émojis Apple. Sur Windows, l'outil prend la police Inter et les émojis Windows.
- Une vidéo de 40 à 60 s prend environ 1 à 2 minutes de rendu.
- Les clés API sont stockées en local dans `settings.json` (jamais envoyées ailleurs qu'à Google / ElevenLabs).

## Structure

```
app.py                 serveur local (FastAPI) + API
tiktokmaker/
  gemini.py            script + génération/retouche d'images
  tts.py               voix (Edge TTS / ElevenLabs)
  pipeline.py          timeline (écrans + sons) et encodage MP4
  renderer.py          capture des écrans HTML avec Chromium (Playwright)
  audio.py             mixage, bruitages, musique
  projects.py          stockage des projets
stage/                 écrans de la vidéo (iMessage, appli IA, accroche) en HTML/CSS
web/                   interface
```
