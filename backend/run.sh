#!/bin/bash

# Start FastAPI backend in background
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait for backend to start
sleep 2

# Start a simple HTTP server for frontend
cd /app/frontend
python3 -m http.server 8080 &
FRONTEND_PID=$!

echo "Backend running on port 8000"
echo "Frontend running on port 8080"

# Wait for processes
wait $BACKEND_PID
wait $FRONTEND_PID
