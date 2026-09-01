#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

cleanup() {
    echo ""
    echo "🛑 Fermo tutti i processi..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    echo "✅ Fatto."
}

trap cleanup SIGINT SIGTERM EXIT

echo "🚀 Avvio Backend FastAPI (porta 8001)..."
uv sync
(uv run uvicorn backend.main:app --host 127.0.0.1 --port 8001 --reload) &
BACKEND_PID=$!

echo "🚀 Avvio Frontend Vite (porta 3001)..."
(cd frontend && npm run dev -- --port 3001) &
FRONTEND_PID=$!

echo ""
echo "═══════════════════════════════════════════"
echo "  📊 bt-gui"
echo "  🔌 Backend:  http://localhost:8001"
echo "  🌐 Frontend: http://localhost:3001"
echo "  ⏎  Ctrl+C per fermare tutto"
echo "═══════════════════════════════════════════"
echo ""

wait
