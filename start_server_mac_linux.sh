#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "Starting local server on http://localhost:8000"
echo "Opening the game in your browser..."
URL="http://localhost:8000/PLAY_WILDLANDS.html"
if command -v open >/dev/null 2>&1; then
  open "$URL" || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" || true
fi
echo "(Ctrl+C to stop)"
python3 -m http.server 8000 2>/dev/null || python -m http.server 8000
