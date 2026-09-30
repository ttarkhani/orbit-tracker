import time
from positions import SatelliteTracker
from passes import PassPredictor

tracker = SatelliteTracker()
predictor = PassPredictor(tracker)

LAT, LON = 40.7128, -74.0060

start = time.time()
passes = predictor.predict_passes(LAT, LON, min_elevation_deg=10.0, days_ahead=5)
elapsed_ms = (time.time() - start) * 1000

print(f"\nFound {len(passes)} passes over ({LAT}, {LON}) in the next 5 days")
print(f"Computed in {elapsed_ms:.1f}ms\n")

for p in passes[:10]:
    print(f"  {p['satellite']}: rise {p['rise_time']} | max elev {p['max_elevation_deg']}° | duration {p['duration_seconds']}s")