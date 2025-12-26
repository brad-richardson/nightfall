#!/bin/bash
# Combined API + Ticker startup script
# This allows running both processes in a single container while keeping code separate
# Easy to undo: just change Dockerfile CMD back to running API only

set -e

echo "Starting Nightfall combined API + Ticker..."

# Track PIDs for graceful shutdown
API_PID=""
TICKER_PID=""

# Cleanup function
cleanup() {
  echo "Received shutdown signal, stopping processes..."

  # Send SIGTERM to both processes
  if [ -n "$TICKER_PID" ]; then
    echo "Stopping ticker (PID: $TICKER_PID)..."
    kill -TERM "$TICKER_PID" 2>/dev/null || true
  fi

  if [ -n "$API_PID" ]; then
    echo "Stopping API (PID: $API_PID)..."
    kill -TERM "$API_PID" 2>/dev/null || true
  fi

  # Wait for both to exit (with timeout)
  local timeout=10
  local elapsed=0

  while [ $elapsed -lt $timeout ]; do
    if [ -n "$TICKER_PID" ] && kill -0 "$TICKER_PID" 2>/dev/null; then
      sleep 0.5
      elapsed=$((elapsed + 1))
    elif [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
      sleep 0.5
      elapsed=$((elapsed + 1))
    else
      break
    fi
  done

  # Force kill if still running
  [ -n "$TICKER_PID" ] && kill -9 "$TICKER_PID" 2>/dev/null || true
  [ -n "$API_PID" ] && kill -9 "$API_PID" 2>/dev/null || true

  echo "Shutdown complete"
  exit 0
}

# Register signal handlers
trap cleanup SIGTERM SIGINT SIGQUIT

# Start ticker in background
echo "Starting ticker process..."
pnpm --filter @nightfall/ticker start &
TICKER_PID=$!
echo "Ticker started (PID: $TICKER_PID)"

# Give ticker a moment to start
sleep 2

# Start API in foreground
echo "Starting API process..."
pnpm --filter @nightfall/api start &
API_PID=$!
echo "API started (PID: $API_PID)"

# Wait for API process (main process)
wait $API_PID
API_EXIT_CODE=$?

echo "API process exited with code: $API_EXIT_CODE"

# Kill ticker when API exits
if [ -n "$TICKER_PID" ]; then
  kill -TERM "$TICKER_PID" 2>/dev/null || true
  wait "$TICKER_PID" 2>/dev/null || true
fi

exit $API_EXIT_CODE
