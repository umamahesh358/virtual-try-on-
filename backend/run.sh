#!/bin/bash

# Get the directory of the script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$DIR"

# Ensure we have the right environment and start the backend
echo "Starting backend..."
uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Start the frontend
echo "Starting frontend..."
cd ../frontend
python3 -m http.server 3000 &
FRONTEND_PID=$!

echo "Virtual Try-On is running!"
echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:3000"
echo "Admin Panel: http://localhost:3000/admin"

# Wait for both processes
wait $BACKEND_PID
wait $FRONTEND_PID
