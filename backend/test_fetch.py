import time
from tle_data import TLEManager

start = time.time()
data = TLEManager.load_or_fetch()
elapsed = time.time() - start

print(f"\nFetched {len(data)}/5 satellites in {elapsed:.2f}s\n")
for sat, tle in data.items():
    print(f"  {sat}: {tle['name']} (NORAD {tle['norad_id']}, checksum OK: {tle['checksum_valid']})")