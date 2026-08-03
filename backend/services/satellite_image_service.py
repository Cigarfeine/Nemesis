"""
Satellite imagery and mission-profile enrichment service.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

NASA_SEARCH_URL = "https://images-api.nasa.gov/search"
WIKIPEDIA_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
CELESTRAK_SATCAT_URL = "https://celestrak.org/satcat/records.php"

HTTP_TIMEOUT_SECONDS = 10.0
PROFILE_CACHE_TTL_HOURS = 24


class SatelliteImageService:
    """Fetches satellite imagery plus mission data from public APIs."""

    def __init__(self) -> None:
        self._cache: dict[int, tuple[datetime, dict[str, Any]]] = {}
        self._lock = asyncio.Lock()

    async def get_satellite_profile(self, norad_id: int, name: str) -> dict[str, Any]:
        """
        Returns a merged satellite profile including image metadata and mission data.

        Results are cached for 24 hours by NORAD ID.
        """
        now_utc = self._utc_now()
        cached = self._cache.get(norad_id)
        if cached and cached[0] > now_utc:
            return dict(cached[1])

        async with self._lock:
            cached = self._cache.get(norad_id)
            now_utc = self._utc_now()
            if cached and cached[0] > now_utc:
                return dict(cached[1])

            profile = await self._build_profile(norad_id=norad_id, name=name)
            self._cache[norad_id] = (
                now_utc + timedelta(hours=PROFILE_CACHE_TTL_HOURS),
                profile,
            )
            return dict(profile)

    @property
    def status(self) -> dict[str, Any]:
        return {
            "cache_entries": len(self._cache),
            "cache_ttl_hours": PROFILE_CACHE_TTL_HOURS,
        }

    async def _build_profile(self, norad_id: int, name: str) -> dict[str, Any]:
        image = await self._fetch_image_data(name)
        mission_data = await self._fetch_mission_data(norad_id=norad_id, name=name)

        return {
            "norad_id": norad_id,
            "name": name,
            "image_url": image["image_url"],
            "image_source": image["source"],
            "description": image["description"],
            "mission_data": mission_data,
        }

    async def _fetch_image_data(self, name: str) -> dict[str, Any]:
        nasa_data = await self._fetch_nasa_image(name)
        if nasa_data is not None:
            return nasa_data

        wiki_data = await self._fetch_wikipedia_image(name)
        if wiki_data is not None:
            return wiki_data

        return {
            "image_url": None,
            "source": "none",
            "description": "No imagery available for classified or unknown object.",
        }

    async def _fetch_nasa_image(self, name: str) -> dict[str, Any] | None:
        params = {
            "q": name,
            "media_type": "image",
        }

        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = await client.get(NASA_SEARCH_URL, params=params)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            logger.debug("NASA image lookup failed for %s: %s", name, exc)
            return None

        items = payload.get("collection", {}).get("items", [])
        if not isinstance(items, list) or not items:
            return None

        for item in items:
            if not isinstance(item, dict):
                continue
            data_list = item.get("data", [])
            links = item.get("links", [])
            if not data_list or not isinstance(data_list, list):
                continue

            metadata = data_list[0] if isinstance(data_list[0], dict) else {}
            image_url = None
            if isinstance(links, list):
                for link in links:
                    if not isinstance(link, dict):
                        continue
                    href = link.get("href")
                    if isinstance(href, str) and href:
                        image_url = href
                        break

            description = metadata.get("description")
            if not isinstance(description, str) or not description.strip():
                description = f"Image match from NASA for {name}."

            return {
                "image_url": image_url,
                "source": "nasa",
                "description": description.strip(),
            }

        return None

    async def _fetch_wikipedia_image(self, name: str) -> dict[str, Any] | None:
        safe_name = name.replace(" ", "_")
        url = WIKIPEDIA_SUMMARY_URL.format(title=safe_name)

        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = await client.get(url)
                if response.status_code == 404:
                    return None
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            logger.debug("Wikipedia image lookup failed for %s: %s", name, exc)
            return None

        thumbnail = payload.get("thumbnail", {})
        image_url = thumbnail.get("source") if isinstance(thumbnail, dict) else None
        extract = payload.get("extract")
        if not isinstance(extract, str) or not extract.strip():
            extract = f"Summary match from Wikipedia for {name}."

        return {
            "image_url": image_url if isinstance(image_url, str) else None,
            "source": "wikipedia",
            "description": extract.strip(),
        }

    async def _fetch_mission_data(self, norad_id: int, name: str) -> dict[str, Any]:
        defaults = {
            "country": "Unknown",
            "launch_date": "Unknown",
            "period_minutes": None,
            "inclination_deg": None,
            "apogee_km": None,
            "perigee_km": None,
            "object_type": "Unknown",
        }

        params = {
            "CATNR": norad_id,
            "FORMAT": "json",
        }

        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = await client.get(CELESTRAK_SATCAT_URL, params=params)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            logger.debug("CelesTrak satcat lookup failed for %s (%s): %s", name, norad_id, exc)
            return defaults

        row = None
        if isinstance(payload, list) and payload:
            row = payload[0] if isinstance(payload[0], dict) else None
        elif isinstance(payload, dict):
            row = payload

        if not isinstance(row, dict):
            return defaults

        country = row.get("COUNTRY")
        launch = row.get("LAUNCH") or row.get("LAUNCH_DATE")
        period = self._to_float(row.get("PERIOD"))
        inclination = self._to_float(row.get("INCLINATION"))
        apogee = self._to_int(row.get("APOGEE"))
        perigee = self._to_int(row.get("PERIGEE"))
        object_type = row.get("OBJECT_TYPE") or row.get("OBJECT") or row.get("OBJECT_NAME")

        return {
            "country": country.strip() if isinstance(country, str) and country.strip() else defaults["country"],
            "launch_date": launch.strip() if isinstance(launch, str) and launch.strip() else defaults["launch_date"],
            "period_minutes": period,
            "inclination_deg": inclination,
            "apogee_km": apogee,
            "perigee_km": perigee,
            "object_type": object_type.strip() if isinstance(object_type, str) and object_type.strip() else defaults["object_type"],
        }

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
    def _to_int(value: Any) -> int | None:
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str):
            try:
                return int(float(value))
            except ValueError:
                return None
        return None

    @staticmethod
    def _utc_now() -> datetime:
        return datetime.now(tz=timezone.utc)
