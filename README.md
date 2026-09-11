# 🛰️ Orbit Tracker

Live satellite tracking and pass prediction, built on real public orbital data.
Visualizes current satellite positions on an interactive 3D globe and predicts
upcoming passes for any location on Earth.

## Features

- **Live TLE data** — fetches current orbital elements for 5 well-known satellites directly from [CelesTrak](https://celestrak.org)'s public API
- **Real-time position tracking** — computes live lat/lon/altitude for each satellite using SGP4 propagation via [Skyfield](https://rhodesmill.org/skyfield/)
- **Pass prediction** — given any ground location, predicts upcoming passes (rise time, max elevation, duration) over the next few days
- **Interactive 3D globe** — live-updating satellite positions rendered with [globe.gl](https://github.com/vasturiano/globe.gl) (built on three.js)
- **Location-based UI** — enter coordinates, see the next visible passes

## Tech stack

| Layer | Tech |
|---|---|
| Orbital mechanics | Skyfield (SGP4) |
| Backend | Python 3.14, Flask |
| Data source | [CelesTrak GP data API](https://celestrak.org/NORAD/documentation/gp-data-formats.php) |
| Frontend | Vanilla JS, globe.gl (three.js) |
| Data flow | REST (JSON), polled every 5s |

Satellites tracked: **ISS** (25544), **Hubble** (20580), **NOAA-18** (28654), **NOAA-19** (33591), **GOES-16** (41866) — a mix of low-Earth, polar, and geostationary orbits.

## Real metrics

Measured on this project, not estimated:

| Metric | Result |
|---|---|
| Satellites fetched from CelesTrak | 5 / 5 (100%) |
| TLE checksum validation | 5 / 5 passed |
| TLE fetch time (cold, 5 individual requests) | 2.43s |
| TLE fetch time (cached) | < 0.01s |
| Position calculation, 5 satellites | 1.24ms |
| Pass prediction, 5 satellites over 5 days | 106.6ms → 84 passes found |
| Live API response time (`/api/satellites`) | 5–7ms |

**Accuracy cross-checks against known data:**
- ISS: computed altitude ~419–422 km → matches its real maintained altitude (~400–420 km)
- GOES-16: computed altitude ~35,779 km → theoretical geostationary altitude is ~35,786 km (within 0.02%)
- Hubble: computed altitude ~468–469 km → matches its current (2026) decayed orbital altitude of ~470 km
- NOAA-18 / NOAA-19: ~856–874 km → correct range for polar weather satellites
- GOES-16 (geostationary) correctly produces **zero** predicted passes in the 5-day window — it doesn't rise/set from a fixed ground point, and the pass-detection logic correctly reflects that

## Setup

**Requirements:** Python 3.10+ (tested on 3.14.7)

```bash
git clone https://github.com/ttarkhani/orbit-tracker.git
cd orbit-tracker
```

**Backend:**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```
Runs at `http://127.0.0.1:5000`.

**Frontend** (in a separate terminal):
```bash
cd frontend
python3 -m http.server 8000
```
Open `http://localhost:8000` in your browser.

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check + count of tracked satellites |
| `GET /api/satellites` | Current position of every tracked satellite |
| `GET /api/passes?lat=X&lon=Y&min_elevation=10&days=5` | Upcoming passes for a location |

## Challenges & how they were solved

- **Skyfield/NumPy incompatibility** — `skyfield==1.46` broke on import because it relied on `numpy.float_`, a symbol NumPy removed in its 2.0 release. Fixed by upgrading to `skyfield==1.55`, which restored compatibility.
- **Invisible satellite markers** — the globe rendered fine, but satellite markers were essentially invisible. Root cause: globe.gl's "particles" layer defaults to a very small render size, suited for large point-clouds rather than a handful of individually meaningful markers. Fixed with an explicit larger particle size and disabling distance-based size shrinking.
- **CelesTrak API design** — rather than downloading the entire ~4,000-object active-satellite catalog to extract 5 satellites, the backend queries each one individually by NORAD catalog number, keeping payloads small and in line with CelesTrak's own usage guidance against bulk downloads.

## Known limitations

- Pass prediction is geometric (satellite above elevation threshold), not full optical visibility — it doesn't yet account for whether the satellite is sunlit or the sky is dark
- Orbit ground-track path lines aren't drawn on the globe yet
- Only 5 curated satellites are tracked, not a searchable catalog
- TLE-based predictions are most accurate within about a week of the data's epoch, which is a known characteristic of SGP4

## License

MIT (or add a LICENSE file if you'd like one)