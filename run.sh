#!/usr/bin/env bash
# Quick-start: run Docker Buddy directly with Python (no Docker needed)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Create virtualenv if missing
if [ ! -d ".venv" ]; then
  echo "→ Creating virtualenv…"
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

echo "→ Starting Docker Buddy at http://localhost:7070"
uvicorn main:app --host 0.0.0.0 --port 7070 --reload
