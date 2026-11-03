@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "PY=.venv\Scripts\python.exe"

if not exist "%PY%" (
  echo Creation de l'environnement Python...
  py -3 -m venv .venv 2>nul || python -m venv .venv
)
if not exist "%PY%" (
  echo.
  echo [ERREUR] Python 3.10+ est introuvable. Installe-le depuis https://www.python.org/downloads/
  echo          ^(coche "Add python.exe to PATH" pendant l'installation^)
  pause
  exit /b 1
)

fc /b requirements.txt ".venv\.installed" >nul 2>&1
if errorlevel 1 (
  echo Installation des dependances ^(une seule fois, quelques minutes^)...
  "%PY%" -m pip install --upgrade pip
  "%PY%" -m pip install -r requirements.txt || goto :fail
  "%PY%" -m playwright install chromium || goto :fail
  copy /y requirements.txt ".venv\.installed" >nul
)

"%PY%" app.py
pause
exit /b 0

:fail
echo [ERREUR] L'installation a echoue.
pause
exit /b 1
