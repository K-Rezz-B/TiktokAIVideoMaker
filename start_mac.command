#!/bin/bash
# Lanceur macOS : double-clic (après un "chmod +x start_mac.command" la première fois)
cd "$(dirname "$0")"
PY=".venv/bin/python"

if [ ! -x "$PY" ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3.10+ est introuvable. Installe-le depuis https://www.python.org/downloads/macos/"
    read -r -p "Appuie sur Entrée pour fermer…"
    exit 1
  fi
  echo "Création de l'environnement Python…"
  python3 -m venv .venv || { read -r -p "Échec. Entrée pour fermer…"; exit 1; }
fi

if ! cmp -s requirements.txt .venv/.installed; then
  echo "Installation des dépendances (une seule fois, quelques minutes)…"
  "$PY" -m pip install --upgrade pip \
    && "$PY" -m pip install -r requirements.txt \
    && "$PY" -m playwright install chromium \
    && cp requirements.txt .venv/.installed \
    || { echo "L'installation a échoué."; read -r -p "Entrée pour fermer…"; exit 1; }
fi

"$PY" app.py
