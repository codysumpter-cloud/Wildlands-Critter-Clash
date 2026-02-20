@echo off
setlocal
cd /d "%~dp0"
echo Starting local server on http://localhost:8000
echo Opening the game in your browser...
start "" "http://localhost:8000/PLAY_WILDLANDS.html"
echo (Close this window to stop the server.)
python -m http.server 8000 >nul 2>nul || py -m http.server 8000
