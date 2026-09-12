"""
tle_data.py

Fetches, validates, and caches Two-Line Element (TLE) orbital data from
CelesTrak's public GP data API:
  - A curated set of individually well-known satellites (ISS, Hubble, etc.),
    fetched by NORAD catalog number.
  - A bulk-fetched set of additional satellites from CelesTrak's 'visual'
    group (bright, easily observed objects), fetched in a single request
    rather than one request per satellite.
"""

import json
import logging
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone

import requests

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


@dataclass
class TLERecord:
    """A single satellite's orbital elements plus fetch metadata."""
    name: str
    norad_id: str
    line1: str
    line2: str
    fetched_at: str
    checksum_valid: bool


class TLEManager:
    """Fetches and caches satellite TLE data from CelesTrak."""

    CACHE_FILE = "tle_cache.json"
    CACHE_DURATION_HOURS = 24
    REQUEST_TIMEOUT_SECONDS = 15  # bulk group payload is larger than a single-satellite request
    GP_URL = "https://celestrak.org/NORAD/elements/gp.php"

    # Individually curated, hand-verified satellites with custom info blurbs
    # in the frontend.
    SATELLITES: dict[str, str] = {
        "25544": "ISS",
        "20580": "HUBBLE",
        "28654": "NOAA-18",
        "33591": "NOAA-19",
        "41866": "GOES-16",
    }

    # Additional satellites fetched in bulk from CelesTrak's 'visual' group
    # (bright, naked-eye-visible objects) — one request instead of many.
    BULK_GROUP = "visual"
    BULK_TARGET_COUNT = 25  # + the 5 curated above = ~30 tracked satellites

    @staticmethod
    def _tle_checksum_valid(line: str) -> bool:
        """
        Validate a TLE line's checksum digit: sum of all digits mod 10
        (a '-' counts as 1; every other non-digit counts as 0) must equal
        the line's final character.
        """
        if not line:
            return False
        body, expected = line[:-1], line[-1]
        if not expected.isdigit():
            return False
        total = sum(
            int(ch) if ch.isdigit() else (1 if ch == "-" else 0)
            for ch in body
        )
        return total % 10 == int(expected)

    @classmethod
    def fetch_curated(cls) -> dict[str, dict]:
        """Fetch each individually curated satellite by NORAD catalog number."""
        logger.info(f"Fetching {len(cls.SATELLITES)} curated satellites from CelesTrak...")
        tle_dict: dict[str, dict] = {}
        failed: list[str] = []

        for norad_id, friendly_name in cls.SATELLITES.items():
            try:
                resp = requests.get(
                    cls.GP_URL,
                    params={"CATNR": norad_id, "FORMAT": "TLE"},
                    timeout=cls.REQUEST_TIMEOUT_SECONDS,
                )
                resp.raise_for_status()
                lines = [ln for ln in resp.text.strip().split("\n") if ln.strip()]

                if len(lines) < 3:
                    logger.warning(f"{friendly_name} ({norad_id}): no data returned")
                    failed.append(friendly_name)
                    continue

                name, line1, line2 = lines[0].strip(), lines[1].strip(), lines[2].strip()
                if not (cls._tle_checksum_valid(line1) and cls._tle_checksum_valid(line2)):
                    logger.warning(f"{friendly_name} ({norad_id}): checksum FAILED, skipping")
                    failed.append(friendly_name)
                    continue

                tle_dict[friendly_name] = asdict(TLERecord(
                    name=name,
                    norad_id=norad_id,
                    line1=line1,
                    line2=line2,
                    fetched_at=datetime.now(timezone.utc).isoformat(),
                    checksum_valid=True,
                ))

            except requests.RequestException as e:
                logger.error(f"{friendly_name} ({norad_id}): request failed — {e}")
                failed.append(friendly_name)

        summary = f"Curated: {len(tle_dict)}/{len(cls.SATELLITES)} satellites"
        logger.info(summary if not failed else f"{summary} ({len(failed)} failed: {failed})")
        return tle_dict

    @classmethod
    def fetch_bulk_extras(cls, exclude_ids: set[str]) -> dict[str, dict]:
        """
        Fetch CelesTrak's 'visual' group in a single request, skipping any
        satellite already covered by the curated set, capped at BULK_TARGET_COUNT.
        """
        logger.info(f"Fetching bulk group '{cls.BULK_GROUP}' from CelesTrak...")
        try:
            resp = requests.get(
                cls.GP_URL,
                params={"GROUP": cls.BULK_GROUP, "FORMAT": "TLE"},
                timeout=cls.REQUEST_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            lines = [ln for ln in resp.text.strip().split("\n") if ln.strip()]
        except requests.RequestException as e:
            logger.error(f"Bulk group fetch failed: {e}")
            return {}

        extras: dict[str, dict] = {}
        checksum_failures = 0

        for i in range(0, len(lines) - 2, 3):
            name, line1, line2 = lines[i].strip(), lines[i + 1].strip(), lines[i + 2].strip()
            norad_id = line1[2:7].strip()

            if norad_id in exclude_ids:
                continue
            if not (cls._tle_checksum_valid(line1) and cls._tle_checksum_valid(line2)):
                checksum_failures += 1
                continue

            extras[name] = asdict(TLERecord(
                name=name,
                norad_id=norad_id,
                line1=line1,
                line2=line2,
                fetched_at=datetime.now(timezone.utc).isoformat(),
                checksum_valid=True,
            ))

            if len(extras) >= cls.BULK_TARGET_COUNT:
                break

        logger.info(
            f"Bulk group '{cls.BULK_GROUP}': added {len(extras)} satellites"
            + (f" ({checksum_failures} failed checksum)" if checksum_failures else "")
        )
        return extras

    @classmethod
    def fetch_from_celestrak(cls) -> dict[str, dict]:
        """Fetch the curated set plus bulk extras for a fuller tracked list."""
        curated = cls.fetch_curated()
        extras = cls.fetch_bulk_extras(exclude_ids=set(cls.SATELLITES.keys()))
        combined = {**curated, **extras}
        logger.info(
            f"Total satellites tracked: {len(combined)} "
            f"({len(curated)} curated + {len(extras)} bulk)"
        )
        return combined

    @classmethod
    def get_cache_age_hours(cls) -> float | None:
        """Return how many hours old the current TLE cache is, or None if no cache exists."""
        cached = cls._read_cache()
        if cached is None:
            return None
        fetched_time = datetime.fromisoformat(cached["timestamp"])
        age = datetime.now(timezone.utc) - fetched_time
        return round(age.total_seconds() / 3600, 2)

    @classmethod
    def load_or_fetch(cls, force_refresh: bool = False) -> dict[str, dict]:
        """
        Load from local cache if it's fresh; otherwise fetch live from
        CelesTrak. Falls back to a stale cache rather than returning
        nothing if a live fetch fails outright.
        """
        cached = cls._read_cache()

        if not force_refresh and cached is not None:
            fetched_time = datetime.fromisoformat(cached["timestamp"])
            age = datetime.now(timezone.utc) - fetched_time
            if age < timedelta(hours=cls.CACHE_DURATION_HOURS):
                logger.info(f"Using cached TLE data ({age.total_seconds() / 3600:.1f}h old)")
                return cached["data"]

        fresh = cls.fetch_from_celestrak()

        if fresh:
            cls._write_cache(fresh)
            return fresh

        if cached is not None:
            logger.warning("Live fetch failed — falling back to stale cache")
            return cached["data"]

        logger.error("No live data and no cache available")
        return {}

    @classmethod
    def _read_cache(cls) -> dict | None:
        if not os.path.exists(cls.CACHE_FILE):
            return None
        try:
            with open(cls.CACHE_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"Cache file unreadable ({e}), ignoring it")
            return None

    @classmethod
    def _write_cache(cls, data: dict) -> None:
        cache = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": data,
        }
        with open(cls.CACHE_FILE, "w") as f:
            json.dump(cache, f, indent=2)