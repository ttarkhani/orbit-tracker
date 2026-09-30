"""
passes.py

Predicts upcoming passes of tracked satellites over a given ground location,
using Skyfield's rise/culminate/set event detection.
"""

import logging
from datetime import datetime, timedelta, timezone

from skyfield.api import wgs84

logger = logging.getLogger(__name__)

# Event codes from Skyfield's find_events(): rise above threshold, peak, set below threshold
RISE, CULMINATE, SET = 0, 1, 2


class PassPredictor:
    """Predicts satellite passes over an observer location using a SatelliteTracker."""

    def __init__(self, tracker):
        self.tracker = tracker
        self.ts = tracker.ts

    def predict_passes(
        self,
        lat: float,
        lon: float,
        min_elevation_deg: float = 10.0,
        days_ahead: int = 5,
    ) -> list[dict]:
        """Compute upcoming passes for every tracked satellite over (lat, lon)."""
        observer = wgs84.latlon(lat, lon)
        t0 = self.ts.now()
        t1 = self.ts.from_datetime(datetime.now(timezone.utc) + timedelta(days=days_ahead))

        all_passes = []
        for sat_name, sat in self.tracker.satellites.items():
            all_passes.extend(
                self._passes_for_satellite(sat, sat_name, observer, t0, t1, min_elevation_deg)
            )

        all_passes.sort(key=lambda p: p["rise_time"])
        return all_passes

    def _passes_for_satellite(self, sat, sat_name, observer, t0, t1, min_elevation_deg) -> list[dict]:
        """Find each complete rise -> culminate -> set cycle for one satellite."""
        times, events = sat.find_events(observer, t0, t1, altitude_degrees=min_elevation_deg)
        difference = sat - observer

        passes = []
        current_rise = None
        peak_elevation = None

        for t, event in zip(times, events):
            if event == RISE:
                current_rise = t
                peak_elevation = 0.0
            elif event == CULMINATE and current_rise is not None:
                alt, _, _ = difference.at(t).altaz()
                peak_elevation = max(peak_elevation or 0.0, alt.degrees)
            elif event == SET and current_rise is not None:
                duration_s = (t.utc_datetime() - current_rise.utc_datetime()).total_seconds()
                passes.append({
                    "satellite": sat_name,
                    "rise_time": current_rise.utc_iso(),
                    "max_elevation_deg": round(peak_elevation, 1) if peak_elevation else None,
                    "set_time": t.utc_iso(),
                    "duration_seconds": round(duration_s),
                })
                current_rise = None
                peak_elevation = None

        return passes