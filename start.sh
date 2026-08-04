#!/usr/bin/env bash
# =============================================================================
# PROJECT NEMESIS — REAL-TIME C4ISR & SPACE SITUATIONAL AWARENESS LAUNCHER
# =============================================================================

# Clean shutdown handler to gracefully terminate background servers on exit
cleanup() {
    echo -e "\n\033[0;31m[NEMESIS C4ISR SYSTEM SHUTDOWN INITIATED — TERMINATING TELEMETRY STREAMS]\033[0m"
    kill $(jobs -p) 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

echo -e "\033[1;36m"
cat << "EOF"
███████╗███████╗██████╗ ███████╗ ██████╗███████╗███████╗
██╔════╝██╔════╝██╔══██╗██╔════╝██╔════╝██╔════╝██╔════╝
███████╗█████╗  ██████╔╝█████╗  ██║     ███████╗█████╗  
╚════██║██╔══╝  ██╔══██╗██╔══╝  ██║     ╚════██║██╔══╝  
███████║███████╗██║  ██║███████╗╚██████╗███████║███████╗
╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝ ╚═════╝╚══════╝╚══════╝
EOF
echo -e "── [MISSION CONTROL SERVER LAUNCH SEQUENCE INITIALIZING] ──\033[0m\n"

# 1. Initialize & Boot Backend C4ISR Engine
echo -e "\033[1;32m[+] Activating Orbital Telemetry & SGP4 Ephemeris Backend (Port 8000)...\033[0m"
cd backend || { echo "[!] Backend directory not found!"; exit 1; }

if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
elif [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

# Run asynchronous FastAPI Uvicorn engine in the background
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 &
cd ..

# Allow 2 seconds for backend initialization and NORAD TLE syncing
sleep 2

# 2. Initialize Tactical C2 Web Console (Port 3000)
echo -e "\n\033[1;34m[+] Launching Tactical HUD & WebGL Visualization Dashboard (Port 3000)...\033[0m"
echo -e "\033[1;33m[*] Access Active Tactical Dashboard at: => http://localhost:3000 <= \033[0m"
echo -e "\033[2m    Press [CTRL+C] in this terminal at any time to cleanly shut down both servers.\033[0m\n"

# Serve frontend using native Python HTTP server or Node fallback
if command -v python3 &>/dev/null; then
    python3 -m http.server 3000 --directory frontend
elif command -v python &>/dev/null; then
    python -m http.server 3000 --directory frontend
else
    npx serve frontend -l 3000
fi
