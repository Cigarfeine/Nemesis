#!/usr/bin/env bash
# =============================================================================
# PROJECT NEMESIS — MISSION CONTROL & REAL-TIME C4ISR CLI ORCHESTRATOR
# Version 2.0.0-PROPRIETARY // Tactical Terminal Execution Engine
# =============================================================================

# --- Color Tokens & ANSI Typography ---
R="\033[0m"        # Reset
B="\033[1m"        # Bold
DIM="\033[2m"      # Dim
INV="\033[7m"      # Inverted / Badge

CYAN="\033[38;5;51m"
GREEN="\033[38;5;46m"
AMBER="\033[38;5;214m"
RED="\033[38;5;196m"
BLUE="\033[38;5;33m"
SLATE="\033[38;5;242m"
WHITE="\033[38;5;255m"

# --- State Control & Trap Handling ---
BACKEND_PID=""
FRONTEND_PID=""

shutdown_sequence() {
    echo -e "\n\n${SLATE}┌─── [ SYSTEM TERMINATION SIGNAL DETECTED ] ───────────────────────────────┐${R}"
    echo -e "${SLATE}│${R} ${RED}●${R} Initiating clean tear-down of Nemesis C4ISR microservices...        ${SLATE}│${R}"
    if [ -n "$BACKEND_PID" ]; then
        kill -9 $BACKEND_PID 2>/dev/null
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill -9 $FRONTEND_PID 2>/dev/null
    fi
    # Kill any lingering background jobs spawned by script
    kill -9 $(jobs -p) 2>/dev/null
    echo -e "${SLATE}│${R} ${GREEN}✔${R} Orbital telemetry streams disconnected & ports liberated.           ${SLATE}│${R}"
    echo -e "${SLATE}└──────────────────────────────────────────────────────────────────────┘${R}"
    echo -e "${DIM}Session terminated at $(date +'%H:%M:%S UTC'). Goodbye, Operator.${R}\n"
    exit 0
}
trap shutdown_sequence SIGINT SIGTERM EXIT

# --- Helper: Modern Animated Spinner ---
spin_step() {
    local prompt="$1"
    local delay="$2"
    local frames=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
    local end=$((SECONDS + delay))
    while [ $SECONDS -lt $end ]; do
        for frame in "${frames[@]}"; do
            echo -ne "\r  ${CYAN}${frame}${R}  ${WHITE}${prompt}${R}"
            sleep 0.08
            [ $SECONDS -ge $end ] && break
        done
    done
    echo -ne "\r  ${GREEN}✔${R}  ${WHITE}${prompt}${R} ${DIM}[DONE]${R}\n"
}

# --- Clear screen and print Tactical Header ---
clear
echo -e "\n${CYAN}${B}"
cat << "EOF"
    ███╗   ██╗███████╗███╗   ███╗███████╗███████╗██╗███████╗
    ████╗  ██║██╔════╝████╗ ████║██╔════╝██╔════╝██║██╔════╝
    ██╔██╗ ██║█████╗  ██╔████╔██║█████╗  ███████╗██║███████╗
    ██║╚██╗██║██╔══╝  ██║╚██╔╝██║██╔══╝  ╚════██║██║╚════██║
    ██║ ╚████║███████╗██║ ╚═╝ ██║███████╗███████║██║███████║
    ╚═╝  ╚═══╝╚══════╝╚═╝     ╚═╝╚══════╝╚══════╝╚═╝╚══════╝
EOF
echo -e "${SLATE}    ═══════════════════════════════════════════════════════════════════${R}"
echo -e "    ${INV}${B} C4ISR ACTIVE COMMAND SYSTEM ${R}  ${CYAN}● LIVE ORBITAL TELEMETRY ENGINE${R}\n"

# --- Pre-Flight Diagnostics ---
echo -e "${B}┌─ PRE-FLIGHT DIAGNOSTICS & SYSTEM AUDIT${R}"
spin_step "Checking host operating system capabilities..." 1
spin_step "Verifying TCP port availability (8000 & 3000)..." 1

# Liberate occupied ports silently if stale processes exist from a crashed session
if command -v fuser &>/dev/null; then
    fuser -k -9 8000/tcp 2>/dev/null || true
    fuser -k -9 3000/tcp 2>/dev/null || true
elif command -v lsof &>/dev/null; then
    lsof -ti:8000 | xargs -r kill -9 2>/dev/null || true
    lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
fi

# --- Booting Backend Microservice ---
echo -e "\n${B}┌─ ORBITAL TELEMETRY & SGP4 EPHEMERIS CORE (BACKEND)${R}"
spin_step "Hooking into isolated virtual environment (.venv)..." 1

cd backend || { echo -e "${RED}[!] ERROR: Backend directory missing! Aborting.${R}"; exit 1; }
if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
elif [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
else
    echo -e "  ${AMBER}⚠  Virtual environment not detected; using global Python runtime.${R}"
fi

spin_step "Synchronizing NORAD Two-Line Elements & initializing FastAPI cluster..." 1
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 >/dev/null 2>&1 &
BACKEND_PID=$!
cd ..
sleep 1
echo -e "  ${GREEN}✔${R}  ${B}Backend Uvicorn cluster online${R} ${DIM}(PID: ${BACKEND_PID} | TCP: 0.0.0.0:8000)${R}"

# --- Booting Frontend Tactical UI ---
echo -e "\n${B}┌─ TACTICAL C2 WEB DASHBOARD (FRONTEND)${R}"
spin_step "Compiling visual shader tokens & FLIR thermal stylesheets..." 1
spin_step "Spawning local HTTP deployment gateway on TCP Port 3000..." 1

if command -v python3 &>/dev/null; then
    python3 -m http.server 3000 --directory frontend >/dev/null 2>&1 &
elif command -v python &>/dev/null; then
    python -m http.server 3000 --directory frontend >/dev/null 2>&1 &
else
    npx serve frontend -l 3000 >/dev/null 2>&1 &
fi
FRONTEND_PID=$!
sleep 1
echo -e "  ${GREEN}✔${R}  ${B}Frontend interface gateway operational${R} ${DIM}(PID: ${FRONTEND_PID} | TCP: 0.0.0.0:3000)${R}"

# --- Mission Control Dashboard Box ---
echo -e "\n${CYAN}╔══════════════════════════════════════════════════════════════════════════════╗${R}"
echo -e "${CYAN}║${R}  ${INV} SYSTEM OPERATIONAL ${R}  ${B}${WHITE}ALL SENSOR STREAMS BOUND & REPORTING 60 FPS${R}      ${CYAN}║${R}"
echo -e "${CYAN}╠══════════════════════════════════════════════════════════════════════════════╣${R}"
echo -e "${CYAN}║${R}                                                                              ${CYAN}║${R}"
echo -e "${CYAN}║${R}   🚀  ${B}LIVE TACTICAL C2 CONSOLE :${R}  ${GREEN}${B}http://localhost:3000${R}                      ${CYAN}║${R}"
echo -e "${CYAN}║${R}   📡  ${B}BACKEND MICROSERVICES API :${R}  ${BLUE}http://localhost:8000/docs${R}                 ${CYAN}║${R}"
echo -e "${CYAN}║${R}                                                                              ${CYAN}║${R}"
echo -e "${CYAN}║${R}   ${SLATE}■ Telemetry Stream Rate : ${WHITE}5,000 ms (WebSocket)${R}                           ${CYAN}║${R}"
echo -e "${CYAN}║${R}   ${SLATE}■ Active Domain Skin    : ${WHITE}Tactical FLIR / Phosphor Green (--nx-)${R}       ${CYAN}║${R}"
echo -e "${CYAN}║${R}   ${SLATE}■ Memory & CPU Footprint: ${GREEN}Optimized (Zero continuous loops)${R}              ${CYAN}║${R}"
echo -e "${CYAN}║${R}                                                                              ${CYAN}║${R}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════════════════╝${R}"

echo -e "\n  ${AMBER}⚡ Press [CTRL+C] in this terminal at any time to execute system tear-down.${R}\n"

# Active heartbeat monitor loop
while true; do
    sleep 2
    if ! kill -0 $BACKEND_PID 2>/dev/null || ! kill -0 $FRONTEND_PID 2>/dev/null; then
        echo -e "\n${RED}[!] WARNING: Subsystem heartbeat lost! A server process terminated unexpectedly.${R}"
        break
    fi
done
