"""
positions.py

Loads TLE data into Skyfield EarthSatellite objects and computes each
satellite's real-time geographic position (latitude, longitude, altitude).
"""

import logging

from skyfield.api import EarthSatellite, load, wgs84

from tle_data import TLEManager

logger = logging.getLogger(__name__)


class SatelliteTracker:
    """Holds live EarthSatellite objects built from cached/fetched TLE data."""

    def __init__(self):
        self.ts = load.timescale()
        self.tle_records: dict[str, dict] = {}
        self.satellites: dict[str, EarthSatellite] = {}
        self._build_satellites()

    def _build_satellites(self) -> None:
        """Fetch TLE data and construct one EarthSatellite per tracked object."""
        self.tle_records = TLEManager.load_or_fetch()
        self.satellites = {
            name: EarthSatellite(rec["line1"], rec["line2"], rec["name"], self.ts)
            for name, rec in self.tle_records.items()
        }
        logger.info(f"Loaded {len(self.satellites)} satellites into Skyfield")

    def get_position(self, sat_name: str, at_time=None) -> dict:
        """Compute one satellite's geographic position at a given (or current) time."""
        sat = self.satellites[sat_name]
        t = at_time if at_time is not None else self.ts.now()
        subpoint = wgs84.subpoint(sat.at(t))

        return {
            "name": sat_name,
            "latitude": round(subpoint.latitude.degrees, 4),
            "longitude": round(subpoint.longitude.degrees, 4),
            "altitude_km": round(subpoint.elevation.km, 2),
            "timestamp": t.utc_iso(),
        }

    def get_all_positions(self) -> list[dict]:
        """Compute current positions for every tracked satellite."""
        t = self.ts.now()
        return [self.get_position(name, t) for name in self.satellites]