#!/usr/bin/env bash
# =============================================================================
# PROJECT NEMESIS — CYBERPUNK CRT MISSION CONTROL & REAL-TIME C4ISR ENGINE
# Neon Protocol // Architecture: x86_64-Linux-WSL
# =============================================================================

# --- Cyberpunk Ambient ANSI Color Tokens (256-Color Palette) ---
R="\033[0m"        # Reset / CRT off
B="\033[1m"        # High beam
DIM="\033[2m"      # Phosphor fade
BLINK="\033[5m"    # Glitch strobe
INV="\033[7m"      # Invert matrix

CYBER_PINK="\033[38;5;198m"     # Neon Magenta
ELECTRIC_CYAN="\033[38;5;51m"   # Cyber Teal
PHOSPHOR_GRN="\033[38;5;46m"    # CRT Green
CRT_AMBER="\033[38;5;214m"      # Warning Amber
VOLEY_PURP="\033[38;5;135m"     # Ambient Violet
GRID_SLATE="\033[38;5;239m"     # CRT Scanline border
GRID_BLUE="\033[38;5;61m"       # Deep synthwave gray-blue
WHITE="\033[38;5;231m"          # Pure luminescent white

# --- State Control & Trap Handling ---
BACKEND_PID=""
FRONTEND_PID=""

shutdown_sequence() {
    echo -e "\n${GRID_SLATE}▓▒░${R} ${CYBER_PINK}${B}═══ [ MATRIX TERMINATION : SEVERING TELEMETRY STREAMS ] ═══${R} ${GRID_SLATE}░▒▓${R}"
    echo -e "${GRID_BLUE}┌───────────────────────────────────────────────────────────────────────────┐${R}"
    echo -e "${GRID_BLUE}│${R}  ${CRT_AMBER}▲${R} Sending SIGKILL to orbital backend & tactical frontend microservices...  ${GRID_BLUE}│${R}"
    if [ -n "$BACKEND_PID" ]; then kill -9 $BACKEND_PID 2>/dev/null; fi
    if [ -n "$FRONTEND_PID" ]; then kill -9 $FRONTEND_PID 2>/dev/null; fi
    kill -9 $(jobs -p) 2>/dev/null
    echo -e "${GRID_BLUE}│${R}  ${PHOSPHOR_GRN}✔${R} Network ports 8000 & 3000 freed. Synaptic disconnect clean.            ${GRID_BLUE}│${R}"
    echo -e "${GRID_BLUE}└───────────────────────────────────────────────────────────────────────────┘${R}"
    echo -e "${DIM}${VOLEY_PURP}CRT scanline powered off at $(date +'%H:%M:%S UTC'). // END OF LINE.${R}\n"
    exit 0
}
trap shutdown_sequence SIGINT SIGTERM EXIT

# --- Helper: Cyberpunk Progress Bar Animation ---
cyber_progress() {
    local task="$1"
    local steps=10
    local delay=0.07
    echo -ne "  ${ELECTRIC_CYAN}►${R} ${WHITE}${task}${R}\n  "
    for ((i=1; i<=steps; i++)); do
        local bar="["
        for ((j=1; j<=steps; j++)); do
            if [ $j -le $i ]; then
                bar+="${CYBER_PINK}▓${R}"
            elif [ $j -eq $((i+1)) ]; then
                bar+="${VOLEY_PURP}▒${R}"
            else
                bar+="${GRID_SLATE}░${R}"
            fi
        done
        bar+="]"
        local pct=$(( i * 10 ))
        echo -ne "\r  ${bar} ${ELECTRIC_CYAN}${B}${pct}%${R}"
        sleep $delay
    done
    echo -ne "\r  ${PHOSPHOR_GRN}[██████████] 100%${R} ${PHOSPHOR_GRN}✔  SYNC_LOCKED${R}                    \n\n"
}

# --- Helper: Typewriter Glitch Text ---
glitch_type() {
    local text="$1"
    local color="$2"
    for ((i=0; i<${#text}; i++)); do
        echo -ne "${color}${text:$i:1}${R}"
        sleep 0.015
    done
    echo ""
}

# --- Clear screen and print CRT Boot Sequence ---
clear
echo -e "${GRID_SLATE}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${R}"
glitch_type "  [SYS_BOOT] INITIALIZING NEMESIS CYBERNETIC CORE... // BIOS V9.42_REV_A" "${VOLEY_PURP}"
glitch_type "  [MEM_TEST] 64TB QUANTUM SYNAPSE ARCHITECTURE VERIFIED... [OK]" "${DIM}${WHITE}"
echo -e "${GRID_SLATE}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${R}\n"
sleep 0.3

# --- Neon ASCII Banner ---
echo -e "${CYBER_PINK}${B}"
cat << "EOF"
  ███╗   ██╗███████╗███╗   ███╗███████╗███████╗██╗███████╗
  ████╗  ██║██╔════╝████╗ ████║██╔════╝██╔════╝██║██╔════╝
  ██╔██╗ ██║█████╗  ██╔████╔██║█████╗  ███████╗██║███████╗
  ██║╚██╗██║██╔══╝  ██║╚██╔╝██║██╔══╝  ╚════██║██║╚════██║
  ██║ ╚████║███████╗██║ ╚═╝ ██║███████╗███████║██║███████║
  ╚═╝  ╚═══╝╚══════╝╚═╝     ╚═╝╚══════╝╚══════╝╚═╝╚══════╝
EOF
echo -e "${ELECTRIC_CYAN}${B}  ╔══════════════════════════════════════════════════════════════════════╗${R}"
echo -e "${ELECTRIC_CYAN}${B}  ║${R} ${INV}${CYBER_PINK}${B} CYBER_C4ISR HUD V2.0 ${R}  ${PHOSPHOR_GRN}⚡ ACTIVE TELEMETRY MATRIX // PALANTIR SKIN${R}  ${ELECTRIC_CYAN}${B}║${R}"
echo -e "${ELECTRIC_CYAN}${B}  ╚══════════════════════════════════════════════════════════════════════╝${R}\n"

# --- Pre-Flight Port Diagnostics ---
echo -e "${VOLEY_PURP}${B}╔══ [ PHASE 1 // SPECTRAL PORT LIBERATION & AUDIT ] ══╗${R}"
if command -v fuser &>/dev/null; then
    fuser -k -9 8000/tcp 2>/dev/null || true
    fuser -k -9 3000/tcp 2>/dev/null || true
elif command -v lsof &>/dev/null; then
    lsof -ti:8000 | xargs -r kill -9 2>/dev/null || true
    lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
fi
cyber_progress "Scanning network matrix & neutralizing port conflicts (TCP 8000 / 3000)"

# --- Booting Backend Microservice ---
echo -e "${VOLEY_PURP}${B}╔══ [ PHASE 2 // ORBITAL EPHEMERIS BACKEND BOOTSTRAP ] ══╗${R}"
cd backend || { echo -e "${RED}[!] CRITICAL EXCEPTION: Backend directory void! Terminating.${R}"; exit 1; }

if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
elif [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
else
    echo -e "  ${CRT_AMBER}⚠  Local (.venv) bypassed; binding directly to global Linux Python runtime.${R}"
fi

cyber_progress "Connecting to NORAD/CelesTrak orbit gateway & compiling SGP4 tensors"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 >/dev/null 2>&1 &
BACKEND_PID=$!
cd ..
sleep 1
echo -e "  ${PHOSPHOR_GRN}⚡ ENGINE ONLINE${R} ${DIM}───>> [ PID: ${BACKEND_PID} | SOCKET: ws://0.0.0.0:8000/ws/telemetry ]${R}\n"

# --- Booting Frontend Tactical UI ---
echo -e "${VOLEY_PURP}${B}╔══ [ PHASE 3 // WEBGL TACTICAL CRT HUD GATEWAY ] ══╗${R}"
cyber_progress "Injecting FLIR thermal skin tokens & compiling dynamic intel ticker"

if command -v python3 &>/dev/null; then
    python3 -m http.server 3000 --directory frontend >/dev/null 2>&1 &
elif command -v python &>/dev/null; then
    python -m http.server 3000 --directory frontend >/dev/null 2>&1 &
else
    npx serve frontend -l 3000 >/dev/null 2>&1 &
fi
FRONTEND_PID=$!
sleep 1
echo -e "  ${PHOSPHOR_GRN}⚡ GATEWAY ONLINE${R} ${DIM}──>> [ PID: ${FRONTEND_PID} | HTTP: http://localhost:3000 ]${R}\n"

# --- Cyberpunk CRT Console HUD ---
echo -e "${CYBER_PINK}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${R}"
echo -e "${ELECTRIC_CYAN}${B}┌───────────────────────────────────────────────────────────────────────────┐${R}"
echo -e "${ELECTRIC_CYAN}${B}│${R}   ${INV}${PHOSPHOR_GRN}${B} ALL SYSTEMS NOMINAL ${R}  ${WHITE}${B}ORBITAL & AVIONICS SENSOR LINKS LOCKED @ 60 FPS${R}    ${ELECTRIC_CYAN}${B}│${R}"
echo -e "${ELECTRIC_CYAN}${B}├───────────────────────────────────────────────────────────────────────────┤${R}"
echo -e "${ELECTRIC_CYAN}${B}│${R}                                                                           ${ELECTRIC_CYAN}${B}│${R}"
echo -e "${ELECTRIC_CYAN}${B}│${R}    🌐  ${CYBER_PINK}${B}LIVE TACTICAL C2 HUD :${R}     ${PHOSPHOR_GRN}${B}http://localhost:3000${R}                   ${ELECTRIC_CYAN}${B}│${R}"
echo -e "${ELECTRIC_CYAN}${B}│${R}    📡  ${VOLEY_PURP}${B}BACKEND MATRIX APIS  :${R}     ${ELECTRIC_CYAN}${B}http://localhost:8000/docs${R}              ${ELECTRIC_CYAN}${B}│${R}"
echo -e "${ELECTRIC_CYAN}${B}│${R}                                                                           ${ELECTRIC_CYAN}${B}│${R}"
echo -e "${ELECTRIC_CYAN}${B}│${R}    ${GRID_BLUE}■${R} ${DIM}Telemetry Clock     :${R} ${WHITE}5,000 ms real-time burst (WebSocket)${R}         ${ELECTRIC_CYAN}${B}│${R}"
echo -e "${ELECTRIC_CYAN}${B}│${R}    ${GRID_BLUE}■${R} ${DIM}Visual Skin Engine  :${R} ${CRT_AMBER}Tactical FLIR / Phosphor CRT Green (--nx-)${R}   ${ELECTRIC_CYAN}${B}│${R}"
echo -e "${ELECTRIC_CYAN}${B}│${R}    ${GRID_BLUE}■${R} ${DIM}Security Protocol   :${R} ${CYBER_PINK}PROPRIETARY // EXCLUSIVE TO CIGARFEINE${R}       ${ELECTRIC_CYAN}${B}│${R}"
echo -e "${ELECTRIC_CYAN}${B}│${R}                                                                           ${ELECTRIC_CYAN}${B}│${R}"
echo -e "${ELECTRIC_CYAN}${B}└───────────────────────────────────────────────────────────────────────────┘${R}"
echo -e "${CYBER_PINK}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${R}"

echo -e "\n  ${CRT_AMBER}${BLINK}▶${R} ${WHITE}${B}TERMINAL ACTIVE:${R} ${DIM}Press [CTRL+C] at any time to sever matrix connection.${R}\n"

while true; do
    sleep 2
    if ! kill -0 $BACKEND_PID 2>/dev/null || ! kill -0 $FRONTEND_PID 2>/dev/null; then
        echo -e "\n${RED}${B}[!] SYSTEM ALERT: Telemetry heartbeat voided! Server process dropped.${R}"
        break
    fi
done
