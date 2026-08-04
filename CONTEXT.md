# PROJECT NEMESIS — Comprehensive Architecture & Context

**NEMESIS** is a Palantir-inspired, tactical multi-domain Command & Control (C2) and Active Intelligence Platform. Originally conceived as a phase-by-step radar application, the implementation currently encompasses capabilities across all planned roadmap phases (Phases 1–4), unifying space orbital tracking, atmospheric flight monitoring, maritime surveillance, OSINT/cyber intelligence, RF anomaly analysis, and wargaming simulations into a highly interactive WebGL 3D interface.

---

## 1. System Architecture & Tech Stack

```
                     ┌───────────────────────────────────────────────┐
                     │          NEMESIS DASHBOARD (Frontend)         │
                     │    Vanilla ES Modules · Three.js / globe.gl   │
                     └───────────────────┬───▲───────────────────────┘
                                         │   │
                  REST Snapshot API (HTTP)   │   WebSocket Streams (5s ticks)
                                         │   │   (/ws/telemetry, /ws/flights, etc.)
                                         ▼   │
                     ┌───────────────────────┴───────────────────────┐
                     │          FASTAPI FUSION ENGINE (Backend)      │
                     │    Async I/O · Skyfield SGP4 · spaCy NLP      │
                     └──┬─────────┬─────────┬────────┬────────┬──────┘
                        │         │         │        │        │
               ┌────────▼┐   ┌────▼────┐ ┌──▼──┐  ┌──▼───┐ ┌──▼──────┐
               │CelesTrak│   │OpenSky  │ │AIS  │  │NOAA  │ │RSS/GDELT│
               │(TLEs)   │   │(Flights)│ │Ships│  │Weather│ │(OSINT)  │
               └─────────┘   └─────────┘ └─────┘  └──────┘ └─────────┘
```

| Layer | Primary Technologies & Specifications |
| :--- | :--- |
| **Frontend Renderer** | HTML5, CSS3 (Cyberpunk CRT theme), Vanilla JavaScript (ES6 Modules), `globe.gl` (Three.js WebGL wrapper). |
| **Backend API Engine**| Python 3.11+, FastAPI, Uvicorn, Python `websockets`, Pydantic v2. |
| **Orbital Mechanics** | `Skyfield` library (SGP4 satellite orbital propagation from NORAD TLE elements). |
| **Intelligence/NLP**  | `spaCy` (using the `en_core_web_sm` English pipeline for NER entity extraction). |
| **Geopolitical & Mapping** | `geopy`, GeoJSON overlays, static textures, custom tactical sensor WebGL shaders. |
| **Runtime Storage**   | SQLite database (`backend/data/nemesis.db`) storing deep historical logs, telemetry, and OSINT events (~6.8 GB database). |

---

## 2. Implemented Subsystems & Domain Services

All core backend services reside under [`backend/services/`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/backend/services):

### 🛰️ Space & Orbital Dynamics (Phase 1+)
- **`tle_service.py`**: Ingests orbital elements (TLEs) from CelesTrak across multiple orbital regimes (Visual, Space Stations, GNSS constellations) and calculates live SGP4 geocentric position vectors (~345+ tracked satellites).
- **`maneuver_service.py`**: Monitors satellite orbital track history to detect sudden orbital maneuvers, delta-v anomalies, and thruster burns.
- **`satellite_image_service.py`**: Predicts overhead passes and integrates satellite observation imaging pipelines.
- **`space_weather_service.py`**: Periodically pulls real-time environmental telemetry from NOAA SWPC (Planetary K-index, X-ray solar flares, solar wind speed/density) to predict RF atmospheric degradation and geomagnetic storm impacts.

### ✈️ Air & Maritime Surveillance (Phase 2+)
- **`opensky_service.py`**: Queries OpenSky Network ADS-B telemetry, caching live state vectors for up to 12,000+ simultaneous aircraft globally.
- **`ais_service.py`**: Maritime ship vessel tracking via Automatic Identification System (AIS) integrations (extends beyond original roadmap scope).

### 🧠 Intelligence Fusion & Electronic Warfare (Phases 3 & 4)
- **`osint_service.py`**: Scrapes news, RSS feeds, and GDELT global events, passing text through a custom `spaCy` NLP pipeline. Performs Named Entity Recognition (NER) to extract *People, Organizations, Locations, and Events*, generating dynamic relationship edges for 3D force-directed knowledge graphs.
- **`rf_service.py`**: Performs real-time scanning of airspace and geography for RF anomalies, spoofing indicators, and unauthorized tactical emitters.
- **`scenario_service.py`**: A synthetic scenario generation and wargaming engine capable of injecting mock tactical threats, orbital incidents, and crisis events into the simulation stream.

---

## 3. Frontend Application Structure

The client application living in [`frontend/`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend) uses strict separation of concerns via native ES6 module imports:

*   **Core Orchestration**:
    *   [`main.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/main.js): Application boot sequence, event bus setup, and module initialization.
    *   [`telemetry.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/telemetry.js): Manages multi-channel WebSocket connections with automatic exponential backoff reconnection logic.
*   **WebGL Visualization**:
    *   [`globe.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/globe.js): Deep Three.js / `globe.gl` customization handling 3D lighting, camera orbits, satellite geometries, and earth mapping textures.
    *   [`interpolator.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/interpolator.js): Runs at 60 FPS to smoothly animate satellite and vehicle trajectories between discrete 5-second backend WebSocket tick packets.
*   **Domain Layers**:
    *   [`flights.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/flights.js), [`ships.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/ships.js), and [`satellite_profile.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/satellite_profile.js) handle dedicated entity rendering, interactive tooltips, and deep profiling view ports.
*   **Tactical HUD & Analytics**:
    *   [`ui.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/ui.js) & [`alerts.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/alerts.js): Manages DOM updates, live UTC clocking, threat tickers, and acoustic alert playback (`frontend/audio/`).
    *   [`knowledge_graph.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/knowledge_graph.js): Renders real-time force-directed NLP entity nodes within the intelligence sidebar panel.
    *   [`views.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/views.js): Advanced viewport management handling macro $\to$ micro orbital dives, picture-in-picture simulated CCTV feeds, and multi-display configurations.
    *   [`vfx.js`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/frontend/js/vfx.js): Simulates optical sensor modes (FLIR Thermal, Night Vision Green, RF Anomaly Heatmap) and CRT scanlines.

---

## 4. Operational Setup & Dependency Caveats

### Critical Dependency Requirements
When standing up a fresh backend virtual environment, installing [`requirements.txt`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/backend/requirements.txt) alone **is insufficient** for full system functionality. The OSINT knowledge graph engine requires the downloaded spaCy English language model:
```bash
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
python -m spacy download en_core_web_sm
```
*Note: If `en_core_web_sm` is missing, `osint_service` fails gracefully with a logging warning, disabling `/ws/knowledge-graph` while allowing all remaining space/flight telemetry services to run normally.*

### Runtime State & Data Management
*   **SQLite Database**: Located at [`backend/data/nemesis.db`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/backend/data/nemesis.db). Because it rapidly grows to several gigabytes with historical tracking data, ensure adequate disk space and **never commit this database file to version control**.
*   **External API Fallbacks**: The system actively interrogates CelesTrak, OpenSky, NOAA SWPC, and AIS APIs upon initialization. Services are designed to gracefully tolerate network timeouts or third-party outages by retaining previously cached database snapshots or disabling specific subsystem layers without halting the FastAPI application loop.

---

## 5. Quick-Start Command Matrix

| Task | Command Formulation |
| :--- | :--- |
| **Unified Launch** | `wsl -- bash -c "cd ~/dev/project-nemesis && ./start.sh"` |
| **Backend Only**   | `cd backend && source .venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8000 --reload` |
| **Frontend Only**  | `python3 -m http.server 3000 --directory frontend` |
| **Health Probe**   | `curl -s http://127.0.0.1:8000/api/health | python3 -m json.tool` |
