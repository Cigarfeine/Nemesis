"""
Scenario recorder and playback service using SQLite.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DB_RELATIVE_PATH = "data/nemesis.db"
RETENTION_DAYS = 7


class ScenarioService:
    """Records and replays Nemesis telemetry snapshots."""

    def __init__(self, base_dir: str | Path) -> None:
        base_path = Path(base_dir)
        self._db_path = base_path / DB_RELATIVE_PATH
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS snapshots (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  timestamp TEXT NOT NULL,
                  data_type TEXT NOT NULL,
                  payload TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS scenarios (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT,
                  start_time TEXT,
                  end_time TEXT,
                  description TEXT
                )
                """
            )
            conn.commit()

    async def initialize(self) -> None:
        """Runs startup maintenance tasks (retention purge)."""
        await asyncio.to_thread(self._purge_old_snapshots)

    async def record_snapshot(self, data_type: str, payload: dict[str, Any]) -> None:
        """Stores one snapshot payload asynchronously."""
        await asyncio.to_thread(self._insert_snapshot, data_type, payload)

    def list_scenarios(self) -> list[dict[str, Any]]:
        """Returns saved scenario metadata."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, start_time, end_time, description FROM scenarios ORDER BY id DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    def get_snapshot_range(self, start: str, end: str, data_type: str) -> list[dict[str, Any]]:
        """Returns snapshots in a time interval for one data type."""
        query = (
            "SELECT timestamp, data_type, payload "
            "FROM snapshots "
            "WHERE timestamp >= ? AND timestamp <= ? AND data_type = ? "
            "ORDER BY timestamp ASC"
        )
        with self._connect() as conn:
            rows = conn.execute(query, (start, end, data_type)).fetchall()

        result: list[dict[str, Any]] = []
        for row in rows:
            payload = self._loads_json(row["payload"])
            result.append(
                {
                    "timestamp": row["timestamp"],
                    "data_type": row["data_type"],
                    "payload": payload,
                }
            )
        return result

    def export_czml(self, start: str, end: str) -> str:
        """Exports satellite snapshots in CZML format for Cesium playback."""
        snapshots = self.get_snapshot_range(start=start, end=end, data_type="satellites")

        packets: list[dict[str, Any]] = [
            {
                "id": "document",
                "name": "Project Nemesis Scenario Export",
                "version": "1.0",
            }
        ]

        tracks: dict[str, list[tuple[str, float, float, float]]] = {}
        for snapshot in snapshots:
            ts = snapshot["timestamp"]
            payload = snapshot.get("payload")
            satellites = []
            if isinstance(payload, dict):
                satellites = payload.get("satellites", []) or []
            if not isinstance(satellites, list):
                continue

            for sat in satellites:
                if not isinstance(sat, dict):
                    continue
                sat_id = sat.get("id")
                lat = self._to_float(sat.get("lat"))
                lon = self._to_float(sat.get("lon"))
                alt_km = self._to_float(sat.get("alt_km"))
                if sat_id is None or lat is None or lon is None:
                    continue
                alt_m = (alt_km or 0.0) * 1000.0
                key = str(sat_id)
                tracks.setdefault(key, []).append((ts, lon, lat, alt_m))

        for sat_id, points in tracks.items():
            if not points:
                continue
            epoch = points[0][0]
            cartographic_degrees: list[float] = []
            for ts, lon, lat, alt_m in points:
                seconds = self._seconds_from_iso(epoch, ts)
                cartographic_degrees.extend([seconds, lon, lat, alt_m])

            packets.append(
                {
                    "id": f"sat-{sat_id}",
                    "availability": f"{start}/{end}",
                    "position": {
                        "epoch": epoch,
                        "cartographicDegrees": cartographic_degrees,
                    },
                    "path": {
                        "show": True,
                        "width": 2,
                        "leadTime": 0,
                        "trailTime": max(0, int(self._seconds_from_iso(start, end))),
                    },
                }
            )

        return json.dumps(packets)

    @property
    def status(self) -> dict[str, Any]:
        with self._connect() as conn:
            count = conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
        return {
            "db_path": str(self._db_path),
            "snapshot_count": count,
            "retention_days": RETENTION_DAYS,
        }

    def _insert_snapshot(self, data_type: str, payload: dict[str, Any]) -> None:
        timestamp = datetime.now(tz=timezone.utc).isoformat()
        payload_json = json.dumps(payload)
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO snapshots (timestamp, data_type, payload) VALUES (?, ?, ?)",
                (timestamp, data_type, payload_json),
            )
            conn.commit()

    def _purge_old_snapshots(self) -> None:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(days=RETENTION_DAYS)
        cutoff_iso = cutoff.isoformat()
        with self._connect() as conn:
            conn.execute("DELETE FROM snapshots WHERE timestamp < ?", (cutoff_iso,))
            conn.commit()
        logger.info("ScenarioService retention purge complete (cutoff=%s)", cutoff_iso)

    @staticmethod
    def _loads_json(text: str) -> dict[str, Any]:
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
            return {"data": parsed}
        except Exception:
            return {"raw": text}

    @staticmethod
    def _to_float(value: Any) -> float | None:
        if isinstance(value, (int, float)):
            return float(value)
        return None

    @staticmethod
    def _seconds_from_iso(epoch_iso: str, target_iso: str) -> float:
        try:
            epoch = datetime.fromisoformat(epoch_iso)
            target = datetime.fromisoformat(target_iso)
            return (target - epoch).total_seconds()
        except Exception:
            return 0.0
