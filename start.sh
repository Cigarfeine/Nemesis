#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  PROJECT NEMESIS — Unified Launch Script
#  Starts backend (FastAPI) + frontend (HTTP server) together
#  Usage: chmod +x start.sh && ./start.sh
# ═══════════════════════════════════════════════════════════

set -e

BACKEND_PORT=8000
FRONTEND_PORT=3000

# Colours for terminal output
CYAN='\033[0;36m'
AMBER='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'  # No colour

echo -e "${CYAN}"
echo "  ███╗   ██╗███████╗███╗   ███╗███████╗███████╗██╗███████╗"
echo "  ████╗  ██║██╔════╝████╗ ████║██╔════╝██╔════╝██║██╔════╝"
echo "  ██╔██╗ ██║█████╗  ██╔████╔██║█████╗  ███████╗██║███████╗"
echo "  ██║╚██╗██║██╔══╝  ██║╚██╔╝██║██╔══╝  ╚════██║██║╚════██║"
echo "  ██║ ╚████║███████╗██║ ╚═╝ ██║███████╗███████║██║███████║"
echo "  ╚═╝  ╚═══╝╚══════╝╚═╝     ╚═╝╚══════╝╚══════╝╚═╝╚══════╝"
echo -e "${NC}"
echo -e "${AMBER}  Active Intelligence Platform · Phase I${NC}"
echo ""

# ── Check Python ──
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}  ERROR: python3 not found. Install Python 3.11+${NC}"
    exit 1
fi

# ── Set up virtual env if not present ──
if [ ! -d "backend/.venv" ]; then
    echo -e "${CYAN}  [1/3] Creating Python virtual environment...${NC}"
    python3 -m venv backend/.venv
fi

# ── Activate and install deps ──
echo -e "${CYAN}  [2/3] Installing backend dependencies...${NC}"
source backend/.venv/bin/activate
pip install -q -r backend/requirements.txt
echo -e "${GREEN}  ✓ Dependencies installed${NC}"

# ── Start backend in background ──
echo -e "${CYAN}  [3/3] Starting FastAPI backend on port ${BACKEND_PORT}...${NC}"
cd backend
uvicorn main:app --host 0.0.0.0 --port $BACKEND_PORT &
BACKEND_PID=$!
cd ..
echo -e "${GREEN}  ✓ Backend PID: ${BACKEND_PID}${NC}"

# ── Wait for backend to come up ──
sleep 2

# ── Start frontend server ──
echo -e "${CYAN}  Starting frontend server on port ${FRONTEND_PORT}...${NC}"
python3 -m http.server $FRONTEND_PORT --directory frontend &
FRONTEND_PID=$!
echo -e "${GREEN}  ✓ Frontend PID: ${FRONTEND_PID}${NC}"

echo ""
echo -e "${GREEN}  ═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ NEMESIS ONLINE${NC}"
echo -e "${CYAN}  Open: http://localhost:${FRONTEND_PORT}${NC}"
echo -e "${AMBER}  API:  http://localhost:${BACKEND_PORT}/docs${NC}"
echo -e "${GREEN}  ═══════════════════════════════════════════${NC}"
echo ""
echo "  Press Ctrl+C to shut down all services."
echo ""

# ── Trap Ctrl+C to kill both processes ──
cleanup() {
    echo -e "\n${AMBER}  Shutting down Nemesis...${NC}"
    kill $BACKEND_PID  2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    echo -e "${RED}  ✗ Systems offline${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# ── Wait indefinitely ──
wait
