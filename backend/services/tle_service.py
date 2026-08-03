"""
Project Nemesis — TLE Service
================================
Handles all satellite tracking logic:
  1. Fetches Two-Line Element (TLE) sets from CelesTrak's live API
  2. Parses them into Skyfield EarthSatellite objects
  3. Computes real-time geodetic positions (lat, lon, altitude)
  4. Provides a refresh loop to keep TLE data fresh (TLEs decay ~days)

CelesTrak endpoint docs: https://celestrak.org/SPACETRACK/documentation.php
Skyfield docs:           https://rhodesmill.org/skyfield/
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from skyfield.api import EarthSatellite, load, wgs84

logger = logging.getLogger("nemesis.tle")

# ---------------------------------------------------------------------------
# CelesTrak catalog groups to fetch.
# "visual" = ~100 brightest naked-eye satellites (great for demo density)
# "stations" = ISS, Tiangong, etc.
# "active" = all ~5000+ active — works but is heavier on first load
# ---------------------------------------------------------------------------
CELESTRAK_BASE = "https://celestrak.org/NORAD/elements/gp.php"
TLE_GROUPS = {
    "visual":   f"{CELESTRAK_BASE}?GROUP=visual&FORMAT=tle",
    "stations": f"{CELESTRAK_BASE}?GROUP=stations&FORMAT=tle",
    "gnss":     f"{CELESTRAK_BASE}?GROUP=gnss&FORMAT=tle",
}

# Colour-code satellites by type for the frontend renderer
GROUP_COLORS = {
    "visual":   "#00f5ff",   # Neon cyan  — general objects
    "stations": "#ffb300",   # Amber      — crewed platforms
    "gnss":     "#7cff7c",   # Lime       — navigation constellation
}


class TLEService:
    """
    Manages a live, in-memory catalogue of Earth satellites.

    Lifecycle:
        await service.initialize()          # call once at startup
        asyncio.create_task(service.start_refresh_loop())
        positions = service.compute_positions()   # call any time
    """

    def __init__(self) -> None:
        # Skyfield timescale — load once, reuse forever
        self.ts = load.timescale()

        # Dict keyed by NORAD catalog number (int):
        #   { norad_id: { "satellite": EarthSatellite, "name": str,
        #                 "group": str, "color": str } }
        self.catalogue: dict[int, dict] = {}

        self._lock = asyncio.Lock()
        self._last_refresh: Optional[datetime] = None
        self._post_refresh_hooks: list[
            Callable[[dict[int, dict]], Any | Awaitable[Any]]
        ] = []
        self._position_cache: list[dict[str, Any]] = []
        self._cache_time: float = 0.0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def initialize(self) -> None:
        """Blocking initial load — awaited once during FastAPI lifespan."""
        logger.info("Initialising TLE catalogue from CelesTrak…")
        await self._fetch_all_groups()
        self._last_refresh = datetime.now(tz=timezone.utc)
        self._position_cache = []
        self._cache_time = 0.0
        await self._run_post_refresh_hooks()
        logger.info(f"Catalogue ready — {len(self.catalogue)} satellites tracked.")

    async def start_refresh_loop(self, interval_seconds: int = 3600) -> None:
        """
        Background coroutine: re-fetches TLEs every `interval_seconds`.
        TLEs become stale over days; hourly refresh is plenty for a demo.
        """
        while True:
            await asyncio.sleep(interval_seconds)
            logger.info("Refreshing TLE catalogue…")
            await self._fetch_all_groups()
            self._last_refresh = datetime.now(tz=timezone.utc)
            self._position_cache = []
            self._cache_time = 0.0
            await self._run_post_refresh_hooks()
            logger.info(f"Catalogue refreshed — {len(self.catalogue)} satellites.")

    def compute_positions(self) -> list[dict]:
        """
        Propagate all satellites to *right now* using SGP4 orbital mechanics
        (baked into Skyfield's EarthSatellite.at()).

        Returns a JSON-serialisable list of dicts ready to push over WebSocket.
        """
        import time

        now_ts = time.time()
        # Return cached result if fresh enough (< 1 second old)
        if self._position_cache and (now_ts - self._cache_time) < 1.0:
            return self._position_cache

        t = self.ts.now()
        positions: list[dict] = []

        for norad_id, entry in self.catalogue.items():
            try:
                sat: EarthSatellite = entry["satellite"]

                # SGP4 propagation → geocentric position vector
                geocentric = sat.at(t)

                # Convert to geodetic (lat/lon/elevation above WGS-84 ellipsoid)
                subpoint = wgs84.subpoint(geocentric)

                positions.append({
                    "id":      norad_id,
                    "name":    entry["name"],
                    "group":   entry["group"],
                    "color":   entry["color"],
                    "lat":     round(subpoint.latitude.degrees, 4),
                    "lon":     round(subpoint.longitude.degrees, 4),
                    "alt_km":  round(subpoint.elevation.km, 2),
                    # Days since TLE epoch — used by frontend freshness badge
                    "epoch_age_days": round(t.tt - sat.epoch.tt, 2),
                })

            except Exception as exc:
                # Individual satellite failures are non-fatal
                logger.debug(f"SGP4 error for NORAD {norad_id}: {exc}")

        self._position_cache = positions
        self._cache_time = now_ts
        return positions

    @property
    def status(self) -> dict:
        return {
            "satellites_tracked": len(self.catalogue),
            "last_refresh_utc": (
                self._last_refresh.isoformat() if self._last_refresh else None
            ),
        }

    def register_post_refresh_hook(
        self,
        hook: Callable[[dict[int, dict]], Any | Awaitable[Any]],
    ) -> None:
        """Registers a callback invoked after each successful catalogue refresh."""
        self._post_refresh_hooks.append(hook)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _fetch_all_groups(self) -> None:
        """Fetch TLEs from all CelesTrak groups concurrently."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            tasks = [
                self._fetch_group(client, group, url)
                for group, url in TLE_GROUPS.items()
            ]
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _fetch_group(
        self, client: httpx.AsyncClient, group: str, url: str
    ) -> None:
        """Fetch one CelesTrak TLE group and merge into the catalogue."""
        try:
            response = await client.get(url)
            response.raise_for_status()
            parsed = self._parse_tle_text(response.text, group)

            async with self._lock:
                self.catalogue.update(parsed)

            logger.info(f"  [{group}] Loaded {len(parsed)} satellites.")

        except httpx.HTTPError as exc:
            logger.warning(f"  [{group}] HTTP error fetching TLEs: {exc}")
        except Exception as exc:
            logger.warning(f"  [{group}] Unexpected error: {exc}")

    async def _run_post_refresh_hooks(self) -> None:
        if not self._post_refresh_hooks:
            return

        for hook in self._post_refresh_hooks:
            try:
                result = hook(self.catalogue)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as exc:
                logger.warning("Post-refresh hook failed: %s", exc)

    def _parse_tle_text(self, raw: str, group: str) -> dict[int, dict]:
        """
        Parse a raw TLE text block.

        Format (3-line TLE):
            LINE 0 (name): ISS (ZARYA)
            LINE 1:        1 25544U 98067A   24156.50000000  .00020000 ...
            LINE 2:        2 25544  51.6400 ...

        Returns dict keyed by NORAD catalog ID.
        """
        result: dict[int, dict] = {}
        lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
        color = GROUP_COLORS.get(group, "#ffffff")

        i = 0
        while i < len(lines) - 2:
            name  = lines[i]
            line1 = lines[i + 1]
            line2 = lines[i + 2]

            # Validate TLE structure by checking line designators
            if line1.startswith("1 ") and line2.startswith("2 "):
                try:
                    sat = EarthSatellite(line1, line2, name, self.ts)
                    norad_id = int(line1[2:7].strip())
                    result[norad_id] = {
                        "satellite": sat,
                        "name":      name.strip(),
                        "group":     group,
                        "color":     color,
                    }
                    i += 3
                    continue
                except Exception as exc:
                    logger.debug(f"Parse error for '{name}': {exc}")

            i += 1  # Skip malformed line and try again

        return result
