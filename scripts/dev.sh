#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload &
BE_PID=$!
cd "$ROOT/frontend" && npm run dev -- --port 3001 &
FE_PID=$!
echo "BE $BE_PID on :8001, FE $FE_PID on :3001 — Ctrl+C to stop"
wait
