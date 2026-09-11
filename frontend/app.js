const API_BASE = "http://127.0.0.1:5000";
const EARTH_RADIUS_KM = 6371;

const world = new Globe(document.getElementById("globeViz"))
  .globeImageUrl("https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg")
  .backgroundColor("#000011")
  .particleLat(d => d.latitude)
  .particleLng(d => d.longitude)
  .particleAltitude(d => d.altitude_km / EARTH_RADIUS_KM)
  .particlesColor(() => "orange")
  .particlesSize(3)
  .particlesSizeAttenuation(false);

setTimeout(() => world.pointOfView({ altitude: 2.5 }));

window.addEventListener("resize", () => {
  world.width(window.innerWidth).height(window.innerHeight);
});

async function updatePositions() {
  try {
    const res = await fetch(`${API_BASE}/api/satellites`);
    const data = await res.json();
    world.particlesData([data.satellites]);
  } catch (err) {
    console.error("Failed to fetch satellite positions:", err);
  }
}

updatePositions();
setInterval(updatePositions, 5000);


async function fetchPasses() {
  const lat = parseFloat(document.getElementById("lat").value);
  const lon = parseFloat(document.getElementById("lon").value);
  const resultsEl = document.getElementById("passResults");
  resultsEl.innerHTML = "Loading…";

  try {
    const res = await fetch(`${API_BASE}/api/passes?lat=${lat}&lon=${lon}&days=3`);
    const data = await res.json();

    if (!data.passes || data.passes.length === 0) {
      resultsEl.innerHTML = "<p>No passes found in the next 3 days.</p>";
      return;
    }

    resultsEl.innerHTML = data.passes.slice(0, 8).map(p => `
      <div class="pass">
        <strong>${p.satellite}</strong><br>
        Rise: ${new Date(p.rise_time).toLocaleString()}<br>
        Max elev: ${p.max_elevation_deg}° · Duration: ${p.duration_seconds}s
      </div>
    `).join("");
  } catch (err) {
    resultsEl.innerHTML = "<p>Error fetching passes — is the backend running?</p>";
    console.error(err);
  }
}

document.getElementById("findPasses").addEventListener("click", fetchPasses);
fetchPasses();