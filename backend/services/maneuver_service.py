"""
Orbital maneuver detection service based on TLE element deltas.
"""

from __future__ import annotations

import threading
from collections import deque
from datetime import datetime, timezone
from math import pi
from typing import Any

MEAN_MOTION_THRESHOLD_REV_PER_DAY = 0.0001
ECCENTRICITY_THRESHOLD = 0.0005
INCLINATION_THRESHOLD_DEG = 0.01

MAX_HISTORY_POINTS = 10
MAX_MANEUVERS = 50


class ManeuverService:
    """Tracks TLE history and detects likely orbital maneuvers."""

    def __init__(self) -> None:
        self._history: dict[int, deque[dict[str, float]]] = {}
        self._maneuvers: deque[dict[str, Any]] = deque(maxlen=MAX_MANEUVERS)
        self._lock = threading.Lock()

    def record_snapshot(self, catalogue: dict[int, dict]) -> list[dict[str, Any]]:
        """
        Stores current TLE state for satellites and detects maneuvers.

        Returns a list of newly detected maneuvers.
        """
        detected: list[dict[str, Any]] = []

        with self._lock:
            for norad_id, entry in catalogue.items():
                sat = entry.get("satellite")
                if sat is None:
                    continue

                snapshot = self._extract_snapshot(sat)
                if snapshot is None:
                    continue

                history = self._history.setdefault(
                    norad_id,
                    deque(maxlen=MAX_HISTORY_POINTS),
                )

                previous = history[-1] if history else None
                if previous is not None:
                    if abs(snapshot["epoch"] - previous["epoch"]) < 1e-12:
                        continue

                    maneuver = self._detect_maneuver(
                        norad_id=norad_id,
                        name=entry.get("name", f"SAT-{norad_id}"),
                        previous=previous,
                        current=snapshot,
                    )
                    if maneuver is not None:
                        self._maneuvers.append(maneuver)
                        detected.append(maneuver)

                history.append(snapshot)

        return detected

    def get_recent_maneuvers(self, limit: int = 20) -> list[dict[str, Any]]:
        """Returns newest detected maneuvers first."""
        with self._lock:
            return list(reversed(list(self._maneuvers)[-limit:]))

    def get_satellite_history(self, norad_id: int) -> list[dict[str, Any]]:
        """Returns stored orbital-element history for one satellite."""
        with self._lock:
            history = self._history.get(norad_id)
            return list(history) if history else []

    @property
    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "tracked_histories": len(self._history),
                "recent_maneuvers": len(self._maneuvers),
                "history_depth": MAX_HISTORY_POINTS,
            }

    def _extract_snapshot(self, sat: Any) -> dict[str, float] | None:
        try:
            model = sat.model
            mean_motion_rad_min = float(model.no_kozai)
            mean_motion_rev_day = mean_motion_rad_min * 1440.0 / (2.0 * pi)
            eccentricity = float(model.ecco)
            inclination_deg = float(model.inclo) * 180.0 / pi
            epoch = float(sat.epoch.tt)
        except Exception:
            return None

        return {
            "epoch": epoch,
            "mean_motion": mean_motion_rev_day,
            "eccentricity": eccentricity,
            "inclination": inclination_deg,
        }

    def _detect_maneuver(
        self,
        norad_id: int,
        name: str,
        previous: dict[str, float],
        current: dict[str, float],
    ) -> dict[str, Any] | None:
        delta_mean_motion = current["mean_motion"] - previous["mean_motion"]
        delta_eccentricity = current["eccentricity"] - previous["eccentricity"]
        delta_inclination = current["inclination"] - previous["inclination"]

        mean_motion_trigger = abs(delta_mean_motion) > MEAN_MOTION_THRESHOLD_REV_PER_DAY
        eccentricity_trigger = abs(delta_eccentricity) > ECCENTRICITY_THRESHOLD
        inclination_trigger = abs(delta_inclination) > INCLINATION_THRESHOLD_DEG

        if not (mean_motion_trigger or eccentricity_trigger or inclination_trigger):
            return None

        maneuver_type = "UNKNOWN"
        if inclination_trigger:
            maneuver_type = "PLANE_CHANGE"
        elif mean_motion_trigger:
            maneuver_type = "ORBIT_LOWER" if delta_mean_motion > 0 else "ORBIT_RAISE"
        elif eccentricity_trigger:
            maneuver_type = "UNKNOWN"

        confidence = self._compute_confidence(
            delta_mean_motion=delta_mean_motion,
            delta_eccentricity=delta_eccentricity,
            delta_inclination=delta_inclination,
        )

        return {
            "norad_id": norad_id,
            "name": name,
            "detected_at": datetime.now(tz=timezone.utc).isoformat(),
            "type": maneuver_type,
            "delta_mean_motion": round(delta_mean_motion, 8),
            "delta_eccentricity": round(delta_eccentricity, 8),
            "delta_inclination": round(delta_inclination, 6),
            "confidence": confidence,
        }

    @staticmethod
    def _compute_confidence(
        delta_mean_motion: float,
        delta_eccentricity: float,
        delta_inclination: float,
    ) -> float:
        score = 0.0
        score += abs(delta_mean_motion) / (2.0 * MEAN_MOTION_THRESHOLD_REV_PER_DAY)
        score += abs(delta_eccentricity) / (2.0 * ECCENTRICITY_THRESHOLD)
        score += abs(delta_inclination) / (2.0 * INCLINATION_THRESHOLD_DEG)
        return round(max(0.0, min(1.0, score / 3.0)), 3)
