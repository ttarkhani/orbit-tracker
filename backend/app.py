"""
app.py

Flask backend exposing satellite position and pass-prediction endpoints.
"""

import logging

from flask import Flask, jsonify, request
from flask_cors import CORS

from positions import SatelliteTracker
from passes import PassPredictor

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

tracker = SatelliteTracker()
predictor = PassPredictor(tracker)


@app.route("/api/satellites", methods=["GET"])
def get_satellites():
    """Current position of every tracked satellite."""
    positions = tracker.get_all_positions()
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

    passes = predictor.predict_passes(lat, lon, min_elevation_deg=min_elevation, days_ahead=days)
    return jsonify({"count": len(passes), "location": {"lat": lat, "lon": lon}, "passes": passes})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "satellites_tracked": len(tracker.satellites)})


if __name__ == "__main__":
    app.run(debug=True, port=5000)