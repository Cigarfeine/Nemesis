"""
Space weather service backed by NOAA SWPC public feeds.
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

KP_URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"
XRAY_URL = "https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json"
WIND_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json"
ALERTS_URL = "https://services.swpc.noaa.gov/products/alerts.json"

HTTP_TIMEOUT_SECONDS = 10.0
ALERT_HISTORY_LIMIT = 50


class SpaceWeatherService:
    """Fetches and caches space-weather indicators from NOAA SWPC."""

    def __init__(self) -> None:
        self._status: dict[str, Any] = self._default_status()
        self._lock = asyncio.Lock()
        self._alert_events: deque[dict[str, Any]] = deque(maxlen=ALERT_HISTORY_LIMIT)

    async def initialize(self) -> None:
        """Performs initial data fetch."""
        await self.refresh_once()

    async def start_refresh_loop(self, interval: int = 600) -> None:
        """Refreshes space-weather data continuously."""
        while True:
            await asyncio.sleep(interval)
            await self.refresh_once()

    async def refresh_once(self) -> None:
        """Fetches all data sources once and updates current status."""
        previous_alert_level = self._status.get("alert_level", "GREEN")

        kp_value = await self._fetch_latest_kp()
        xray_flux = await self._fetch_latest_xray_flux()
        wind_speed = await self._fetch_latest_wind_speed()
        alerts = await self._fetch_alerts()

        kp_level = self._kp_alert_level(kp_value)
        flare_class = self._flare_class(xray_flux)
        wind_alert = wind_speed is not None and wind_speed > 600.0

        overall_level = self._merge_alert_levels(
            kp_level=kp_level,
            flare_class=flare_class,
            wind_alert=wind_alert,
        )

        updated = {
            "timestamp_utc": datetime.now(tz=timezone.utc).isoformat(),
            "alert_level": overall_level,
            "kp_index": kp_value,
            "kp_level": kp_level,
            "xray_flux": xray_flux,
            "flare_class": flare_class,
            "solar_wind_speed": wind_speed,
            "solar_wind_alert": wind_alert,
            "active_alerts": alerts,
        }

        async with self._lock:
            self._status = updated
            if overall_level != previous_alert_level:
                event = {
                    "type": "SPACE_WEATHER_ALERT",
                    "severity": overall_level,
                    "message": f"Space weather level changed: {previous_alert_level} -> {overall_level}",
                    "lat": None,
                    "lon": None,
                    "timestamp": updated["timestamp_utc"],
                    "data": updated,
                }
                self._alert_events.append(event)

    def get_current_status(self) -> dict[str, Any]:
        """Returns current space-weather status."""
        return dict(self._status)

    def consume_alert_events(self) -> list[dict[str, Any]]:
        """Returns and clears queued alert-level-change events."""
        events = list(self._alert_events)
        self._alert_events.clear()
        return events

    @property
    def status(self) -> dict[str, Any]:
        return {
            "alert_level": self._status.get("alert_level"),
            "last_update": self._status.get("timestamp_utc"),
            "queued_events": len(self._alert_events),
        }

    async def _fetch_kp(self) -> Any:
        """
        Fetches raw Kp NOAA payload for diagnostics.

        Returns parsed JSON payload on success, or an error object on failure.
        """
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = await client.get(KP_URL)
                response.raise_for_status()
                return response.json()
        except Exception as exc:
            logger.warning("Space weather Kp fetch failed: %s", exc)
            return {
                "error": type(exc).__name__,
                "message": str(exc),
            }

    async def _fetch_latest_kp(self) -> float | None:
        payload = await self._fetch_kp()
        if isinstance(payload, dict) and "error" in payload:
            return None

        if not isinstance(payload, list):
            return None

        for row in reversed(payload):
            if not isinstance(row, dict):
                continue
            value = self._to_float(row.get("kp_index") or row.get("kp"))
            if value is not None:
                return value
        return None

    async def _fetch_latest_xray_flux(self) -> float | None:
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = await client.get(XRAY_URL)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            logger.warning("Space weather X-ray fetch failed: %s", exc)
            return None

        if not isinstance(payload, list):
            return None

        for row in reversed(payload):
            if not isinstance(row, dict):
                continue
            flux = self._to_float(row.get("flux"))
            if flux is not None:
                return flux
        return None

    async def _fetch_latest_wind_speed(self) -> float | None:
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = await client.get(WIND_URL)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            logger.warning("Space weather solar wind fetch failed: %s", exc)
            return None

        if not isinstance(payload, list):
            return None

        for row in reversed(payload):
            if not isinstance(row, dict):
                continue
            speed = self._to_float(row.get("proton_speed") or row.get("speed"))
            if speed is not None:
                return speed
        return None

    async def _fetch_alerts(self) -> list[dict[str, str]]:
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = await client.get(ALERTS_URL)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            logger.warning("Space weather alerts fetch failed: %s", exc)
            return []

        parsed: list[dict[str, str]] = []

        if isinstance(payload, list):
            for item in payload:
                if len(parsed) >= 5:
                    break
                if isinstance(item, list):
                    message = " | ".join(str(part) for part in item if part)
                    issue = ""
                    if item:
                        issue = str(item[0])
                    parsed.append({"issue_time": issue, "message": message})
                elif isinstance(item, str):
                    issue = item[:19] if len(item) >= 19 else ""
                    parsed.append({"issue_time": issue, "message": item.strip()})
                elif isinstance(item, dict):
                    message = str(item.get("message") or item.get("alert") or "")
                    issue = str(item.get("issue_datetime") or item.get("issue_time") or "")
                    parsed.append({"issue_time": issue, "message": message})

        return parsed[:5]

    @staticmethod
    def _kp_alert_level(kp: float | None) -> str:
        if kp is None:
            return "GREEN"
        if kp < 4.0:
            return "GREEN"
        if kp <= 6.0:
            return "AMBER"
        return "RED"

    @staticmethod
    def _flare_class(flux: float | None) -> str:
        if flux is None:
            return "quiet"
        if flux < 1e-6:
            return "quiet"
        if flux < 1e-5:
            return "C"
        if flux < 1e-4:
            return "M"
        return "X"

    @staticmethod
    def _merge_alert_levels(kp_level: str, flare_class: str, wind_alert: bool) -> str:
        level_rank = {"GREEN": 0, "AMBER": 1, "RED": 2}
        max_level = kp_level if kp_level in level_rank else "GREEN"

        if flare_class == "X":
            max_level = "RED"
        elif flare_class == "M" and level_rank[max_level] < level_rank["AMBER"]:
            max_level = "AMBER"

        if wind_alert and level_rank[max_level] < level_rank["AMBER"]:
            max_level = "AMBER"

        return max_level

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
    def _default_status() -> dict[str, Any]:
        return {
            "timestamp_utc": None,
            "alert_level": "GREEN",
            "kp_index": None,
            "kp_level": "GREEN",
            "xray_flux": None,
            "flare_class": "quiet",
            "solar_wind_speed": None,
            "solar_wind_alert": False,
            "active_alerts": [],
        }
