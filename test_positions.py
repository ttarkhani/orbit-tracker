import time
from positions import SatelliteTracker

start = time.time()
tracker = SatelliteTracker()
load_time = time.time() - start

start = time.time()
positions = tracker.get_all_positions()
calc_time_ms = (time.time() - start) * 1000

print(f"\nLoaded {len(tracker.satellites)} satellites in {load_time:.2f}s (includes TLE fetch/cache)")
print(f"Computed {len(positions)} positions in {calc_time_ms:.2f}ms\n")

for pos in positions:
    print(f"  {pos['name']}: lat={pos['latitude']}, lon={pos['longitude']}, alt={pos['altitude_km']} km")