"""
AIS ship-tracking service with public fallback and synthetic lane traffic.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

AISHUB_URL = "http://data.aishub.net/ws.php"
VESSELFINDER_DEMO_URL = "https://www.vessel-finder.com/api/data"

HTTP_TIMEOUT_SECONDS = 10.0
DEFAULT_REFRESH_INTERVAL_SECONDS = 30
DEMO_SHIP_COUNT = 50


class AISService:
    """Provides live ship positions from AISHub with resilient fallbacks."""

    def __init__(self) -> None:
        self._ships: list[dict[str, Any]] = []
        self._lock = asyncio.Lock()
        self._rand = random.Random(42)
        self._tick = 0

    async def initialize(self) -> None:
        """Performs initial ship data fetch."""
        ships = await self._fetch_ships()
        async with self._lock:
            self._ships = ships

    async def start_refresh_loop(self, interval: int = DEFAULT_REFRESH_INTERVAL_SECONDS) -> None:
        """Continuously refreshes ship positions."""
        while True:
            await asyncio.sleep(interval)
            ships = await self._fetch_ships()
            async with self._lock:
                self._ships = ships

    def get_ships(self) -> list[dict[str, Any]]:
        """Returns latest known ship positions."""
        return [dict(ship) for ship in self._ships]

    @property
    def status(self) -> dict[str, Any]:
        return {
            "ships_cached": len(self._ships),
            "last_tick": self._tick,
        }

    async def _fetch_ships(self) -> list[dict[str, Any]]:
        ships = await self._fetch_aishub()
        if ships:
            return ships

        ships = await self._fetch_vesselfinder_demo()
        if ships:
            return ships

        return self._generate_demo_ships()

    async def _fetch_aishub(self) -> list[dict[str, Any]]:
        username = os.getenv("AISHUB_USERNAME")
        if not username:
            return []

        params = {
            "username": username,
            "format": 1,
            "output": "json",
            "compress": 0,
        }

        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = await client.get(AISHUB_URL, params=params)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            logger.warning("AISHub fetch failed: %s", exc)
            return []

        records: list[dict[str, Any]] = []
        if isinstance(payload, dict):
            for key in ("ships", "data", "positions", "result"):
                value = payload.get(key)
                if isinstance(value, list):
                    records = [item for item in value if isinstance(item, dict)]
                    break
        elif isinstance(payload, list):
            records = [item for item in payload if isinstance(item, dict)]

        return self._normalize_ships(records)

    async def _fetch_vesselfinder_demo(self) -> list[dict[str, Any]]:
        params = {
            "vessels": "",
            "api_key": "demo",
        }

        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = await client.get(VESSELFINDER_DEMO_URL, params=params)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            logger.warning("VesselFinder demo fetch failed: %s", exc)
            return []

        records: list[dict[str, Any]] = []
        if isinstance(payload, dict):
            for key in ("data", "vessels", "ships", "result"):
                value = payload.get(key)
                if isinstance(value, list):
                    records = [item for item in value if isinstance(item, dict)]
                    break
        elif isinstance(payload, list):
            records = [item for item in payload if isinstance(item, dict)]

        return self._normalize_ships(records)

    def _normalize_ships(self, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        ships: list[dict[str, Any]] = []

        for record in records:
            mmsi = self._to_str(record.get("MMSI") or record.get("mmsi"))
            name = self._to_str(record.get("NAME") or record.get("name") or "Unknown Vessel")
            lat = self._to_float(record.get("LAT") or record.get("lat") or record.get("latitude"))
            lon = self._to_float(record.get("LON") or record.get("lon") or record.get("longitude"))

            if mmsi is None or lat is None or lon is None:
                continue
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                continue

            speed = self._to_float(record.get("SOG") or record.get("speed") or record.get("speed_knots"))
            heading = self._to_float(record.get("HEADING") or record.get("COG") or record.get("heading") or 0.0)
            ship_type = self._to_str(record.get("SHIPTYPE") or record.get("ship_type") or "Unknown")
            destination = self._to_str(record.get("DESTINATION") or record.get("destination") or "Unknown")

            ships.append(
                {
                    "mmsi": mmsi,
                    "name": name,
                    "lat": round(lat, 5),
                    "lon": round(lon, 5),
                    "speed_knots": round(speed or 0.0, 2),
                    "heading": round(heading or 0.0, 2),
                    "ship_type": ship_type,
                    "destination": destination,
                }
            )

        return ships

    def _generate_demo_ships(self) -> list[dict[str, Any]]:
        lanes = [
            {"name": "Strait of Malacca", "lat": (1.0, 6.5), "lon": (98.0, 103.5)},
            {"name": "English Channel", "lat": (49.0, 51.5), "lon": (-5.5, 2.5)},
            {"name": "Suez Canal", "lat": (29.5, 31.5), "lon": (31.5, 33.5)},
            {"name": "Strait of Hormuz", "lat": (24.0, 27.5), "lon": (54.0, 57.5)},
        ]
        ship_types = ["Cargo", "Tanker", "Container", "LNG", "Bulk Carrier"]

        ships: list[dict[str, Any]] = []
        self._tick += 1

        for i in range(DEMO_SHIP_COUNT):
            lane = lanes[i % len(lanes)]

            lat = self._rand.uniform(*lane["lat"])
            lon = self._rand.uniform(*lane["lon"])

            jitter_scale = 0.03
            lat += self._rand.uniform(-jitter_scale, jitter_scale)
            lon += self._rand.uniform(-jitter_scale, jitter_scale)

            speed = self._rand.uniform(8.0, 22.0)
            heading = self._rand.uniform(0.0, 359.9)
            mmsi = str(200000000 + i)
            name = f"NEMESIS-{i:03d}"

            ships.append(
                {
                    "mmsi": mmsi,
                    "name": name,
                    "lat": round(max(-90.0, min(90.0, lat)), 5),
                    "lon": round(((lon + 180.0) % 360.0) - 180.0, 5),
                    "speed_knots": round(speed, 2),
                    "heading": round(heading, 2),
                    "ship_type": ship_types[i % len(ship_types)],
                    "destination": lane["name"],
                }
            )

        return ships

    @staticmethod
    def _to_float(value: Any) -> float | None:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return None
        return None

    @staticmethod
    def _to_str(value: Any) -> str | None:
        if isinstance(value, str):
            text = value.strip()
            return text if text else None
        if value is None:
            return None
        text = str(value).strip()
        return text if text else None
