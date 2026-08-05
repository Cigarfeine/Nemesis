"""
Project Nemesis FastAPI backend entrypoint.
"""

from __future__ import annotations

import asyncio
import base64
import gzip
import json
import logging
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from skyfield.api import wgs84

from services.ais_service import AISService
from services.maneuver_service import ManeuverService
from services.opensky_service import OpenSkyService
from services.osint_service import GEO_HUBS, OSINTService
from services.rf_service import RFService
from services.satellite_image_service import SatelliteImageService
from services.scenario_service import ScenarioService
from services.space_weather_service import SpaceWeatherService
from services.tle_service import TLEService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("nemesis.main")

TELEMETRY_INTERVAL_SECONDS = 2
FLIGHT_INTERVAL_SECONDS = 5
GRAPH_INTERVAL_SECONDS = 30
SHIP_INTERVAL_SECONDS = 30
ALERT_POLL_INTERVAL_SECONDS = 2
RF_ALERT_INTERVAL_SECONDS = 30
SPACE_WEATHER_REFRESH_INTERVAL_SECONDS = 600
SCENARIO_AUTO_RECORD_INTERVAL_SECONDS = 30

MAX_ALERT_QUEUE = 200
MAX_RF_ALERT_FEATURES_PER_TICK = 10
TELEMETRY_FULL_UPDATE_EVERY_TICKS = 10
TELEMETRY_DELTA_THRESHOLD_DEG = 0.05

SEVERITY_LOW = "LOW"
SEVERITY_MEDIUM = "MEDIUM"
SEVERITY_HIGH = "HIGH"
SEVERITY_CRITICAL = "CRITICAL"


class OverpassRequest(BaseModel):
    """Payload schema for satellite overpass prediction."""

    norad_id: int = Field(..., ge=1, description="NORAD catalog ID")
    lat: float = Field(..., ge=-90.0, le=90.0, description="Observer latitude")
    lon: float = Field(..., ge=-180.0, le=180.0, description="Observer longitude")
    hours_ahead: int = Field(..., ge=1, le=168, description="Prediction window in hours")


class ConnectionManager:
    """Tracks active websocket connections for one endpoint."""

    def __init__(self) -> None:
        self._connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self._connections:
            self._connections.remove(websocket)

    @property
    def count(self) -> int:
        return len(self._connections)


# Core services
tle_service = TLEService()
opensky_service = OpenSkyService()
osint_service = OSINTService()
rf_service = RFService(opensky_service=opensky_service)
satellite_image_service = SatelliteImageService()
maneuver_service = ManeuverService()
space_weather_service = SpaceWeatherService()
ais_service = AISService()
scenario_service = ScenarioService(base_dir=Path(__file__).resolve().parent)

# Runtime tasks
_tle_refresh_task: asyncio.Task[Any] | None = None
_space_weather_refresh_task: asyncio.Task[Any] | None = None
_ais_refresh_task: asyncio.Task[Any] | None = None
_scenario_record_task: asyncio.Task[Any] | None = None
_emerging_fanout_task: asyncio.Task[Any] | None = None
_tle_bootstrap_task: asyncio.Task[Any] | None = None
_space_weather_bootstrap_task: asyncio.Task[Any] | None = None
_ais_bootstrap_task: asyncio.Task[Any] | None = None
_osint_bootstrap_task: asyncio.Task[Any] | None = None

# Alert coordination
_maneuver_alert_queue: deque[dict[str, Any]] = deque(maxlen=MAX_ALERT_QUEUE)
_maneuver_alert_lock = asyncio.Lock()
_emerging_graph_queue: deque[dict[str, Any]] = deque(maxlen=MAX_ALERT_QUEUE)
_emerging_alert_queue: deque[dict[str, Any]] = deque(maxlen=MAX_ALERT_QUEUE)
_emerging_alert_lock = asyncio.Lock()

_boot_epoch = time.time()

# Websocket managers
telemetry_manager = ConnectionManager()
flight_manager = ConnectionManager()
graph_manager = ConnectionManager()
weather_manager = ConnectionManager()
ship_manager = ConnectionManager()
alert_manager = ConnectionManager()
_last_positions: dict[int, tuple[float, float]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown lifecycle."""

    global _tle_refresh_task
    global _space_weather_refresh_task
    global _ais_refresh_task
    global _scenario_record_task
    global _emerging_fanout_task
    global _tle_bootstrap_task
    global _space_weather_bootstrap_task
    global _ais_bootstrap_task
    global _osint_bootstrap_task

    async def _on_tle_refresh(catalogue: dict[int, dict[str, Any]]) -> None:
        new_maneuvers = maneuver_service.record_snapshot(catalogue)
        if not new_maneuvers:
            return
        async with _maneuver_alert_lock:
            for maneuver in new_maneuvers:
                _maneuver_alert_queue.append(maneuver)
        logger.info("Detected %s new maneuver(s).", len(new_maneuvers))

    logger.info("Project Nemesis backend starting.")

    tle_service.register_post_refresh_hook(_on_tle_refresh)

    _tle_bootstrap_task = asyncio.create_task(
        _initialize_service_background("tle_service", tle_service.initialize())
    )
    _space_weather_bootstrap_task = asyncio.create_task(
        _initialize_service_background(
            "space_weather_service",
            space_weather_service.initialize(),
        )
    )
    _ais_bootstrap_task = asyncio.create_task(
        _initialize_service_background("ais_service", ais_service.initialize())
    )
    _osint_bootstrap_task = asyncio.create_task(
        _initialize_service_background(
            "osint_service",
            osint_service.get_knowledge_graph(force_refresh=True),
        )
    )
    await scenario_service.initialize()

    _tle_refresh_task = asyncio.create_task(tle_service.start_refresh_loop())
    _space_weather_refresh_task = asyncio.create_task(
        space_weather_service.start_refresh_loop(
            interval=SPACE_WEATHER_REFRESH_INTERVAL_SECONDS
        )
    )
    _ais_refresh_task = asyncio.create_task(
        ais_service.start_refresh_loop(interval=SHIP_INTERVAL_SECONDS)
    )
    _scenario_record_task = asyncio.create_task(
        _scenario_auto_record_loop(interval_seconds=SCENARIO_AUTO_RECORD_INTERVAL_SECONDS)
    )
    _emerging_fanout_task = asyncio.create_task(_emerging_event_fanout_loop())

    logger.info(
        "Startup complete. Satellites tracked: %s",
        len(tle_service.catalogue),
    )

    yield

    logger.info("Project Nemesis shutdown requested.")
    tasks = [
        _tle_refresh_task,
        _space_weather_refresh_task,
        _ais_refresh_task,
        _scenario_record_task,
        _emerging_fanout_task,
        _tle_bootstrap_task,
        _space_weather_bootstrap_task,
        _ais_bootstrap_task,
        _osint_bootstrap_task,
    ]

    for task in tasks:
        if task is not None:
            task.cancel()

    await asyncio.gather(*[task for task in tasks if task is not None], return_exceptions=True)


app = FastAPI(
    title="Project Nemesis Intelligence Platform",
    description="Real-time fusion backend for satellites, flights, ships, OSINT and alerts.",
    version="2.0.0-phase5",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["system"])
async def root() -> dict[str, Any]:
    return {
        "status": "ONLINE",
        "system": "Project Nemesis",
        "phase": 5,
    }


@app.get("/api/health", tags=["system"])
async def health() -> dict[str, Any]:
    return {
        "status": "OPERATIONAL",
        "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
        "uptime_seconds": int(time.time() - _boot_epoch),
        "satellites_tracked": tle_service.status.get("satellites_tracked", 0),
        "last_tle_refresh": tle_service.status.get("last_refresh_utc"),
        "active_ws_clients": {
            "telemetry": telemetry_manager.count,
            "flights": flight_manager.count,
            "knowledge_graph": graph_manager.count,
            "space_weather": weather_manager.count,
            "ships": ship_manager.count,
            "alerts": alert_manager.count,
        },
        "osint_status": osint_service.status,
        "opensky_status": opensky_service.status,
        "rf_status": rf_service.status,
        "maneuver_status": maneuver_service.status,
        "space_weather_status": space_weather_service.status,
        "ais_status": ais_service.status,
        "scenario_status": scenario_service.status,
    }


@app.get("/api/status/performance", tags=["system"])
async def performance_status() -> dict[str, Any]:
    import psutil
    import time as clock

    try:
        proc = psutil.Process()
        return {
            "cpu_percent": proc.cpu_percent(interval=0.1),
            "memory_mb": round(proc.memory_info().rss / 1024 / 1024, 1),
            "satellites_tracked": len(tle_service.catalogue),
            "cache_age_seconds": round(clock.time() - tle_service._cache_time, 2),
            "active_ws_clients": (
                telemetry_manager.count
                + flight_manager.count
                + graph_manager.count
                + weather_manager.count
                + ship_manager.count
                + alert_manager.count
            ),
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        }
    except Exception as exc:
        return {"error": str(exc)}


@app.get("/api/plugin/list", tags=["system"])
async def plugin_list() -> dict[str, Any]:
    plugins = [
        {"name": "tle_service", "status": "online", "details": tle_service.status},
        {"name": "opensky_service", "status": "online", "details": opensky_service.status},
        {"name": "osint_service", "status": "online", "details": osint_service.status},
        {"name": "rf_service", "status": "online", "details": rf_service.status},
        {
            "name": "satellite_image_service",
            "status": "online",
            "details": satellite_image_service.status,
        },
        {"name": "maneuver_service", "status": "online", "details": maneuver_service.status},
        {
            "name": "space_weather_service",
            "status": "online",
            "details": space_weather_service.status,
        },
        {"name": "ais_service", "status": "online", "details": ais_service.status},
        {
            "name": "scenario_service",
            "status": "online",
            "details": scenario_service.status,
        },
    ]
    return {
        "type": "PLUGIN_LIST",
        "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
        "count": len(plugins),
        "plugins": plugins,
    }


@app.get("/api/satellites/snapshot", tags=["telemetry"])
async def satellite_snapshot() -> JSONResponse:
    if not tle_service.catalogue:
        raise HTTPException(status_code=503, detail="TLE catalogue is not loaded yet.")

    positions = await asyncio.to_thread(tle_service.compute_positions)
    payload = _build_satellite_payload(
        msg_type="SAT_SNAPSHOT",
        positions=positions,
    )
    return JSONResponse(payload)


@app.get("/api/satellites/{norad_id}/profile", tags=["telemetry"])
async def satellite_profile(
    norad_id: int,
    name: str | None = Query(default=None, description="Satellite name for imagery lookup"),
) -> JSONResponse:
    if norad_id <= 0:
        raise HTTPException(status_code=400, detail="NORAD ID must be a positive integer.")

    catalog_name = None
    catalog_entry = tle_service.catalogue.get(norad_id)
    if catalog_entry:
        raw_name = catalog_entry.get("name")
        if isinstance(raw_name, str) and raw_name.strip():
            catalog_name = raw_name.strip()

    resolved_name = name.strip() if isinstance(name, str) and name.strip() else catalog_name
    if not resolved_name:
        resolved_name = f"NORAD-{norad_id}"

    try:
        profile = await satellite_image_service.get_satellite_profile(
            norad_id=norad_id,
            name=resolved_name,
        )
    except Exception as exc:
        logger.error("Satellite profile lookup failed for NORAD %s: %s", norad_id, exc)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "SAT_PROFILE_UNAVAILABLE",
                "message": "Satellite profile service unavailable.",
                "norad_id": norad_id,
                "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
            },
        )

    return JSONResponse(profile)


@app.get("/api/flights/snapshot", tags=["flights"])
async def flights_snapshot() -> JSONResponse:
    flights = await opensky_service.get_flights()
    if not flights:
        flights = await opensky_service.get_flights(force_refresh=True)

    payload = {
        "type": "FLIGHT_SNAPSHOT",
        "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
        "count": len(flights),
        "flights": flights,
        "opensky_status": opensky_service.status,
    }
    return JSONResponse(payload)


@app.post("/api/satellites/overpass", tags=["telemetry"])
async def satellite_overpass(payload: OverpassRequest) -> JSONResponse:
    entry = tle_service.catalogue.get(payload.norad_id)
    if not entry:
        raise HTTPException(
            status_code=404,
            detail=f"NORAD ID {payload.norad_id} not found in current TLE catalogue.",
        )

    satellite = entry["satellite"]
    observer = wgs84.latlon(payload.lat, payload.lon)
    t0 = tle_service.ts.now()
    now_utc = _to_utc_datetime(t0.utc_datetime())
    t1 = tle_service.ts.from_datetime(now_utc + timedelta(hours=payload.hours_ahead))

    try:
        event_times, event_codes = satellite.find_events(
            observer,
            t0,
            t1,
            altitude_degrees=10.0,
        )
    except Exception as exc:
        logger.error("Overpass computation error for NORAD %s: %s", payload.norad_id, exc)
        raise HTTPException(status_code=500, detail="Unable to compute overpasses.")

    passes = _build_overpass_passes(
        satellite=satellite,
        observer=observer,
        event_times=event_times,
        event_codes=event_codes,
        now_utc=now_utc,
        limit=5,
    )

    response: dict[str, Any] = {
        "status": "OK" if passes else "NO_PASSES",
        "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
        "norad_id": payload.norad_id,
        "satellite_name": entry.get("name"),
        "observer": {"lat": payload.lat, "lon": payload.lon},
        "hours_ahead": payload.hours_ahead,
        "horizon_degrees": 10.0,
        "pass_count": len(passes),
        "passes": passes,
    }
    if not passes:
        response["message"] = "No visible passes within the requested window."

    return JSONResponse(response)


@app.get("/api/knowledge-graph", tags=["intelligence"])
async def knowledge_graph_snapshot() -> JSONResponse:
    try:
        graph = await osint_service.get_knowledge_graph()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    payload = {
        "type": "GRAPH_SNAPSHOT",
        "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
        "node_count": len(graph.get("nodes", [])),
        "link_count": len(graph.get("links", [])),
        "graph": graph,
        "nodes": graph.get("nodes", []),
        "links": graph.get("links", []),
        "osint_status": osint_service.status,
    }
    return JSONResponse(payload)


@app.get("/api/geo-hubs", tags=["intelligence"])
async def get_geo_hubs() -> dict[str, Any]:
    return {"hubs": GEO_HUBS, "count": len(GEO_HUBS)}


@app.get("/api/rf-anomalies", tags=["intelligence"])
async def rf_anomaly_zones() -> JSONResponse:
    try:
        feature_collection = await rf_service.get_rf_anomaly_zones()
    except Exception as exc:
        logger.error("RF anomaly service error: %s", exc)
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "code": "RF_ANOMALY_UNAVAILABLE",
                    "message": "RF anomaly feed temporarily unavailable.",
                    "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
                }
            },
        )

    return JSONResponse(
        status_code=200,
        content=feature_collection.model_dump(mode="json"),
        media_type="application/geo+json",
    )


@app.get("/api/maneuvers/recent", tags=["intelligence"])
async def recent_maneuvers(limit: int = Query(default=20, ge=1, le=50)) -> JSONResponse:
    maneuvers = maneuver_service.get_recent_maneuvers(limit=limit)
    return JSONResponse(
        {
            "type": "MANEUVER_RECENT",
            "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
            "count": len(maneuvers),
            "maneuvers": maneuvers,
        }
    )


@app.get("/api/maneuvers/{norad_id}", tags=["intelligence"])
async def maneuver_history(norad_id: int) -> JSONResponse:
    history = maneuver_service.get_satellite_history(norad_id=norad_id)
    return JSONResponse(
        {
            "type": "MANEUVER_HISTORY",
            "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
            "norad_id": norad_id,
            "count": len(history),
            "history": history,
        }
    )


@app.get("/api/space-weather", tags=["intelligence"])
async def space_weather_snapshot() -> JSONResponse:
    status = space_weather_service.get_current_status()
    return JSONResponse(
        {
            "type": "SPACE_WEATHER",
            "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
            "kp_index": status.get("kp_index"),
            "alert_level": status.get("alert_level"),
            "solar_wind_speed": status.get("solar_wind_speed"),
            "xray_flux": status.get("xray_flux"),
            "flare_class": status.get("flare_class"),
            "active_alerts": status.get("active_alerts", []),
            "status": status,
        }
    )


@app.get("/api/debug/weather", tags=["debug"])
async def debug_weather() -> dict[str, Any]:
    raw = await space_weather_service._fetch_kp()
    return {"raw": raw}


@app.get("/api/ships/snapshot", tags=["maritime"])
async def ships_snapshot() -> JSONResponse:
    ships = ais_service.get_ships()
    payload = _build_ship_payload(msg_type="SHIP_SNAPSHOT", ships=ships)
    return JSONResponse(payload)


@app.get("/api/scenarios", tags=["scenarios"])
async def list_scenarios() -> JSONResponse:
    scenarios = scenario_service.list_scenarios()
    return JSONResponse(
        {
            "type": "SCENARIO_LIST",
            "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
            "count": len(scenarios),
            "scenarios": scenarios,
        }
    )


@app.get("/api/scenarios/playback", tags=["scenarios"])
async def playback_scenarios(
    start: str = Query(..., description="ISO UTC start time"),
    end: str = Query(..., description="ISO UTC end time"),
    type: str = Query(..., description="Snapshot type"),
) -> JSONResponse:
    snapshots = scenario_service.get_snapshot_range(start=start, end=end, data_type=type)
    return JSONResponse(
        {
            "type": "SCENARIO_PLAYBACK",
            "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
            "start": start,
            "end": end,
            "data_type": type,
            "count": len(snapshots),
            "snapshots": snapshots,
        }
    )


@app.get("/api/scenarios/export/czml", tags=["scenarios"])
async def export_scenario_czml(
    start: str = Query(..., description="ISO UTC start time"),
    end: str = Query(..., description="ISO UTC end time"),
) -> Response:
    czml = scenario_service.export_czml(start=start, end=end)
    return Response(content=czml, media_type="application/json")


@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket) -> None:
    global _last_positions

    await telemetry_manager.connect(websocket)
    try:
        positions = await asyncio.to_thread(tle_service.compute_positions)
        _last_positions = {
            int(sat["id"]): (float(sat["lat"]), float(sat["lon"]))
            for sat in positions
            if sat.get("id") is not None
        }
        snapshot_text, snapshot_dict = _build_compressed_payload(
            msg_type="SAT_SNAPSHOT",
            positions=positions,
            extra={"delta": False},
        )
        await websocket.send_text(snapshot_text)
        await _record_scenario_snapshot_safely("satellites", snapshot_dict)

        tick_count = 0

        while True:
            await asyncio.sleep(TELEMETRY_INTERVAL_SECONDS)
            positions = await asyncio.to_thread(tle_service.compute_positions)
            tick_count += 1

            if tick_count % TELEMETRY_FULL_UPDATE_EVERY_TICKS == 0:
                _last_positions = {
                    int(sat["id"]): (float(sat["lat"]), float(sat["lon"]))
                    for sat in positions
                    if sat.get("id") is not None
                }
                payload_text, payload_dict = _build_compressed_payload(
                    msg_type="SAT_UPDATE",
                    positions=positions,
                    extra={"delta": False},
                )
            else:
                changed: list[dict[str, Any]] = []
                for sat in positions:
                    sat_id = sat.get("id")
                    lat = _to_float(sat.get("lat"))
                    lon = _to_float(sat.get("lon"))
                    if sat_id is None or lat is None or lon is None:
                        changed.append(sat)
                        continue

                    prev = _last_positions.get(int(sat_id))
                    if prev is None:
                        changed.append(sat)
                        continue

                    if (
                        abs(lat - prev[0]) > TELEMETRY_DELTA_THRESHOLD_DEG
                        or abs(lon - prev[1]) > TELEMETRY_DELTA_THRESHOLD_DEG
                    ):
                        changed.append(sat)

                _last_positions = {
                    int(sat["id"]): (float(sat["lat"]), float(sat["lon"]))
                    for sat in positions
                    if sat.get("id") is not None
                }
                payload_text, payload_dict = _build_compressed_payload(
                    msg_type="SAT_UPDATE",
                    positions=changed,
                    extra={"total": len(positions), "delta": True},
                )

            await websocket.send_text(payload_text)
            await _record_scenario_snapshot_safely("satellites", payload_dict)

    except WebSocketDisconnect:
        telemetry_manager.disconnect(websocket)
    except Exception as exc:
        logger.error("Telemetry WebSocket error: %s", exc)
        telemetry_manager.disconnect(websocket)


@app.websocket("/ws/flights")
async def websocket_flights(websocket: WebSocket) -> None:
    await flight_manager.connect(websocket)
    try:
        snapshot = await _build_flight_payload(msg_type="FLIGHT_UPDATE", force_refresh=True)
        await websocket.send_text(json.dumps(snapshot))
        await _record_scenario_snapshot_safely("flights", snapshot)

        while True:
            await asyncio.sleep(FLIGHT_INTERVAL_SECONDS)
            payload = await _build_flight_payload(msg_type="FLIGHT_UPDATE", force_refresh=False)
            await websocket.send_text(json.dumps(payload))
            await _record_scenario_snapshot_safely("flights", payload)

    except WebSocketDisconnect:
        flight_manager.disconnect(websocket)
    except Exception as exc:
        logger.error("Flights WebSocket error: %s", exc)
        flight_manager.disconnect(websocket)


@app.websocket("/ws/knowledge-graph")
async def websocket_knowledge_graph(websocket: WebSocket) -> None:
    await graph_manager.connect(websocket)
    try:
        payload = await _build_graph_payload(msg_type="GRAPH_UPDATE")
        await websocket.send_text(json.dumps(payload))
        await _record_scenario_snapshot_safely("osint", payload)

        for event in await _consume_graph_emerging_events():
            await websocket.send_text(json.dumps(event))
            await _record_scenario_snapshot_safely("alerts", event)

        while True:
            await asyncio.sleep(GRAPH_INTERVAL_SECONDS)
            payload = await _build_graph_payload(msg_type="GRAPH_UPDATE")
            await websocket.send_text(json.dumps(payload))
            await _record_scenario_snapshot_safely("osint", payload)

            for event in await _consume_graph_emerging_events():
                await websocket.send_text(json.dumps(event))
                await _record_scenario_snapshot_safely("alerts", event)

    except WebSocketDisconnect:
        graph_manager.disconnect(websocket)
    except Exception as exc:
        logger.error("Knowledge graph WebSocket error: %s", exc)
        graph_manager.disconnect(websocket)


@app.websocket("/ws/space-weather")
async def websocket_space_weather(websocket: WebSocket) -> None:
    await weather_manager.connect(websocket)
    try:
        initial = {
            "type": "SPACE_WEATHER_STATUS",
            "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
            "status": space_weather_service.get_current_status(),
        }
        await websocket.send_text(json.dumps(initial))
        await _record_scenario_snapshot_safely("weather", initial)
        last_alert_level = str(initial["status"].get("alert_level", "GREEN"))

        while True:
            await asyncio.sleep(ALERT_POLL_INTERVAL_SECONDS)
            current_status = space_weather_service.get_current_status()
            current_level = str(current_status.get("alert_level", "GREEN"))
            if current_level == last_alert_level:
                continue
            payload = {
                "type": "SPACE_WEATHER_UPDATE",
                "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
                "event": {
                    "type": "SPACE_WEATHER_ALERT",
                    "severity": current_level,
                    "message": f"Space weather alert level changed: {last_alert_level} -> {current_level}",
                    "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                },
                "status": current_status,
            }
            await websocket.send_text(json.dumps(payload))
            await _record_scenario_snapshot_safely("weather", payload)
            last_alert_level = current_level

    except WebSocketDisconnect:
        weather_manager.disconnect(websocket)
    except Exception as exc:
        logger.error("Space-weather WebSocket error: %s", exc)
        weather_manager.disconnect(websocket)


@app.websocket("/ws/ships")
async def websocket_ships(websocket: WebSocket) -> None:
    await ship_manager.connect(websocket)
    try:
        snapshot = _build_ship_payload(msg_type="SHIP_UPDATE", ships=ais_service.get_ships())
        await websocket.send_text(json.dumps(snapshot))
        await _record_scenario_snapshot_safely("ships", snapshot)

        while True:
            await asyncio.sleep(SHIP_INTERVAL_SECONDS + 2)
            payload = _build_ship_payload(msg_type="SHIP_UPDATE", ships=ais_service.get_ships())
            await websocket.send_text(json.dumps(payload))
            await _record_scenario_snapshot_safely("ships", payload)

    except WebSocketDisconnect:
        ship_manager.disconnect(websocket)
    except Exception as exc:
        logger.error("Ships WebSocket error: %s", exc)
        ship_manager.disconnect(websocket)


@app.websocket("/ws/alerts")
async def websocket_alerts(websocket: WebSocket) -> None:
    await alert_manager.connect(websocket)
    try:
        ready = {
            "type": "ALERT_STREAM_READY",
            "severity": SEVERITY_LOW,
            "message": "Unified alert stream connected.",
            "lat": None,
            "lon": None,
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        }
        await websocket.send_text(json.dumps(ready))
        await _record_scenario_snapshot_safely("alerts", ready)

        last_rf_emit = 0.0
        last_osint_poll = 0.0
        loop = asyncio.get_running_loop()

        while True:
            await asyncio.sleep(ALERT_POLL_INTERVAL_SECONDS)
            now_monotonic = loop.time()
            outgoing: list[dict[str, Any]] = []

            maneuvers = await _consume_maneuver_alerts()
            for maneuver in maneuvers:
                outgoing.append(_to_maneuver_alert(maneuver))

            for weather_event in space_weather_service.consume_alert_events():
                outgoing.append(_to_space_weather_alert(weather_event))

            if now_monotonic - last_osint_poll >= GRAPH_INTERVAL_SECONDS:
                last_osint_poll = now_monotonic
                try:
                    await osint_service.get_knowledge_graph(force_refresh=False)
                except Exception as exc:
                    logger.debug("OSINT refresh attempt in /ws/alerts failed: %s", exc)

            for emerging_event in await _consume_alert_emerging_events():
                outgoing.append(_to_emerging_event_alert(emerging_event))

            if now_monotonic - last_rf_emit >= RF_ALERT_INTERVAL_SECONDS:
                last_rf_emit = now_monotonic
                try:
                    fc = await rf_service.get_rf_anomaly_zones(force_refresh=True)
                    outgoing.extend(
                        _to_rf_alerts(
                            feature_collection=fc.model_dump(mode="json"),
                            max_items=MAX_RF_ALERT_FEATURES_PER_TICK,
                        )
                    )
                except Exception as exc:
                    logger.warning("RF refresh in /ws/alerts failed: %s", exc)

            if not outgoing:
                continue

            for alert in outgoing:
                await websocket.send_text(json.dumps(alert))
                await _record_scenario_snapshot_safely("alerts", alert)

    except WebSocketDisconnect:
        alert_manager.disconnect(websocket)
    except Exception as exc:
        logger.error("Alerts WebSocket error: %s", exc)
        alert_manager.disconnect(websocket)


async def _initialize_service_background(name: str, coro: Any) -> None:
    try:
        await coro
        logger.info("%s initialization completed.", name)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("%s initialization failed: %s", name, exc)


async def _scenario_auto_record_loop(interval_seconds: int) -> None:
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            satellites_payload = _build_satellite_payload(
                msg_type="SAT_SNAPSHOT",
                positions=tle_service.compute_positions(),
            )
            flights_payload = await _build_flight_payload(msg_type="FLIGHT_SNAPSHOT")
            ships_payload = _build_ship_payload(
                msg_type="SHIP_SNAPSHOT",
                ships=ais_service.get_ships(),
            )
            weather_payload = {
                "type": "SPACE_WEATHER_SNAPSHOT",
                "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
                "status": space_weather_service.get_current_status(),
            }

            await asyncio.gather(
                _record_scenario_snapshot_safely("satellites", satellites_payload),
                _record_scenario_snapshot_safely("flights", flights_payload),
                _record_scenario_snapshot_safely("ships", ships_payload),
                _record_scenario_snapshot_safely("weather", weather_payload),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Scenario auto-record loop failed: %s", exc)


async def _emerging_event_fanout_loop() -> None:
    while True:
        await asyncio.sleep(1)
        try:
            events = osint_service.consume_emerging_events()
            if not events:
                continue
            async with _emerging_alert_lock:
                for event in events:
                    cloned = dict(event)
                    _emerging_graph_queue.append(cloned)
                    _emerging_alert_queue.append(dict(cloned))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.debug("Emerging-event fanout loop error: %s", exc)


async def _record_scenario_snapshot_safely(data_type: str, payload: dict[str, Any]) -> None:
    try:
        await scenario_service.record_snapshot(data_type=data_type, payload=payload)
    except Exception as exc:
        logger.warning("Scenario snapshot record failed for %s: %s", data_type, exc)


async def _consume_maneuver_alerts() -> list[dict[str, Any]]:
    async with _maneuver_alert_lock:
        events = list(_maneuver_alert_queue)
        _maneuver_alert_queue.clear()
    return events


async def _consume_graph_emerging_events() -> list[dict[str, Any]]:
    async with _emerging_alert_lock:
        events = list(_emerging_graph_queue)
        _emerging_graph_queue.clear()
    return events


async def _consume_alert_emerging_events() -> list[dict[str, Any]]:
    async with _emerging_alert_lock:
        events = list(_emerging_alert_queue)
        _emerging_alert_queue.clear()
    return events


def _build_satellite_payload(msg_type: str, positions: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": msg_type,
        "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
        "count": len(positions),
        "satellites": positions,
    }


def _build_compressed_payload(
    msg_type: str,
    positions: list[dict[str, Any]] | None = None,
    extra: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    if positions is None:
        positions = tle_service.compute_positions()

    payload: dict[str, Any] = {
        "type": msg_type,
        "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
        "count": len(positions),
        "satellites": positions,
    }
    if extra:
        payload.update(extra)

    # Keep payload schema stable for frontend consumers.
    # Compression hooks can be layered at transport level if required.
    return json.dumps(payload), payload


async def _build_flight_payload(
    msg_type: str,
    flights: list[dict[str, Any]] | None = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    if flights is None:
        flights = await opensky_service.get_flights(force_refresh=force_refresh)

    return {
        "type": msg_type,
        "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
        "count": len(flights),
        "flights": flights,
    }


async def _build_graph_payload(
    msg_type: str,
    graph: dict[str, Any] | None = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    if graph is None:
        graph = await osint_service.get_knowledge_graph(force_refresh=force_refresh)

    return {
        "type": msg_type,
        "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
        "node_count": len(graph.get("nodes", [])),
        "link_count": len(graph.get("links", [])),
        "graph": graph,
    }


def _build_ship_payload(msg_type: str, ships: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": msg_type,
        "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
        "count": len(ships),
        "ships": ships,
    }


def _to_maneuver_alert(maneuver: dict[str, Any]) -> dict[str, Any]:
    confidence = _to_float(maneuver.get("confidence")) or 0.0
    severity = _confidence_to_severity(confidence)
    name = str(maneuver.get("name") or f"NORAD-{maneuver.get('norad_id')}")
    maneuver_type = str(maneuver.get("type") or "UNKNOWN")

    return {
        "type": "MANEUVER_DETECTED",
        "severity": severity,
        "message": f"{name} maneuver detected: {maneuver_type} (confidence={confidence:.2f})",
        "lat": None,
        "lon": None,
        "timestamp": str(maneuver.get("detected_at") or datetime.now(tz=timezone.utc).isoformat()),
    }


def _to_space_weather_alert(event: dict[str, Any]) -> dict[str, Any]:
    severity = str(event.get("severity") or "GREEN")
    if severity == "GREEN":
        mapped_severity = SEVERITY_LOW
    elif severity == "AMBER":
        mapped_severity = SEVERITY_MEDIUM
    else:
        mapped_severity = SEVERITY_HIGH

    return {
        "type": str(event.get("type") or "SPACE_WEATHER_ALERT"),
        "severity": mapped_severity,
        "message": str(event.get("message") or "Space weather status changed."),
        "lat": None,
        "lon": None,
        "timestamp": str(event.get("timestamp") or datetime.now(tz=timezone.utc).isoformat()),
    }


def _to_emerging_event_alert(event: dict[str, Any]) -> dict[str, Any]:
    confidence = _to_float(event.get("confidence")) or 0.0
    severity = _confidence_to_severity(confidence)
    location = str(event.get("location") or "unknown location")
    article_count = int(_to_float(event.get("article_count")) or 0)

    return {
        "type": "EMERGING_EVENT",
        "severity": severity,
        "message": f"Emerging OSINT event near {location} ({article_count} related articles)",
        "lat": _to_float(event.get("lat")),
        "lon": _to_float(event.get("lon")),
        "timestamp": str(event.get("timestamp") or datetime.now(tz=timezone.utc).isoformat()),
    }


def _to_rf_alerts(feature_collection: dict[str, Any], max_items: int) -> list[dict[str, Any]]:
    features = feature_collection.get("features", [])
    if not isinstance(features, list):
        return []

    alerts: list[dict[str, Any]] = []
    for feature in features[:max_items]:
        if not isinstance(feature, dict):
            continue

        properties = feature.get("properties", {})
        geometry = feature.get("geometry", {})

        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            continue

        confidence = _to_float(properties.get("confidence")) or 0.0
        severity = _confidence_to_severity(confidence)
        anomaly_count = int(_to_float(properties.get("anomaly_count")) or 0)
        region_id = str(properties.get("region_id") or "unknown")
        lat, lon = _polygon_centroid(geometry)

        alerts.append(
            {
                "type": "RF_ANOMALY",
                "severity": severity,
                "message": f"RF anomaly zone {region_id} with {anomaly_count} flagged aircraft",
                "lat": lat,
                "lon": lon,
                "timestamp": datetime.now(tz=timezone.utc).isoformat(),
            }
        )

    return alerts


def _polygon_centroid(geometry: dict[str, Any]) -> tuple[float | None, float | None]:
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or not coordinates:
        return None, None

    ring = coordinates[0]
    if not isinstance(ring, list) or len(ring) < 3:
        return None, None

    points: list[tuple[float, float]] = []
    for point in ring:
        if not isinstance(point, list) or len(point) < 2:
            continue
        lon = _to_float(point[0])
        lat = _to_float(point[1])
        if lon is None or lat is None:
            continue
        points.append((lat, lon))

    if not points:
        return None, None

    # Exclude final closing point if it duplicates the first.
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]

    if not points:
        return None, None

    avg_lat = sum(p[0] for p in points) / len(points)
    avg_lon = sum(p[1] for p in points) / len(points)
    return round(avg_lat, 6), round(avg_lon, 6)


def _confidence_to_severity(confidence: float) -> str:
    if confidence >= 0.9:
        return SEVERITY_CRITICAL
    if confidence >= 0.7:
        return SEVERITY_HIGH
    if confidence >= 0.4:
        return SEVERITY_MEDIUM
    return SEVERITY_LOW


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _build_overpass_passes(
    satellite: Any,
    observer: Any,
    event_times: Any,
    event_codes: Any,
    now_utc: datetime,
    limit: int = 5,
) -> list[dict[str, Any]]:
    passes: list[dict[str, Any]] = []
    track = satellite - observer
    current: dict[str, datetime | None] = {"rise": None, "culmination": None, "set": None}

    for sf_time, code in zip(event_times, event_codes):
        event_time_utc = _to_utc_datetime(sf_time.utc_datetime())
        event_code = int(code)

        if event_code == 0:
            current = {"rise": event_time_utc, "culmination": None, "set": None}
            continue

        if event_code == 1:
            current["culmination"] = event_time_utc
            continue

        if event_code == 2:
            current["set"] = event_time_utc
            pass_record = _finalize_pass(current, track, now_utc)
            if pass_record is not None:
                passes.append(pass_record)
                if len(passes) >= limit:
                    break
            current = {"rise": None, "culmination": None, "set": None}

    if len(passes) < limit:
        trailing_pass = _finalize_pass(current, track, now_utc)
        if trailing_pass is not None:
            passes.append(trailing_pass)

    return passes


def _finalize_pass(
    pass_data: dict[str, datetime | None],
    track: Any,
    now_utc: datetime,
) -> dict[str, Any] | None:
    culmination = pass_data.get("culmination")
    if culmination is None:
        return None

    culmination_time = tle_service.ts.from_datetime(culmination)
    max_elevation_deg: float | None = None
    try:
        alt, _, _ = track.at(culmination_time).altaz()
        max_elevation_deg = round(float(alt.degrees), 2)
    except Exception:
        max_elevation_deg = None

    first_event = pass_data.get("rise") or culmination or pass_data.get("set")
    countdown_seconds = (
        max(0, int((first_event - now_utc).total_seconds()))
        if first_event is not None
        else 0
    )

    return {
        "rise_time_utc": _to_iso(pass_data.get("rise")),
        "culmination_time_utc": _to_iso(culmination),
        "set_time_utc": _to_iso(pass_data.get("set")),
        "max_elevation_deg": max_elevation_deg,
        "countdown_seconds": countdown_seconds,
    }


def _to_iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _to_utc_datetime(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
