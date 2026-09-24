"""
app.py

Flask backend exposing satellite position, pass-prediction, and orbit-path endpoints.
"""

import logging
import time

from flask import Flask, jsonify, request
from flask_cors import CORS

from positions import SatelliteTracker
from passes import PassPredictor
from tle_data import TLEManager

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

tracker = SatelliteTracker()
predictor = PassPredictor(tracker)

app_stats = {
    "requests_served": 0,
    "last_position_calc_ms": None,
    "last_pass_calc_ms": None,
}

_orbit_path_cache: dict[str, dict] = {}
ORBIT_PATH_CACHE_HOURS = 1


@app.route("/api/satellites", methods=["GET"])
def get_satellites():
    """Current position of every tracked satellite."""
    start = time.time()
    positions = tracker.get_all_positions()
    app_stats["last_position_calc_ms"] = round((time.time() - start) * 1000, 2)
    app_stats["requests_served"] += 1
    return jsonify({"count": len(positions), "satellites": positions})


@app.route("/api/passes", methods=["GET"])
def get_passes():
    """
    Upcoming passes for every tracked satellite over a given location.
    Query params: lat, lon (required), min_elevation (default 10), days (default 5).
    """
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lon query params are required and must be numbers"}), 400

    min_elevation = float(request.args.get("min_elevation", 10.0))
    days = int(request.args.get("days", 5))

    start = time.time()
    passes = predictor.predict_passes(lat, lon, min_elevation_deg=min_elevation, days_ahead=days)
    app_stats["last_pass_calc_ms"] = round((time.time() - start) * 1000, 2)
    app_stats["requests_served"] += 1

    return jsonify({"count": len(passes), "location": {"lat": lat, "lon": lon}, "passes": passes})


@app.route("/api/orbit-path", methods=["GET"])
def get_orbit_path():
    """
    Full orbit path (one period) for a single satellite, given as a
    ?name= query parameter — not a URL path segment, since many satellite
    names contain slashes (e.g. rocket-body designations like 'SL-14 R/B').
    """
    satellite_name = request.args.get("name")
    if not satellite_name or satellite_name not in tracker.satellites:
        return jsonify({"error": "Unknown or missing satellite name"}), 404

    cached = _orbit_path_cache.get(satellite_name)
    now = time.time()

    if cached is None or (now - cached["computed_at"]) > ORBIT_PATH_CACHE_HOURS * 3600:
        start = time.time()
        result = tracker.get_orbit_path(satellite_name)
        result["computed_at"] = now
        _orbit_path_cache[satellite_name] = result
        logger.info(f"Computed orbit path for {satellite_name} in {(time.time() - start) * 1000:.1f}ms")
    else:
        result = cached

    return jsonify({
        "satellite": satellite_name,
        "points": result["points"],
        "is_geostationary": result["is_geostationary"],
        "period_minutes": result["period_minutes"],
    })


@app.route("/api/stats", methods=["GET"])
def get_stats():
    """Real, currently-measured performance and freshness stats for the running backend."""
    return jsonify({
        "satellites_tracked": len(tracker.satellites),
        "tle_age_hours": TLEManager.get_cache_age_hours(),
        "last_position_calc_ms": app_stats["last_position_calc_ms"],
        "last_pass_calc_ms": app_stats["last_pass_calc_ms"],
        "requests_served": app_stats["requests_served"],
    })


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "satellites_tracked": len(tracker.satellites)})


if __name__ == "__main__":
    app.run(debug=True, port=5000)