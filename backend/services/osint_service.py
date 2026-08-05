"""
Project Nemesis — OSINT Service
=================================
Fetches recent news articles from RSS feeds and builds an entity relationship graph
using spaCy NER with cached GPE geocoding enrichment.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import re
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from itertools import combinations
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)

RSS_FEEDS = [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://www.theguardian.com/world/rss",
    "https://feeds.npr.org/1001/rss.xml",
    "https://feeds.abcnews.com/abcnews/topstories",
    "https://www.aljazeera.com/xml/rss/all.xml",
    "https://rss.dw.com/xml/rss-en-all",
    "https://www.france24.com/en/rss",
    "https://feeds.skynews.com/feeds/rss/world.xml",
]
DEFAULT_QUERY = "rss:bbc,reuters,aljazeera"
TARGET_ENTITY_TYPES = {"PERSON", "ORG", "GPE", "EVENT"}
NON_GPE_ENTITY_TYPES = {"PERSON", "ORG", "EVENT"}

GEOCODER_USER_AGENT = "nemesis_osint_v1"
GEOCODER_TIMEOUT_SECONDS = 5
GEOCODE_REQUEST_INTERVAL_SECONDS = 1.0
EMERGING_EVENT_MIN_ARTICLES = 3
EMERGING_EVENT_WINDOW_MINUTES = 60
EMERGING_EVENT_HEADLINES_MAX = 5
EMERGING_EVENT_COOLDOWN_MINUTES = 30
EMERGING_EVENT_QUEUE_MAX = 100

_GEO_HUBS_PATH = Path(__file__).parent / "geo_hubs.json"
if _GEO_HUBS_PATH.exists():
    try:
        GEO_HUBS = json.loads(_GEO_HUBS_PATH.read_text())
    except Exception as exc:
        logger.warning("Failed to load geo hubs from %s: %s", _GEO_HUBS_PATH, exc)
        GEO_HUBS = []
else:
    GEO_HUBS = []

GEO_HUB_INDEX: dict[str, dict[str, Any]] = {}
for hub in GEO_HUBS:
    if not isinstance(hub, dict):
        continue
    name_lower = str(hub.get("name", "")).strip().lower()
    country_lower = str(hub.get("country", "")).strip().lower()
    if name_lower:
        GEO_HUB_INDEX[name_lower] = hub
    if country_lower:
        GEO_HUB_INDEX[country_lower] = hub


def resolve_location_from_hubs(text: str) -> dict[str, Any] | None:
    """Match text against geo hub names/countries. Returns hub dict or None."""
    text_lower = text.lower()
    # Try exact match first
    for key, hub in GEO_HUB_INDEX.items():
        if key in text_lower:
            return hub
    return None


_geo_cache: dict[str, tuple[float, float] | None] = {}
_geo_cache_lock = asyncio.Lock()
# TODO: Move geocode cache to Redis for multi-instance shared caching in production.

GeocodeSource = Literal["cache", "geo_hubs", "nominatim", "failed"]


class NonGPENode(BaseModel):
    """Knowledge graph node for non-location entities."""

    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    type: Literal["PERSON", "ORG", "EVENT"]
    count: int


class GPENode(BaseModel):
    """Knowledge graph node for location entities enriched with coordinates."""

    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    type: Literal["GPE"]
    lat: float | None
    lon: float | None
    geocode_source: GeocodeSource


class OSINTService:
    """Fetches articles and transforms NER co-occurrences into a knowledge graph."""

    def __init__(
        self,
        api_url: str = "",
        query: str = DEFAULT_QUERY,
        max_records: int = 50,
        timeout_seconds: float = 15.0,
        cache_ttl_seconds: int = 900,
        min_cooccurrence_weight: int = 2,
        max_nodes: int = 80,
        max_links: int = 200,
        model_name: str = "en_core_web_sm",
    ) -> None:
        self._api_url = api_url
        self._query = query
        self._max_records = max_records
        self._timeout_seconds = timeout_seconds
        self._cache_ttl_seconds = cache_ttl_seconds
        self._min_cooccurrence_weight = min_cooccurrence_weight
        self._max_nodes = max_nodes
        self._max_links = max_links
        self._model_name = model_name

        self._cache: dict[str, Any] = {
            "query": self._query,
            "generated_at_utc": None,
            "nodes": [],
            "links": [],
        }
        self._last_refresh_utc: datetime | None = None
        self._lock = asyncio.Lock()

        self._nlp = None
        self._model_error: str | None = None
        self._initialize_nlp()

        self._geocoder = self._initialize_geocoder()
        self._emerging_events: deque[dict[str, Any]] = deque(maxlen=EMERGING_EVENT_QUEUE_MAX)
        self._emerging_event_last_emit: dict[str, datetime] = {}

    async def get_knowledge_graph(self, force_refresh: bool = False) -> dict[str, Any]:
        """
        Returns the cached knowledge graph.
        Refreshes from GDELT when stale or when `force_refresh=True`.
        """
        self._ensure_model_ready()

        if not force_refresh and self._is_cache_fresh():
            return copy.deepcopy(self._cache)

        async with self._lock:
            if not force_refresh and self._is_cache_fresh():
                return copy.deepcopy(self._cache)

            await self._refresh_locked()
            return copy.deepcopy(self._cache)

    @property
    def status(self) -> dict[str, Any]:
        """Operational metadata exposed to API responses."""
        return {
            "query": self._query,
            "max_records": self._max_records,
            "last_refresh_utc": (
                self._last_refresh_utc.isoformat() if self._last_refresh_utc else None
            ),
            "cache_ttl_seconds": self._cache_ttl_seconds,
            "model_ready": self._nlp is not None,
            "model_error": self._model_error,
            "geocoder_ready": self._geocoder is not None,
            "geocode_cache_entries": len(_geo_cache),
            "pending_emerging_events": len(self._emerging_events),
        }

    def consume_emerging_events(self) -> list[dict[str, Any]]:
        """Returns and clears pending EMERGING_EVENT notifications."""
        events = list(self._emerging_events)
        self._emerging_events.clear()
        return events

    def _initialize_nlp(self) -> None:
        try:
            self._nlp = self._load_spacy_model(self._model_name)
            logger.info("spaCy model loaded: %s", self._model_name)
        except Exception as exc:
            self._nlp = None
            self._model_error = str(exc)
            logger.error("OSINT service disabled: %s", exc)

    @staticmethod
    def _load_spacy_model(model_name: str):
        try:
            import spacy
        except ImportError as exc:
            raise RuntimeError(
                "spaCy is not installed. Install `spacy` and `en_core_web_sm`."
            ) from exc

        try:
            return spacy.load(model_name)
        except OSError as exc:
            raise RuntimeError(
                "spaCy model `en_core_web_sm` is missing. "
                "Run: python -m spacy download en_core_web_sm"
            ) from exc

    @staticmethod
    def _initialize_geocoder() -> Any | None:
        try:
            from geopy.geocoders import Nominatim
        except ImportError:
            logger.warning("geopy not installed; GPE geocoding disabled.")
            return None

        try:
            return Nominatim(user_agent=GEOCODER_USER_AGENT)
        except Exception as exc:
            logger.warning("Unable to initialize Nominatim geocoder: %s", exc)
            logger.debug("Geocoder initialization traceback", exc_info=True)
            return None

    def _ensure_model_ready(self) -> None:
        if self._nlp is None:
            raise RuntimeError(self._model_error or "spaCy model not available.")

    def _is_cache_fresh(self) -> bool:
        if self._last_refresh_utc is None:
            return False

        age_seconds = (self._utc_now() - self._last_refresh_utc).total_seconds()
        return age_seconds < self._cache_ttl_seconds

    async def _refresh_locked(self) -> None:
        try:
            articles = await self._fetch_articles()
            graph = await self._build_graph(articles)
            self._cache = graph
            self._last_refresh_utc = self._utc_now()
            logger.info(
                "OSINT graph refresh complete — %s nodes, %s links.",
                len(graph.get("nodes", [])),
                len(graph.get("links", [])),
            )
        except httpx.HTTPError as exc:
            logger.warning("RSS HTTP error: %s", exc)
        except Exception as exc:
            logger.warning("OSINT refresh failed: %s", exc)

    async def _fetch_articles(self) -> list[dict[str, Any]]:
        articles = await self._fetch_rss_articles()
        return articles[: self._max_records]

    async def _fetch_rss_articles(self) -> list[dict[str, Any]]:
        import xml.etree.ElementTree as ET

        articles: list[dict[str, Any]] = []
        ns = {"atom": "http://www.w3.org/2005/Atom"}

        async with httpx.AsyncClient(timeout=15.0) as client:
            for url in RSS_FEEDS:
                try:
                    resp = await client.get(url, follow_redirects=True)
                    resp.raise_for_status()
                    root = ET.fromstring(resp.text)
                    items = root.findall(".//item") or root.findall(".//atom:entry", ns)
                    feed_items = items[:15]

                    for item in feed_items:
                        title_node = item.find("title")
                        if title_node is None:
                            title_node = item.find("atom:title", ns)

                        desc_node = item.find("description")
                        if desc_node is None:
                            desc_node = item.find("atom:summary", ns)

                        link_node = item.find("link")
                        if link_node is None:
                            link_node = item.find("atom:link", ns)

                        title = (getattr(title_node, "text", "") or "").strip()
                        desc = (getattr(desc_node, "text", "") or "").strip()[:300]
                        link = (getattr(link_node, "text", "") or "").strip()
                        if not link and link_node is not None:
                            link = str(getattr(link_node, "attrib", {}).get("href", "")).strip()

                        if title:
                            articles.append(
                                {
                                    "title": title,
                                    "description": desc,
                                    "url": link,
                                    "source": url.split("/")[2],
                                }
                            )

                    logger.info("RSS: fetched %s articles from %s", len(feed_items), url)
                except Exception as exc:
                    logger.warning("RSS fetch failed for %s: %s", url, exc)

        return articles

    async def _build_graph(self, articles: list[dict[str, Any]]) -> dict[str, Any]:
        node_counts: dict[str, int] = defaultdict(int)
        node_labels: dict[str, str] = {}
        node_types: dict[str, str] = {}

        edge_weights: dict[tuple[str, str], int] = defaultdict(int)
        edge_articles: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
        edge_article_keys: dict[tuple[str, str], set[tuple[str, str]]] = defaultdict(set)

        gpe_article_hits: dict[str, list[dict[str, Any]]] = defaultdict(list)
        now_utc = self._utc_now()

        for article in articles:
            title = self._to_text(article.get("title"))
            url = self._to_text(article.get("url"))
            snippet = self._extract_snippet(article)
            article_ts = self._extract_article_datetime(article, fallback=now_utc)
            text = f"{title}. {snippet}".strip() if title and snippet else (title or snippet)
            if not text:
                continue

            doc = await asyncio.to_thread(self._nlp, text)
            article_entities: dict[str, tuple[str, str]] = {}

            for ent in doc.ents:
                entity_type = ent.label_.upper()
                if entity_type not in TARGET_ENTITY_TYPES:
                    continue

                cleaned_label = self._normalize_label(ent.text)
                if not cleaned_label:
                    continue

                node_key = f"{entity_type}|{cleaned_label.casefold()}"
                article_entities[node_key] = (cleaned_label, entity_type)

            for node_key, (_label, entity_type) in article_entities.items():
                if entity_type != "GPE":
                    continue
                gpe_article_hits[node_key].append(
                    {
                        "title": title or "(untitled)",
                        "url": url,
                        "timestamp": article_ts,
                    }
                )

            if not article_entities:
                continue

            for node_key, (label, entity_type) in article_entities.items():
                node_counts[node_key] += 1
                node_labels.setdefault(node_key, label)
                node_types.setdefault(node_key, entity_type)

            if len(article_entities) < 2:
                continue

            article_ref = {
                "title": title or "(untitled)",
                "url": url,
            }
            article_ref_key = (article_ref["title"], article_ref["url"])
            keys = sorted(article_entities.keys())

            for source_key, target_key in combinations(keys, 2):
                edge_key = (source_key, target_key)
                edge_weights[edge_key] += 1
                if article_ref_key not in edge_article_keys[edge_key]:
                    edge_article_keys[edge_key].add(article_ref_key)
                    edge_articles[edge_key].append(article_ref)

        ranked_node_keys = sorted(
            node_counts.keys(),
            key=lambda key: (-node_counts[key], node_types[key], node_labels[key]),
        )[: self._max_nodes]
        selected_node_keys = set(ranked_node_keys)

        gpe_coordinates = await self._batch_geocode_gpe_nodes(
            ranked_node_keys,
            node_labels,
            node_types,
        )

        node_ids = {
            key: self._build_node_id(node_labels[key], node_types[key])
            for key in ranked_node_keys
        }

        nodes: list[dict[str, Any]] = []
        for key in ranked_node_keys:
            entity_type = node_types[key]
            if entity_type == "GPE":
                coords, source = gpe_coordinates.get(key, (None, "failed"))
                node_obj = GPENode(
                    id=node_ids[key],
                    label=node_labels[key],
                    type="GPE",
                    lat=round(coords[0], 6) if coords else None,
                    lon=round(coords[1], 6) if coords else None,
                    geocode_source=source,
                )
            else:
                if entity_type not in NON_GPE_ENTITY_TYPES:
                    continue
                node_obj = NonGPENode(
                    id=node_ids[key],
                    label=node_labels[key],
                    type=entity_type,
                    count=node_counts[key],
                )

            nodes.append(node_obj.model_dump(mode="json"))

        ranked_edges = sorted(
            (
                (edge_key, weight)
                for edge_key, weight in edge_weights.items()
                if weight >= self._min_cooccurrence_weight
                and edge_key[0] in selected_node_keys
                and edge_key[1] in selected_node_keys
            ),
            key=lambda item: (-item[1], item[0][0], item[0][1]),
        )[: self._max_links]

        links = [
            {
                "source": node_ids[edge_key[0]],
                "target": node_ids[edge_key[1]],
                "weight": weight,
                "articles": edge_articles[edge_key][:5],
            }
            for edge_key, weight in ranked_edges
        ]

        await self._detect_emerging_events(
            gpe_article_hits=gpe_article_hits,
            node_labels=node_labels,
            now_utc=now_utc,
        )

        return {
            "query": self._query,
            "generated_at_utc": self._utc_now().isoformat(),
            "nodes": nodes,
            "links": links,
        }

    async def _detect_emerging_events(
        self,
        gpe_article_hits: dict[str, list[dict[str, Any]]],
        node_labels: dict[str, str],
        now_utc: datetime,
    ) -> None:
        window_start = now_utc - timedelta(minutes=EMERGING_EVENT_WINDOW_MINUTES)

        for node_key, hits in gpe_article_hits.items():
            recent_hits = [
                hit
                for hit in hits
                if isinstance(hit.get("timestamp"), datetime)
                and hit["timestamp"] >= window_start
            ]
            if len(recent_hits) < EMERGING_EVENT_MIN_ARTICLES:
                continue

            label = node_labels.get(node_key)
            if not label:
                continue

            coords, _source = await self._geocode_entity_label(label)
            if not coords:
                continue

            signature = label.casefold().strip()
            last_emit = self._emerging_event_last_emit.get(signature)
            if last_emit and (now_utc - last_emit) < timedelta(minutes=EMERGING_EVENT_COOLDOWN_MINUTES):
                continue

            headlines = []
            for hit in recent_hits[:EMERGING_EVENT_HEADLINES_MAX]:
                title = hit.get("title")
                if isinstance(title, str) and title:
                    headlines.append(title)

            event = {
                "type": "EMERGING_EVENT",
                "location": label,
                "lat": round(coords[0], 6),
                "lon": round(coords[1], 6),
                "article_count": len(recent_hits),
                "headlines": headlines,
                "confidence": round(min(1.0, len(recent_hits) / 6.0), 3),
                "timestamp": now_utc.isoformat(),
            }
            self._emerging_events.append(event)
            self._emerging_event_last_emit[signature] = now_utc

    async def _batch_geocode_gpe_nodes(
        self,
        ranked_node_keys: list[str],
        node_labels: dict[str, str],
        node_types: dict[str, str],
    ) -> dict[str, tuple[tuple[float, float] | None, GeocodeSource]]:
        results: dict[str, tuple[tuple[float, float] | None, GeocodeSource]] = {}
        pending: list[tuple[str, str, str]] = []

        async with _geo_cache_lock:
            for node_key in ranked_node_keys:
                if node_types.get(node_key) != "GPE":
                    continue

                label = node_labels[node_key]
                cache_key = self._cache_key(label)
                if cache_key in _geo_cache:
                    cached_coords = _geo_cache[cache_key]
                    if cached_coords is None:
                        results[node_key] = (None, "failed")
                    else:
                        results[node_key] = (cached_coords, "cache")
                else:
                    pending.append((node_key, label, cache_key))

        nominatim_attempts = 0
        for node_key, label, cache_key in pending:
            hub_match = resolve_location_from_hubs(label)
            if hub_match:
                coords = self._coords_from_hub(hub_match)
                if coords is not None:
                    async with _geo_cache_lock:
                        _geo_cache[cache_key] = coords
                    results[node_key] = (coords, "geo_hubs")
                    continue

            if nominatim_attempts > 0:
                await asyncio.sleep(GEOCODE_REQUEST_INTERVAL_SECONDS)

            coords, source = await self._geocode_with_nominatim(label)
            nominatim_attempts += 1

            async with _geo_cache_lock:
                _geo_cache[cache_key] = coords

            results[node_key] = (coords, source)

        return results

    async def _geocode_with_nominatim(
        self,
        location_name: str,
    ) -> tuple[tuple[float, float] | None, GeocodeSource]:
        if self._geocoder is None:
            return None, "failed"

        loop = asyncio.get_event_loop()

        def _lookup() -> Any:
            return self._geocoder.geocode(
                location_name,
                exactly_one=True,
                timeout=GEOCODER_TIMEOUT_SECONDS,
            )

        try:
            location = await loop.run_in_executor(None, _lookup)
        except Exception as exc:
            logger.warning(
                "Geocode lookup failed for '%s' (%s)",
                location_name,
                type(exc).__name__,
            )
            logger.debug("Geocode traceback for '%s'", location_name, exc_info=True)
            return None, "failed"

        if location is None:
            logger.warning("Geocode lookup failed for '%s' (LookupError)", location_name)
            return None, "failed"

        try:
            coords = (float(location.latitude), float(location.longitude))
        except Exception as exc:
            logger.warning(
                "Geocode lookup failed for '%s' (%s)",
                location_name,
                type(exc).__name__,
            )
            logger.debug("Coordinate parsing traceback for '%s'", location_name, exc_info=True)
            return None, "failed"

        return coords, "nominatim"

    async def _geocode_entity_label(
        self,
        label: str,
    ) -> tuple[tuple[float, float] | None, GeocodeSource]:
        cache_key = self._cache_key(label)
        async with _geo_cache_lock:
            if cache_key in _geo_cache:
                cached_coords = _geo_cache[cache_key]
                if cached_coords is None:
                    return None, "failed"
                return cached_coords, "cache"

        hub_match = resolve_location_from_hubs(label)
        if hub_match:
            coords = self._coords_from_hub(hub_match)
            if coords is not None:
                async with _geo_cache_lock:
                    _geo_cache[cache_key] = coords
                return coords, "geo_hubs"

        coords, source = await self._geocode_with_nominatim(label)
        async with _geo_cache_lock:
            _geo_cache[cache_key] = coords
        return coords, source

    @staticmethod
    def _extract_snippet(article: dict[str, Any]) -> str:
        for field in ("snippet", "description", "excerpt"):
            value = article.get(field)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    @staticmethod
    def _to_text(value: Any) -> str:
        if isinstance(value, str):
            return value.strip()
        return ""

    @staticmethod
    def _normalize_label(label: str) -> str:
        text = re.sub(r"\s+", " ", label).strip(" \t\r\n\"'`")
        if len(text) < 2:
            return ""
        return text

    @staticmethod
    def _coords_from_hub(hub: dict[str, Any]) -> tuple[float, float] | None:
        try:
            return float(hub["lat"]), float(hub["lon"])
        except (KeyError, TypeError, ValueError):
            return None

    @staticmethod
    def _cache_key(label: str) -> str:
        return label.strip().casefold()

    @staticmethod
    def _extract_article_datetime(article: dict[str, Any], fallback: datetime) -> datetime:
        candidates = [
            article.get("seendate"),
            article.get("date"),
            article.get("published"),
            article.get("publishedAt"),
        ]
        for value in candidates:
            if not isinstance(value, str):
                continue
            text = value.strip()
            if not text:
                continue
            try:
                if text.endswith("Z"):
                    text = text[:-1] + "+00:00"
                dt = datetime.fromisoformat(text)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc)
            except ValueError:
                pass
            for fmt in ("%Y%m%d%H%M%S", "%Y-%m-%d %H:%M:%S"):
                try:
                    dt = datetime.strptime(text, fmt)
                    return dt.replace(tzinfo=timezone.utc)
                except ValueError:
                    continue
        return fallback

    @staticmethod
    def _build_node_id(label: str, entity_type: str) -> str:
        digest = hashlib.sha1(
            f"{entity_type}|{label.casefold()}".encode("utf-8")
        ).hexdigest()[:12]
        return f"{entity_type.lower()}_{digest}"

    @staticmethod
    def _utc_now() -> datetime:
        return datetime.now(tz=timezone.utc)
