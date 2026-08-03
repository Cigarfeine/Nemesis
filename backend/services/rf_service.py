"""
Project Nemesis — RF Anomaly Service
=====================================
Detects potential RF/GNSS anomaly zones from OpenSky flight state vectors and
returns GeoJSON FeatureCollection output.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from services.opensky_service import OpenSkyService

logger = logging.getLogger("nemesis.rf")

# Supersonic-like threshold for commercial aircraft telemetry (m/s ~ 1200 km/h).
SUPSERSONIC_VELOCITY_MPS = 330.0
# Plausible velocity bounds for ADS-B aircraft telemetry (m/s).
VALID_VELOCITY_MIN_MPS = 0.0
VALID_VELOCITY_MAX_MPS = 700.0
# Future historical jump-detection parameters (kept as constants for consistency).
POSITION_JUMP_THRESHOLD_KM = 50.0
POSITION_JUMP_WINDOW_SECONDS = 30
# Grid resolution for anomaly clustering.
GRID_CELL_DEGREES = 1.0
# Padding for fallback bounding-box polygons (degrees).
BBOX_PADDING_DEGREES = 0.5
# Number of anomalous aircraft needed to saturate confidence at 1.0.
CONFIDENCE_SATURATION_COUNT = 5.0
# Service-level cache TTL for anomaly output.
RF_CACHE_TTL_SECONDS = 300


class RFAnomalyPolygonGeometry(BaseModel):
    """GeoJSON Polygon geometry."""

    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[list[float]]]


class RFAnomalyFeatureProperties(BaseModel):
    """Feature properties for one RF anomaly region."""

    region_id: str
    anomaly_count: int = Field(..., ge=1)
    confidence: float = Field(..., ge=0.0, le=1.0)
    flagged_aircraft: list[str] = Field(default_factory=list)
    detection_basis: list[str] = Field(default_factory=list)


class RFAnomalyFeature(BaseModel):
    """GeoJSON Feature for one anomaly cluster/region."""

    type: Literal["Feature"] = "Feature"
    geometry: RFAnomalyPolygonGeometry
    properties: RFAnomalyFeatureProperties


class RFAnomalyFeatureCollection(BaseModel):
    """GeoJSON FeatureCollection returned by the RF anomaly endpoint."""

    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[RFAnomalyFeature] = Field(default_factory=list)


@dataclass(frozen=True)
class NormalizedFlightState:
    """Internal normalized flight state used by anomaly detection."""

    icao24: str
    callsign: str | None
    lon: float
    lat: float
    velocity: float | None
    last_contact: int | None


@dataclass(frozen=True)
class FlightAnomaly:
    """Internal anomaly record for one aircraft."""

    flight: NormalizedFlightState
    reasons: tuple[str, ...]


class RFService:
    """
    Builds RF anomaly zones from live/cached OpenSky states.

    Detection basis:
    - velocity exceeds supersonic threshold
    - velocity is missing or outside plausible telemetry bounds
    """

    def __init__(
        self,
        opensky_service: OpenSkyService,
        cache_ttl_seconds: int = RF_CACHE_TTL_SECONDS,
    ) -> None:
        self._opensky_service = opensky_service
        self._cache_ttl_seconds = cache_ttl_seconds

        self._cache = RFAnomalyFeatureCollection()
        self._last_refresh_utc: datetime | None = None
        self._lock = asyncio.Lock()

        self._last_successful_snapshot: list[dict[str, Any]] = []

    async def get_rf_anomaly_zones(
        self,
        force_refresh: bool = False,
    ) -> RFAnomalyFeatureCollection:
        """
        Returns RF anomaly GeoJSON zones.

        Uses a 5-minute in-memory cache by default.
        """
        if not force_refresh and self._is_cache_fresh():
            return self._cache.model_copy(deep=True)

        async with self._lock:
            if not force_refresh and self._is_cache_fresh():
                return self._cache.model_copy(deep=True)

            await self._refresh_locked()
            return self._cache.model_copy(deep=True)

    @property
    def status(self) -> dict[str, Any]:
        """Operational metadata for health and diagnostics."""
        return {
            "cache_ttl_seconds": self._cache_ttl_seconds,
            "last_refresh_utc": (
                self._last_refresh_utc.isoformat() if self._last_refresh_utc else None
            ),
            "feature_count": len(self._cache.features),
        }

    def _is_cache_fresh(self) -> bool:
        if self._last_refresh_utc is None:
            return False
        age_seconds = (self._utc_now() - self._last_refresh_utc).total_seconds()
        return age_seconds < self._cache_ttl_seconds

    async def _refresh_locked(self) -> None:
        flights = await self._fetch_flights_with_fallback()
        normalized_flights = self._normalize_flights(flights)
        anomalies = self._detect_anomalies(normalized_flights)
        collection = self._build_feature_collection(anomalies)

        self._cache = collection
        self._last_refresh_utc = self._utc_now()

        logger.info(
            "RF anomaly refresh complete: %s flights scanned, %s flagged, %s regions.",
            len(normalized_flights),
            len(anomalies),
            len(collection.features),
        )

    async def _fetch_flights_with_fallback(self) -> list[dict[str, Any]]:
        """
        Attempts a live OpenSky refresh first, then falls back to cached/local snapshots.
        """
        try:
            live_flights = await self._opensky_service.get_flights(force_refresh=True)
            if live_flights:
                self._last_successful_snapshot = [dict(item) for item in live_flights]
                return live_flights
            logger.warning("OpenSky live refresh returned no flights; using fallback.")
        except Exception as exc:
            logger.warning("OpenSky live refresh failed: %s", exc)

        try:
            cached_flights = await self._opensky_service.get_flights(force_refresh=False)
            if cached_flights:
                self._last_successful_snapshot = [dict(item) for item in cached_flights]
                return cached_flights
        except Exception as exc:
            logger.warning("OpenSky cached snapshot read failed: %s", exc)

        if self._last_successful_snapshot:
            logger.warning(
                "Using local RF fallback snapshot (%s flights).",
                len(self._last_successful_snapshot),
            )
            return [dict(item) for item in self._last_successful_snapshot]

        return []

    def _normalize_flights(
        self,
        flights: list[dict[str, Any]],
    ) -> list[NormalizedFlightState]:
        normalized: list[NormalizedFlightState] = []

        for raw in flights:
            if not isinstance(raw, dict):
                continue

            icao24_raw = raw.get("icao24")
            if not isinstance(icao24_raw, str) or not icao24_raw.strip():
                continue
            icao24 = icao24_raw.strip().lower()

            lon = self._to_float(raw.get("lon", raw.get("longitude")))
            lat = self._to_float(raw.get("lat", raw.get("latitude")))
            if lon is None or lat is None:
                continue
            if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
                continue

            callsign = raw.get("callsign")
            callsign_clean = callsign.strip() if isinstance(callsign, str) else None
            if callsign_clean == "":
                callsign_clean = None

            velocity = self._to_float(raw.get("velocity"))
            last_contact = self._to_int(raw.get("last_contact"))

            normalized.append(
                NormalizedFlightState(
                    icao24=icao24,
                    callsign=callsign_clean,
                    lon=lon,
                    lat=lat,
                    velocity=velocity,
                    last_contact=last_contact,
                )
            )

        return normalized

    def _detect_anomalies(
        self,
        flights: list[NormalizedFlightState],
    ) -> list[FlightAnomaly]:
        anomalies: list[FlightAnomaly] = []

        for flight in flights:
            reasons: list[str] = []
            velocity = flight.velocity

            if velocity is not None and velocity > SUPSERSONIC_VELOCITY_MPS:
                reasons.append("velocity_exceeded")

            if velocity is None or not (VALID_VELOCITY_MIN_MPS <= velocity <= VALID_VELOCITY_MAX_MPS):
                reasons.append("corrupt_telemetry")

            # TODO: Add history-based position jump detection:
            # flag aircraft if great-circle position delta > POSITION_JUMP_THRESHOLD_KM
            # within POSITION_JUMP_WINDOW_SECONDS once historical snapshots are persisted.

            if reasons:
                anomalies.append(
                    FlightAnomaly(
                        flight=flight,
                        reasons=tuple(dict.fromkeys(reasons)),
                    )
                )

        return anomalies

    def _build_feature_collection(
        self,
        anomalies: list[FlightAnomaly],
    ) -> RFAnomalyFeatureCollection:
        if not anomalies:
            return RFAnomalyFeatureCollection(features=[])

        clusters: dict[str, list[FlightAnomaly]] = defaultdict(list)

        for anomaly in anomalies:
            lat_bucket = int(round(anomaly.flight.lat / GRID_CELL_DEGREES) * GRID_CELL_DEGREES)
            lon_bucket = int(round(anomaly.flight.lon / GRID_CELL_DEGREES) * GRID_CELL_DEGREES)
            region_id = f"{lat_bucket}_{lon_bucket}"
            clusters[region_id].append(anomaly)

        features: list[RFAnomalyFeature] = []

        for region_id in sorted(clusters.keys()):
            region_anomalies = clusters[region_id]
            points = [(item.flight.lon, item.flight.lat) for item in region_anomalies]
            ring = self._build_polygon_ring(points)

            flagged_aircraft = sorted({item.flight.icao24 for item in region_anomalies})
            detection_basis = [
                reason
                for item in region_anomalies
                for reason in item.reasons
            ]

            anomaly_count = len(region_anomalies)
            confidence = round(min(1.0, anomaly_count / CONFIDENCE_SATURATION_COUNT), 3)

            features.append(
                RFAnomalyFeature(
                    geometry=RFAnomalyPolygonGeometry(coordinates=[ring]),
                    properties=RFAnomalyFeatureProperties(
                        region_id=region_id,
                        anomaly_count=anomaly_count,
                        confidence=confidence,
                        flagged_aircraft=flagged_aircraft,
                        detection_basis=detection_basis,
                    ),
                )
            )

        return RFAnomalyFeatureCollection(features=features)

    def _build_polygon_ring(self, points: list[tuple[float, float]]) -> list[list[float]]:
        distinct_points = sorted(set(points))
        if len(distinct_points) >= 3:
            hull_points = self._convex_hull(distinct_points)
            if len(hull_points) >= 3:
                return self._close_ring(hull_points)

        return self._bbox_ring(distinct_points if distinct_points else [(0.0, 0.0)])

    def _bbox_ring(self, points: list[tuple[float, float]]) -> list[list[float]]:
        lons = [point[0] for point in points]
        lats = [point[1] for point in points]

        min_lon = self._clamp_lon(min(lons) - BBOX_PADDING_DEGREES)
        max_lon = self._clamp_lon(max(lons) + BBOX_PADDING_DEGREES)
        min_lat = self._clamp_lat(min(lats) - BBOX_PADDING_DEGREES)
        max_lat = self._clamp_lat(max(lats) + BBOX_PADDING_DEGREES)

        bbox_points = [
            (min_lon, min_lat),
            (max_lon, min_lat),
            (max_lon, max_lat),
            (min_lon, max_lat),
        ]
        return self._close_ring(bbox_points)

    def _convex_hull(self, points: list[tuple[float, float]]) -> list[tuple[float, float]]:
        if len(points) <= 1:
            return points

        sorted_points = sorted(set(points))

        lower: list[tuple[float, float]] = []
        for point in sorted_points:
            while len(lower) >= 2 and self._cross(lower[-2], lower[-1], point) <= 0:
                lower.pop()
            lower.append(point)

        upper: list[tuple[float, float]] = []
        for point in reversed(sorted_points):
            while len(upper) >= 2 and self._cross(upper[-2], upper[-1], point) <= 0:
                upper.pop()
            upper.append(point)

        return lower[:-1] + upper[:-1]

    @staticmethod
    def _close_ring(points: list[tuple[float, float]]) -> list[list[float]]:
        if not points:
            return []

        ring = list(points)
        if ring[0] != ring[-1]:
            ring.append(ring[0])

        return [[round(point[0], 6), round(point[1], 6)] for point in ring]

    @staticmethod
    def _cross(
        origin: tuple[float, float],
        point_a: tuple[float, float],
        point_b: tuple[float, float],
    ) -> float:
        return (
            (point_a[0] - origin[0]) * (point_b[1] - origin[1])
            - (point_a[1] - origin[1]) * (point_b[0] - origin[0])
        )

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
    def _clamp_lat(value: float) -> float:
        return max(-90.0, min(90.0, value))

    @staticmethod
    def _clamp_lon(value: float) -> float:
        return max(-180.0, min(180.0, value))

    @staticmethod
    def _utc_now() -> datetime:
        return datetime.now(tz=timezone.utc)
