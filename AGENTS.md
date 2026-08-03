# Repository Guidelines & Agentic Instructions

For complete architectural details, domain logic overview, and runtime diagrams, always reference [`CONTEXT.md`](file:///wsl.localhost/Ubuntu/home/arshad/dev/project-nemesis/CONTEXT.md).

## Project Structure & Module Organization
- **Backend Entry**: `backend/main.py` is the FastAPI entry point (REST endpoints + WebSocket streams). Keep route handlers thin by delegating domain calculations to dedicated service modules in `backend/services/`.
- **Active Backend Services**: 
  - Space/Orbital: `tle_service.py`, `maneuver_service.py`, `satellite_image_service.py`, `space_weather_service.py`.
  - Air/Surface: `opensky_service.py` (ADS-B flights), `ais_service.py` (maritime ships).
  - Intelligence/EW: `osint_service.py` (spaCy NLP knowledge graphs), `rf_service.py` (RF anomalies), `scenario_service.py` (wargaming simulations).
- **Runtime Data**: SQLite runtime databases and event stores live in `backend/data/nemesis.db` (~6.8 GB). Treat as dynamic runtime state and **never** commit or edit directly.
- **Frontend Architecture**: Completely static web app located in `frontend/`. Organized cleanly into ES modules under `frontend/js/` (`globe.js`, `views.js`, `telemetry.js`, `ui.js`, `flights.js`, `ships.js`, `vfx.js`, `knowledge_graph.js`, `interpolator.js`, etc.), stylesheets in `frontend/css/nemesis.css`, and audio/texture assets in `frontend/audio/` and `frontend/assets/`.

## Build, Test, and Development Commands
- **Environment Initialization & Deps**:
  ```bash
  cd backend && python3 -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  python -m spacy download en_core_web_sm   # CRITICAL: Required for OSINT / knowledge graph service
  ```
- **Run Locally (Unified Launch Script)**:
  `cd /home/arshad/dev/project-nemesis && bash start.sh` (Launches FastAPI on port 8000 & Frontend on port 3000).
- **Run Servers Separately**:
  - Backend API: `cd backend && source .venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8000 --reload`
  - Frontend UI: `cd frontend && python3 -m http.server 3000`
- **Syntax & Compilation Checks**:
  `cd backend && source .venv/bin/activate && python3 -m py_compile main.py services/*.py`
- **Verification Endpoints**:
  - Status check: `curl -s http://127.0.0.1:8000/api/health | python3 -m json.tool`
  - Domain REST snapshots: `/api/satellites/snapshot`, `/api/flights/snapshot`, `/api/ships/snapshot`, `/api/space-weather`, `/api/geo-hubs`, `/api/knowledge-graph`.
  - Live WebSocket feeds: `/ws/telemetry`, `/ws/flights`, `/ws/ships`, `/ws/alerts`, `/ws/knowledge-graph`.

## Coding Style & Naming Conventions
- **Python (Backend)**: 4-space indentation, full static type hints, asynchronous I/O (`async/await` with `httpx`/`websockets`), and structured `logging` (avoid raw `print`). Use `snake_case` for modules/functions, `PascalCase` for classes/models, and `UPPER_SNAKE_CASE` for constants.
- **JavaScript (Frontend)**: ES6 Modules with `camelCase` identifiers. Keep modules decoupled by responsibility (e.g., entity rendering in `flights.js`, network transport in `telemetry.js`, smoothing in `interpolator.js`).
- **API Contract Stability**: Always maintain backward compatibility for existing JSON payload signatures (`type`, `timestamp_utc`, `count`, and property key naming) to prevent client-side WebGL runtime exceptions or rendering freezes.

## Testing & Validation Guidelines
- There is currently no automated test harness checked in. When contributing complex service logic, consider introducing `pytest` suites under `backend/tests/`.
- **Minimum Manual Validation**: Before finishing a change, run the app and confirm clean logs (no unhandled traceback exceptions during background polling) and test endpoints: `/api/health`, `/api/satellites/snapshot`, `/api/flights/snapshot`, and verify WebSocket connectivity on port 8000.

## Security & Operational Practices
- Maintain secret keys and integration parameters within `.env` files; never commit secrets or credentials.
- Handle third-party API disruptions (CelesTrak, OpenSky, NOAA, VesselFinder, GDELT) with defensive exception trapping, explicit logging warnings, and fallback caching to ensure core dashboard survivability.
