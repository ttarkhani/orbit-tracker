# 🛰️ Orbit Tracker

Live satellite tracking and pass prediction, built on real public orbital data. Tracks up to 30 satellites in real time, visualizes their positions on an interactive 3D globe, and predicts upcoming passes for any location on Earth.

## Features

- **Live TLE data** — fetches current orbital elements from [CelesTrak](https://celestrak.org)'s public API: 5 individually curated well-known satellites plus ~25 more bulk-fetched from CelesTrak's "visual" group (bright, easily observed objects)
- **Real-time position tracking** — computes live lat/lon/altitude for every tracked satellite using SGP4 propagation via [Skyfield](https://rhodesmill.org/skyfield/)
- **Pass prediction** — given any ground location, predicts upcoming passes (rise time, max elevation, duration) over the next few days
- **Interactive 3D globe** — live-updating satellite positions rendered with [globe.gl](https://github.com/vasturiano/globe.gl) (built on three.js)
- **Satellite details panel** — click any satellite, on the globe or in the pass list, to see its name, description, NORAD ID, and live position
- **Live stats bar** — real, currently-measured backend numbers displayed on the page itself: satellites tracked, TLE cache age, calculation times, requests served
- **Location-based UI** — enter coordinates, see the next visible passes

## Tech stack

| Layer | Tech |
|---|---|
| Orbital mechanics | Skyfield (SGP4) |
| Backend | Python 3.14, Flask |
| Data source | [CelesTrak GP data API](https://celestrak.org/NORAD/documentation/gp-data-formats.php) |
| Frontend | Vanilla JS, globe.gl (three.js) |
| Data flow | REST (JSON), polled every 5s |

Curated satellites: **ISS** (25544), **Hubble** (20580), **NOAA-18** (28654), **NOAA-19** (33591), **GOES-16** (41866). The remaining ~25 come live from CelesTrak's "visual" group and can change over time as that group is updated.

## Real metrics

Measured on this project, not estimated. Initial measurements taken at the original 5-satellite scale, before scaling up to 30:

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
- GOES-16 (geostationary) correctly produces **zero** predicted passes in a 5-day window — it doesn't rise/set from a fixed ground point, and the pass-detection logic correctly reflects that

**Scaled to 30 tracked satellites** (5 curated + 25 bulk-fetched from CelesTrak's "visual" group) using a single additional bulk request rather than scaling to 30 individual per-satellite requests, which would have taken roughly 15 seconds on a cold fetch.

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
| `GET /api/stats` | Live backend performance stats (calc times, cache age, requests served) |

## Challenges & how they were solved

- **Skyfield/NumPy incompatibility** — `skyfield==1.46` broke on import because it relied on `numpy.float_`, a symbol NumPy removed in its 2.0 release. Fixed by upgrading to `skyfield==1.55`, which restored compatibility.
- **Invisible satellite markers** — the globe rendered fine, but satellite markers were essentially invisible. Root cause: globe.gl's "particles" layer defaults to a very small render size, suited for large point-clouds rather than a handful of individually meaningful markers. Fixed with an explicit larger particle size and disabling distance-based size shrinking.
- **Unclickable satellite markers** — clicking a marker did nothing even though it was clearly visible. The rendering size and the click/hover hit-area size are controlled independently in three.js; the default hit-area tolerance was far smaller than the visual dot. Fixed by explicitly widening it.
- **Scaling to 30 satellites without a 15-second load** — rather than issuing one HTTP request per additional satellite, the backend fetches CelesTrak's pre-filtered "visual" group in a single bulk request, matching CelesTrak's own guidance to use grouped queries instead of many individual lookups.

## Known limitations

- Pass prediction is geometric (satellite above elevation threshold), not full optical visibility — it doesn't yet account for whether the satellite is sunlit or the sky is dark
- Orbit ground-track path lines aren't drawn on the globe yet
- Only the 5 curated satellites have a custom description in the details panel; the other 25 show live position data only
- Live stats reset on backend restart — they're in-memory for the current process, not persisted
- TLE-based predictions are most accurate within about a week of the data's epoch, which is a known characteristic of SGP4