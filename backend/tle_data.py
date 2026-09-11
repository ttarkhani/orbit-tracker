"""
tle_data.py

Fetches, validates, and caches Two-Line Element (TLE) orbital data for a
curated set of well-known satellites from CelesTrak's public GP data API.
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
    REQUEST_TIMEOUT_SECONDS = 10
    GP_URL = "https://celestrak.org/NORAD/elements/gp.php"

    SATELLITES: dict[str, str] = {
        "25544": "ISS",
        "20580": "HUBBLE",
        "28654": "NOAA-18",
        "33591": "NOAA-19",
        "41866": "GOES-16",
    }

    @staticmethod
    def _tle_checksum_valid(line: str) -> bool:
        """
        Validate a TLE line's checksum digit: sum of all digits mod 10
        (a '-' counts as 1; every other non-digit counts as 0) must equal
        the line's final character. Catches truncated or corrupted data
        before it silently feeds bad elements into SGP4.
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
    def fetch_from_celestrak(cls) -> dict[str, dict]:
        """
        Fetch each tracked satellite individually by NORAD catalog number.
        One small request per satellite instead of downloading CelesTrak's
        entire active catalog just to keep 5 of them.
        """
        logger.info(f"Fetching {len(cls.SATELLITES)} satellites from CelesTrak...")
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
                checksum_ok = cls._tle_checksum_valid(line1) and cls._tle_checksum_valid(line2)

                if not checksum_ok:
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

        summary = f"Fetched {len(tle_dict)}/{len(cls.SATELLITES)} satellites"
        logger.info(summary if not failed else f"{summary} ({len(failed)} failed: {failed})")
        return tle_dict

    @classmethod
    def load_or_fetch(cls, force_refresh: bool = False) -> dict[str, dict]:
        """
        Load from local cache if it's fresh; otherwise fetch live from
        CelesTrak. If a live fetch fails outright, fall back to a stale
        cache rather than returning nothing.
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