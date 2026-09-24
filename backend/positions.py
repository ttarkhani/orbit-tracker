"""
positions.py

Loads TLE data into Skyfield EarthSatellite objects and computes each
satellite's real-time geographic position (latitude, longitude, altitude),
plus full orbit paths sampled across one orbital period.
"""

import logging
from datetime import timedelta

from skyfield.api import EarthSatellite, load, wgs84

from tle_data import TLEManager

logger = logging.getLogger(__name__)

SIDEREAL_DEGREES_PER_DAY = 360.9856483  # Earth's rotation rate relative to the stars


class SatelliteTracker:
    """Holds live EarthSatellite objects built from cached/fetched TLE data."""

    def __init__(self):
        self.ts = load.timescale()  # uses Skyfield's built-in tables — no download
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
            "norad_id": self.tle_records[sat_name]["norad_id"],
            "latitude": round(subpoint.latitude.degrees, 4),
            "longitude": round(subpoint.longitude.degrees, 4),
            "altitude_km": round(subpoint.elevation.km, 2),
            "timestamp": t.utc_iso(),
        }

    def get_all_positions(self) -> list[dict]:
        """Compute current positions for every tracked satellite."""
        t = self.ts.now()
        return [self.get_position(name, t) for name in self.satellites]

    def get_orbit_path(self, sat_name: str, num_points: int = 60) -> dict:
        """
        Sample this satellite's position across one full orbital period, for
        drawing its orbit path on the globe. Period is derived directly from
        the TLE's mean motion field (line 2, columns 53-63: revolutions per
        day) — a fixed position in the TLE format, not a library internal.

        Geostationary satellites (period within an hour of one sidereal day)
        are a special case: their ground track barely moves, since matching
        Earth's rotation is the definition of geostationary. To still show
        their real motion through space, Earth's own rotation is added back
        into the sampled longitudes — revealing the true orbital ring rather
        than the (correctly) near-degenerate ground track.
        """
        line2 = self.tle_records[sat_name]["line2"]
        mean_motion_rev_per_day = float(line2[52:63])
        period_minutes = 1440.0 / mean_motion_rev_per_day
        is_geostationary = 23.0 <= (period_minutes / 60) <= 25.0

        t0 = self.ts.now()
        path = []
        for i in range(num_points + 1):  # +1 closes the loop back to the start point
            minutes_elapsed = (period_minutes / num_points) * i
            t = t0 + timedelta(minutes=minutes_elapsed)
            pos = self.get_position(sat_name, t)
            lon = pos["longitude"]

            if is_geostationary:
                days_elapsed = minutes_elapsed / 1440.0
                lon = ((lon + SIDEREAL_DEGREES_PER_DAY * days_elapsed + 180) % 360) - 180

            path.append({"lat": pos["latitude"], "lng": lon, "alt": pos["altitude_km"]})

        return {
            "points": path,
            "is_geostationary": is_geostationary,
            "period_minutes": round(period_minutes, 1),
        }