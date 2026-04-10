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

echo ""
echo "  ⬡  PQ Dashboard"
echo "  ─────────────────────────────────"

# Kill any existing processes on our ports
lsof -ti:$PORT | xargs kill -9 2>/dev/null
lsof -ti:$FRONTEND_PORT | xargs kill -9 2>/dev/null
sleep 1

# Start backend server in background
echo "  🚀 Starting backend server (port $PORT)..."
node server/index.js &
SERVER_PID=$!

# Wait for server to be ready
echo "  ⏳ Waiting for server to parse tasks..."
for i in {1..30}; do
  if curl -s "http://127.0.0.1:$PORT/api/analytics/overview" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Start Vite frontend
echo "  🎨 Starting frontend (port $FRONTEND_PORT)..."
npm run dev &
VITE_PID=$!

# Wait for Vite to be ready
sleep 3

# Open browser
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
