"""
Project Nemesis — OpenSky Service
===================================
Fetches and caches live ADS-B aircraft state vectors from OpenSky and computes
short-horizon projected trajectories.
"""

from __future__ import annotations

import asyncio
import logging
import math
import random
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)

OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all"
# Mean Earth radius in meters used for great-circle projections.
EARTH_RADIUS_M = 6_371_000.0
# Future prediction offsets in minutes.
TIME_OFFSETS_MIN = [5, 10, 15]
# Minimum interval between OpenSky refreshes to respect anonymous API limits.
MIN_REFRESH_SECONDS_DEFAULT = 15
# Demo fallback settings when OpenSky is unavailable or rate-limited.
DEMO_FLIGHT_COUNT = 30
DEMO_ALTITUDE_MIN_M = 8_000.0
DEMO_ALTITUDE_MAX_M = 12_000.0
DEMO_VELOCITY_MIN_MPS = 220.0
DEMO_VELOCITY_MAX_MPS = 280.0
DEMO_POSITION_JITTER_DEG = 2.0
DEMO_AIRPORTS = [
    {"name": "London Heathrow", "lat": 51.4775, "lon": -0.4614, "prefixes": ("BA", "VS")},
    {"name": "Dubai", "lat": 25.2532, "lon": 55.3657, "prefixes": ("EK", "FZ")},
    {"name": "Singapore Changi", "lat": 1.3644, "lon": 103.9915, "prefixes": ("SQ", "TR")},
    {"name": "JFK", "lat": 40.6413, "lon": -73.7781, "prefixes": ("DL", "AA", "UA")},
    {"name": "Mumbai", "lat": 19.0896, "lon": 72.8656, "prefixes": ("AI", "UK", "6E")},
]


class TrajectoryPoint(BaseModel):
    """A projected aircraft position at a future time offset."""

    model_config = ConfigDict(extra="forbid")

    lat: float
    lon: float
    time_offset_min: int


class FlightState(BaseModel):
    """Normalized OpenSky aircraft state with optional projected trajectory."""

    model_config = ConfigDict(extra="ignore")

    icao24: str
    callsign: str | None = None
    lat: float
    lon: float
    latitude: float
    longitude: float
    altitude_baro: float | None = None
    velocity: float | None = None
    heading: float | None = None
    true_track: float | None = None
    last_contact: int | None = None
    on_ground: bool = False
    trajectory: list[TrajectoryPoint] = Field(default_factory=list)


def project_position(
    lat: float,
    lon: float,
    bearing_deg: float,
    distance_m: float,
) -> tuple[float, float]:
    """
    Project a point along a great-circle arc on a spherical Earth model.

    Returns latitude and longitude in decimal degrees, normalized to
    [-90, 90] and [-180, 180].
    """
    angular_distance = distance_m / EARTH_RADIUS_M
    bearing_rad = math.radians(bearing_deg)

    lat1 = math.radians(lat)
    lon1 = math.radians(lon)

    sin_lat2 = (
        math.sin(lat1) * math.cos(angular_distance)
        + math.cos(lat1) * math.sin(angular_distance) * math.cos(bearing_rad)
    )
    sin_lat2 = max(-1.0, min(1.0, sin_lat2))
    lat2 = math.asin(sin_lat2)

    lon2 = lon1 + math.atan2(
        math.sin(bearing_rad) * math.sin(angular_distance) * math.cos(lat1),
        math.cos(angular_distance) - math.sin(lat1) * math.sin(lat2),
    )

    lat_deg = math.degrees(lat2)
    lon_deg = math.degrees(lon2)

    lat_deg = max(-90.0, min(90.0, lat_deg))
    lon_deg = ((lon_deg + 180.0) % 360.0) - 180.0

    return lat_deg, lon_deg


class OpenSkyService:
    """Fetches OpenSky aircraft states with local cache and rate-limit backoff."""

    def __init__(
        self,
        api_url: str = OPENSKY_STATES_URL,
        timeout_seconds: float = 15.0,
        min_refresh_seconds: int = MIN_REFRESH_SECONDS_DEFAULT,
        rate_limit_backoff_seconds: int = 30,
    ) -> None:
        self._api_url = api_url
        self._timeout_seconds = timeout_seconds
        self._min_refresh_seconds = min_refresh_seconds
        self._rate_limit_backoff_seconds = rate_limit_backoff_seconds

        self._cache: list[dict[str, Any]] = []
        self._last_refresh_utc: datetime | None = None
        self._backoff_until_utc: datetime | None = None
        self._lock = asyncio.Lock()

    async def get_flights(self, force_refresh: bool = False) -> list[dict[str, Any]]:
        """
        Returns cached flights.
        Refreshes from OpenSky when stale or when `force_refresh=True`,
        while still honoring active rate-limit backoff windows.
        """
        if not force_refresh and self._is_cache_fresh():
            return list(self._cache)

        async with self._lock:
            if not force_refresh and self._is_cache_fresh():
                return list(self._cache)

            await self._refresh_locked()
            return list(self._cache)

    @property
    def status(self) -> dict[str, Any]:
        """Operational state for health/snapshot metadata."""
        now_utc = self._utc_now()
        backoff_seconds_remaining = 0
        in_backoff = False

        if self._backoff_until_utc and self._backoff_until_utc > now_utc:
            in_backoff = True
            backoff_seconds_remaining = int(
                (self._backoff_until_utc - now_utc).total_seconds()
            )

        return {
            "cached_flights": len(self._cache),
            "last_refresh_utc": (
                self._last_refresh_utc.isoformat() if self._last_refresh_utc else None
            ),
            "in_backoff": in_backoff,
            "backoff_seconds_remaining": max(0, backoff_seconds_remaining),
        }

    def _is_cache_fresh(self) -> bool:
        if not self._cache or self._last_refresh_utc is None:
            return False

        age_seconds = (self._utc_now() - self._last_refresh_utc).total_seconds()
        return age_seconds < self._min_refresh_seconds

    async def _refresh_locked(self) -> None:
        """Fetches latest states from OpenSky and updates cache."""
        now_utc = self._utc_now()

        if self._backoff_until_utc and now_utc < self._backoff_until_utc:
            logger.info(
                "OpenSky rate-limit backoff active (%ss remaining).",
                int((self._backoff_until_utc - now_utc).total_seconds()),
            )
            if not self._cache:
                self._cache = self._generate_demo_flights()
                self._last_refresh_utc = now_utc
            return

        try:
            async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
                response = await client.get(self._api_url)

            if response.status_code == 429:
                self._backoff_until_utc = now_utc + timedelta(
                    seconds=self._rate_limit_backoff_seconds
                )
                logger.warning(
                    "OpenSky returned 429. Backing off for %ss.",
                    self._rate_limit_backoff_seconds,
                )
                self._cache = self._generate_demo_flights()
                self._last_refresh_utc = self._utc_now()
                return

            response.raise_for_status()
            payload = response.json()
            states = payload.get("states", [])
            parsed_flights = self._parse_states(states)
            if not parsed_flights:
                logger.warning("OpenSky returned empty states; using demo flights fallback.")
                self._cache = self._generate_demo_flights()
            else:
                self._cache = parsed_flights
            self._last_refresh_utc = self._utc_now()
            self._backoff_until_utc = None
            logger.info("OpenSky refresh complete — %s flights cached.", len(self._cache))

        except httpx.HTTPStatusError as exc:
            logger.warning("OpenSky HTTP status error: %s", exc)
            if not self._cache:
                self._cache = self._generate_demo_flights()
                self._last_refresh_utc = self._utc_now()
        except httpx.RequestError as exc:
            logger.warning("OpenSky request error: %s", exc)
            if not self._cache:
                self._cache = self._generate_demo_flights()
                self._last_refresh_utc = self._utc_now()
        except Exception as exc:
            logger.warning("OpenSky unexpected error: %s", exc)
            if not self._cache:
                self._cache = self._generate_demo_flights()
                self._last_refresh_utc = self._utc_now()

    def _parse_states(self, states: Any) -> list[dict[str, Any]]:
        """
        OpenSky state vector fields:
        [0]=icao24, [1]=callsign, [4]=last_contact, [5]=lon, [6]=lat,
        [7]=baro_altitude, [8]=on_ground, [9]=velocity, [10]=true_track
        """
        flights: list[FlightState] = []
        if not isinstance(states, list):
            return []

        for state in states:
            if not isinstance(state, list) or len(state) < 11:
                continue

            lat = self._to_float(state[6])
            lon = self._to_float(state[5])
            if lat is None or lon is None:
                continue
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                continue

            icao24_raw = state[0]
            if icao24_raw is None:
                continue

            icao24 = str(icao24_raw).strip().lower()
            if not icao24:
                continue

            callsign_raw = state[1]
            callsign = callsign_raw.strip() if isinstance(callsign_raw, str) else None
            if callsign == "":
                callsign = None

            velocity = self._to_float(state[9])
            true_track = self._to_float(state[10])
            on_ground = bool(state[8]) if state[8] is not None else False

            trajectory = self._build_trajectory(
                lat=lat,
                lon=lon,
                velocity_ms=velocity,
                true_track_deg=true_track,
                on_ground=on_ground,
            )

            flight = FlightState(
                icao24=icao24,
                callsign=callsign,
                lat=round(lat, 5),
                lon=round(lon, 5),
                latitude=round(lat, 5),
                longitude=round(lon, 5),
                altitude_baro=self._to_float(state[7]),
                velocity=velocity,
                heading=true_track,
                true_track=true_track,
                last_contact=self._to_int(state[4]),
                on_ground=on_ground,
                trajectory=trajectory,
            )
            flights.append(flight)

        flights.sort(key=lambda flight: flight.icao24)

        trajectories_non_empty = sum(1 for flight in flights if flight.trajectory)
        logger.debug(
            "Trajectory projection complete: %s/%s flights with projected paths.",
            trajectories_non_empty,
            len(flights),
        )

        return [flight.model_dump(mode="json") for flight in flights]

    def _build_trajectory(
        self,
        lat: float | None,
        lon: float | None,
        velocity_ms: float | None,
        true_track_deg: float | None,
        on_ground: bool,
    ) -> list[TrajectoryPoint]:
        if lat is None or lon is None:
            return []
        if on_ground:
            return []
        if velocity_ms is None or velocity_ms <= 0.0:
            return []
        if true_track_deg is None:
            return []

        trajectory: list[TrajectoryPoint] = []

        for offset_min in TIME_OFFSETS_MIN:
            offset_seconds = offset_min * 60
            distance_m = velocity_ms * offset_seconds

            try:
                projected_lat, projected_lon = project_position(
                    lat=lat,
                    lon=lon,
                    bearing_deg=true_track_deg,
                    distance_m=distance_m,
                )
            except Exception as exc:
                logger.debug("Trajectory projection failed for offset=%s: %s", offset_min, exc)
                continue

            trajectory.append(
                TrajectoryPoint(
                    lat=round(projected_lat, 6),
                    lon=round(projected_lon, 6),
                    time_offset_min=offset_min,
                )
            )

        return trajectory

    def _generate_demo_flights(self, count: int = DEMO_FLIGHT_COUNT) -> list[dict[str, Any]]:
        """Generates realistic demo flights near major global hubs."""
        now = self._utc_now()
        seed = int(now.timestamp() // 60)
        rand = random.Random(seed)
        flights: list[FlightState] = []

        for index in range(count):
            airport = DEMO_AIRPORTS[index % len(DEMO_AIRPORTS)]
            lat = airport["lat"] + rand.uniform(-DEMO_POSITION_JITTER_DEG, DEMO_POSITION_JITTER_DEG)
            lon = airport["lon"] + rand.uniform(-DEMO_POSITION_JITTER_DEG, DEMO_POSITION_JITTER_DEG)
            lat = max(-90.0, min(90.0, lat))
            lon = ((lon + 180.0) % 360.0) - 180.0

            velocity = rand.uniform(DEMO_VELOCITY_MIN_MPS, DEMO_VELOCITY_MAX_MPS)
            heading = rand.uniform(0.0, 359.9)
            altitude_baro = rand.uniform(DEMO_ALTITUDE_MIN_M, DEMO_ALTITUDE_MAX_M)
            prefix = rand.choice(airport["prefixes"])
            callsign = f"{prefix}{rand.randint(10, 9999):04d}"
            icao24 = f"{rand.randint(0, 0xFFFFFF):06x}"
            last_contact = int(now.timestamp()) - rand.randint(0, 20)

            trajectory = self._build_trajectory(
                lat=lat,
                lon=lon,
                velocity_ms=velocity,
                true_track_deg=heading,
                on_ground=False,
            )

            flights.append(
                FlightState(
                    icao24=icao24,
                    callsign=callsign,
                    lat=round(lat, 5),
                    lon=round(lon, 5),
                    latitude=round(lat, 5),
                    longitude=round(lon, 5),
                    altitude_baro=round(altitude_baro, 2),
                    velocity=round(velocity, 2),
                    heading=round(heading, 2),
                    true_track=round(heading, 2),
                    last_contact=last_contact,
                    on_ground=False,
                    trajectory=trajectory,
                )
            )

        flights.sort(key=lambda flight: flight.icao24)
        logger.info("Using demo flight fallback (%s flights).", len(flights))
        return [flight.model_dump(mode="json") for flight in flights]

    @staticmethod
    def _to_float(value: Any) -> float | None:
        if isinstance(value, (int, float)):
            return float(value)
        return None

    @staticmethod
    def _to_int(value: Any) -> int | None:
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        return None

    @staticmethod
    def _utc_now() -> datetime:
        return datetime.now(tz=timezone.utc)
