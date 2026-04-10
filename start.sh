#!/bin/bash

# PQ Dashboard — Start Script
# Launches the backend server and opens the dashboard in your browser

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Load nvm if available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# Check node is available
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Please install it first."
  exit 1
fi

PORT=3456
FRONTEND_PORT=5173
DB_PATH="./data/dashboard.db"

echo ""
echo "  ⬡  PQ Dashboard"
echo "  ─────────────────────────────────"

# Kill any existing processes on our ports
lsof -ti:$PORT | xargs kill -9 2>/dev/null
lsof -ti:$FRONTEND_PORT | xargs kill -9 2>/dev/null
sleep 1

# Detect first run (no DB yet)
FIRST_RUN=false
if [ ! -f "$DB_PATH" ]; then
  FIRST_RUN=true
  echo "  📦 First run detected — will auto-scan all tasks from pq-config.yaml"
fi

# Start backend server in background
echo "  🚀 Starting backend server (port $PORT)..."
node server/index.js &
SERVER_PID=$!

# Wait for server to be ready (up to 30s)
echo "  ⏳ Waiting for server to be ready..."
for i in {1..30}; do
  if curl -s "http://127.0.0.1:$PORT/api/analytics/overview" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# On first run, trigger a full parse via the refresh API
if [ "$FIRST_RUN" = true ]; then
  echo "  🔍 Scanning tasks from pq-config.yaml..."
  curl -s -X POST "http://127.0.0.1:$PORT/api/refresh" >/dev/null 2>&1

  # Poll until parsing is done (up to 120s)
  for i in {1..120}; do
    PARSING=$(curl -s "http://127.0.0.1:$PORT/api/refresh/status" 2>/dev/null | grep -o '"parsing":false')
    if [ -n "$PARSING" ]; then
      break
    fi
    sleep 1
  done
  echo "  ✅ Initial parse complete"
fi

# Start Vite frontend
echo "  🎨 Starting frontend (port $FRONTEND_PORT)..."
npm run dev &
VITE_PID=$!

# Wait for Vite to be ready then open browser
sleep 3
echo "  🌐 Opening dashboard in browser..."
open "http://localhost:$FRONTEND_PORT"

echo ""
echo "  ✅ PQ Dashboard running!"
echo "  ─────────────────────────────────"
echo "  Dashboard: http://localhost:$FRONTEND_PORT"
echo "  API:       http://localhost:$PORT"
echo ""
echo "  Press Ctrl+C to stop all servers"
echo ""

# Wait and cleanup on exit
trap "echo ''; echo '  Stopping servers...'; kill $SERVER_PID $VITE_PID 2>/dev/null; exit" INT TERM
wait
