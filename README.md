# PROJECT NEMESIS — Active Intelligence Platform

```
██████╗ ██████╗  ██████╗      ██╗███████╗ ██████╗████████╗
██╔══██╗██╔══██╗██╔═══██╗     ██║██╔════╝██╔════╝╚══██╔══╝
██████╔╝██████╔╝██║   ██║     ██║█████╗  ██║        ██║
██╔═══╝ ██╔══██╗██║   ██║██   ██║██╔══╝  ██║        ██║
██║     ██║  ██║╚██████╔╝╚█████╔╝███████╗╚██████╗   ██║
╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚════╝ ╚══════╝ ╚═════╝   ╚═╝
   NEMESIS  — Active Intelligence Platform · Phase I
```

**A sci-fi tactical Command & Control dashboard.** Dark 3D globe. Live satellite telemetry. Built to grow into a full Palantir-inspired intelligence fusion platform.

---

## Phase 1 Features

- 🌍 **3D Dark Globe** (globe.gl / Three.js) with night-side Earth texture
- 🛰️ **Live Satellite Positions** — real orbital data from CelesTrak via SGP4 propagation (Skyfield)
- ⚡ **WebSocket Telemetry** — positions refresh every 5 seconds
- 🖥️ **Cyberpunk HUD** — CRT scanlines, neon accents, tactical corner brackets
- 📋 **Satellite Roster** — scrollable list with click-to-focus camera
- 📡 **Hover Tooltips** — NORAD ID, lat/lon, altitude, TLE freshness
- 🔄 **Auto-reconnect** — exponential backoff on WebSocket drops
- 🕐 **Live UTC Clock**
- 📰 **OSINT Ticker** (Phase 1: static placeholder; Phase 2: GDELT live)

---

## Tech Stack

| Layer    | Technology                             |
|----------|----------------------------------------|
| Frontend | Vanilla JS (ES Modules), HTML5, CSS3   |
| 3D Globe | globe.gl (Three.js wrapper)            |
| Backend  | Python 3.11+, FastAPI, Uvicorn         |
| Orbital  | Skyfield (SGP4 propagation)            |
| HTTP     | httpx (async CelesTrak fetching)       |
| Comms    | WebSocket (native browser API + FastAPI)|

---

## Project Structure

```
project-nemesis/
├── backend/
│   ├── main.py              ← FastAPI app, WebSocket, REST endpoints
│   ├── requirements.txt
│   └── services/
│       ├── __init__.py
│       └── tle_service.py   ← CelesTrak fetch + Skyfield position math
│
├── frontend/
│   ├── index.html           ← Application shell with full HUD
│   ├── css/
│   │   └── nemesis.css     ← Cyberpunk/Military stylesheet
│   └── js/
│       ├── main.js          ← Entry point & module orchestrator
│       ├── globe.js         ← Globe.gl renderer + satellite layer
│       ├── telemetry.js     ← WebSocket client + REST fallback
│       └── ui.js            ← HUD DOM management, log, counters
│
├── README.md
└── start.sh                 ← One-command launch script
```

---

## Installation & Running

### Prerequisites

- Python 3.11+
- A modern browser (Chrome 90+ / Firefox 88+ recommended)
- Internet connection (fetches TLEs from CelesTrak + textures from unpkg CDN)

---

### Step 1 — Install Backend

```bash
cd backend
python -m venv .venv

# Activate (Mac/Linux)
source .venv/bin/activate

# Activate (Windows PowerShell)
# .venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

**`requirements.txt` contents:**
```
fastapi==0.111.0
uvicorn[standard]==0.29.0
httpx==0.27.0
skyfield==1.48
websockets==12.0
python-dotenv==1.0.1
pydantic==2.7.1
```

---

### Step 2 — Start the Backend

```bash
# From the /backend directory, with .venv activated:
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

You should see output like:
```
08:30:01  [INFO]  nemesis.tle — Initialising TLE catalogue from CelesTrak…
08:30:02  [INFO]  nemesis.tle —   [visual] Loaded 100 satellites.
08:30:03  [INFO]  nemesis.tle —   [stations] Loaded 12 satellites.
08:30:03  [INFO]  nemesis.main — ═══ NEMESIS ONLINE — AWAITING CONNECTIONS ═══
INFO:     Uvicorn running on http://0.0.0.0:8000
```

**Verify:** Visit [http://localhost:8000/api/health](http://localhost:8000/api/health) — you should see a JSON status response.

---

### Step 3 — Serve the Frontend

> ⚠️ **ES Modules require HTTP** — you cannot just double-click `index.html`.
> You must serve the frontend via a local HTTP server.

**Option A — Python (simplest):**
```bash
# From the project root:
python -m http.server 3000 --directory frontend
```

**Option B — Node.js:**
```bash
npx serve frontend -l 3000
```

**Option C — VS Code Live Server extension:** Right-click `frontend/index.html` → "Open with Live Server"

---

### Step 4 — Open the Dashboard

Open your browser to: **[http://localhost:3000](http://localhost:3000)**

The boot sequence will run, then the globe will appear with satellites orbiting the Earth. 🛰️

---

## Keyboard Controls

| Key       | Action                    |
|-----------|---------------------------|
| `ESC`     | Reset camera to orbit view|
| `R`       | Toggle auto-rotation      |
| `Click`   | Focus & track satellite   |

---

## API Reference

| Method    | Endpoint                       | Description                          |
|-----------|--------------------------------|--------------------------------------|
| `GET`     | `/`                            | Health probe                         |
| `GET`     | `/api/health`                  | Full system status JSON              |
| `GET`     | `/api/satellites/snapshot`     | Current positions (REST)             |
| `WS`      | `/ws/telemetry`                | Live stream (5 s updates)            |
| `GET`     | `/docs`                        | FastAPI auto-generated Swagger UI    |

---

## Phase Roadmap

### ✅ Phase 1 (Current)
- Dark 3D globe with live satellite telemetry via WebSocket
- CelesTrak TLE ingestion + SGP4 orbital mechanics
- Full cyberpunk/military HUD

### 🔲 Phase 2 — The City Plunge
- deck.gl integration with **Google Maps Photorealistic 3D Tiles**
- Smooth macro→micro camera dive from orbit to street level
- Live **OpenSky ADS-B** flight telemetry overlay

### 🔲 Phase 3 — The Intelligence Layer
- Python spaCy NLP pipeline scraping GDELT/RSS
- **3d-force-graph** knowledge graph in side panel
- Entity extraction: People, Orgs, Locations, Events

### 🔲 Phase 4 — Sensor Shaders
- Custom **WebGL shaders**: FLIR Thermal, Night Vision, RF Anomaly
- Satellite overpass countdown timer (Skyfield predict_passes)
- CCTV PIP panels at street level

---

## Troubleshooting

**Globe is black / textures not loading:**
- Check your internet connection (textures load from unpkg CDN)
- Try Chrome — some browsers block mixed-content from `localhost`

**"Awaiting telemetry" — no satellites appear:**
- Ensure the backend is running at `http://localhost:8000`
- Check browser console for WebSocket errors
- Verify CelesTrak is reachable: `curl https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle`

**CORS errors in browser console:**
- Make sure you're accessing the frontend via `http://localhost:3000` (not `file://`)
- Backend CORS is configured to allow all origins — if errors persist, check uvicorn is on port 8000

---

## Credits

- **CelesTrak** — Satellite TLE data (Dr. T.S. Kelso)
- **Skyfield** — Python orbital mechanics library (Brandon Rhodes)
- **globe.gl** — WebGL globe renderer (vasturiano)
- **Three.js** — 3D engine

---

## ⚖️ License & Intellectual Property

**Proprietary and Confidential — All Rights Reserved.**

Copyright (c) 2026 **Cigarfeine** (Project Nemesis).
This repository is published solely for educational code review and portfolio demonstration under Section D.5 of the GitHub Terms of Service. **No right or license is granted** to copy, mirror, reverse-engineer, monetize, or create derivative works from this codebase or its UI/UX styling paradigms. Unauthorized usage constitutes willful copyright infringement. See the [LICENSE](LICENSE) file for comprehensive legal covenants and anti-theft terms.

---

*"The map is not the territory. But this comes close."*

