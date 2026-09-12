const API_BASE = "http://127.0.0.1:5000";
const EARTH_RADIUS_KM = 6371;

const SATELLITE_INFO = {
  ISS: "The International Space Station — continuously crewed since November 2000, the largest human-made structure in orbit.",
  HUBBLE: "The Hubble Space Telescope — launched in 1990, still capturing deep-space imagery after more than 35 years.",
  "NOAA-18": "A NOAA polar-orbiting weather satellite, providing global atmospheric and sea-surface data.",
  "NOAA-19": "The last of NOAA's POES-series weather satellites, launched in 2009.",
  "GOES-16": "A NOAA geostationary weather satellite, providing continuous imagery of the Americas.",
};

let latestSatellitePositions = [];

const world = new Globe(document.getElementById("globeViz"))
  .globeImageUrl("https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg")
  .backgroundColor("#000011")
  .particleLat(d => d.latitude)
  .particleLng(d => d.longitude)
  .particleAltitude(d => d.altitude_km / EARTH_RADIUS_KM)
  .particlesColor(() => "orange")
  .particlesSize(3)
  .particlesSizeAttenuation(false)
  .lineHoverPrecision(5)
  .onParticleClick(showSatelliteDetails);

setTimeout(() => world.pointOfView({ altitude: 2.5 }));

window.addEventListener("resize", () => {
  world.width(window.innerWidth).height(window.innerHeight);
});

async function updatePositions() {
  try {
    const res = await fetch(`${API_BASE}/api/satellites`);
    const data = await res.json();
    latestSatellitePositions = data.satellites;
    world.particlesData([data.satellites]);
  } catch (err) {
    console.error("Failed to fetch satellite positions:", err);
  }
}

updatePositions();
setInterval(updatePositions, 5000);

// --- Live stats bar ---

async function updateStats() {
  try {
    const res = await fetch(`${API_BASE}/api/stats`);
    const data = await res.json();
    document.getElementById("statSatCount").textContent = data.satellites_tracked;
    document.getElementById("statTleAge").textContent = data.tle_age_hours ?? "—";
    document.getElementById("statPosCalc").textContent = data.last_position_calc_ms ?? "—";
    document.getElementById("statPassCalc").textContent = data.last_pass_calc_ms ?? "—";
    document.getElementById("statRequests").textContent = data.requests_served;
  } catch (err) {
    console.error("Failed to fetch stats:", err);
  }
}

updateStats();
setInterval(updateStats, 5000);

// --- Satellite details panel ---

function showSatelliteDetails(sat) {
  document.getElementById("detailsName").textContent = sat.name;
  document.getElementById("detailsBlurb").textContent =
    SATELLITE_INFO[sat.name] || "Live-tracked object from CelesTrak's catalog of bright, easily observed satellites.";
  document.getElementById("detailsNorad").textContent = sat.norad_id ?? "—";
  document.getElementById("detailsLat").textContent = sat.latitude.toFixed(2);
  document.getElementById("detailsLon").textContent = sat.longitude.toFixed(2);
  document.getElementById("detailsAlt").textContent = sat.altitude_km.toFixed(1);
  document.getElementById("detailsUpdated").textContent = new Date(sat.timestamp).toLocaleTimeString();
  document.getElementById("satDetails").classList.add("open");
}

document.getElementById("closeDetails").addEventListener("click", () => {
  document.getElementById("satDetails").classList.remove("open");
});

// --- Pass prediction UI ---

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
      <div class="pass" data-satellite="${p.satellite}">
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

document.getElementById("passResults").addEventListener("click", (e) => {
  const passEl = e.target.closest(".pass");
  if (!passEl) return;
  const sat = latestSatellitePositions.find(s => s.name === passEl.dataset.satellite);
  if (sat) showSatelliteDetails(sat);
});