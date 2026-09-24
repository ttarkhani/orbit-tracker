const API_BASE = "http://127.0.0.1:5000";
const EARTH_RADIUS_KM = 6371;
const DEFAULT_VIEW_ALTITUDE = 2.5;

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
  .backgroundColor("#0A0E14")
  .particleLat(d => d.latitude)
  .particleLng(d => d.longitude)
  .particleAltitude(d => d.altitude_km / EARTH_RADIUS_KM)
  .particlesColor(() => "#FFB454")
  .particlesSize(3)
  .particlesSizeAttenuation(false)
  .lineHoverPrecision(5)
  .onParticleClick(showSatelliteDetails)
  .pathPoints('points')
  .pathPointLat('lat')
  .pathPointLng('lng')
  .pathPointAlt(d => d.alt / EARTH_RADIUS_KM)
  .pathColor(() => 'rgba(255, 180, 84, 0.55)')
  .pathStroke(0.4)
  .pathsData([]);

setTimeout(() => world.pointOfView({ altitude: DEFAULT_VIEW_ALTITUDE }));

window.addEventListener("resize", () => {
  world.width(window.innerWidth).height(window.innerHeight);
});

function updateClock() {
  const utc = new Date().toUTCString().slice(17, 25);
  document.getElementById("utcClock").textContent = `${utc} UTC`;
}
updateClock();
setInterval(updateClock, 1000);

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

// --- Satellite details panel + orbit path ---

function frameOrbitPath(maxAltitudeKm) {
  const ringRadius = 1 + maxAltitudeKm / EARTH_RADIUS_KM;
  const camera = world.camera();
  const halfFovRad = (camera.fov / 2) * (Math.PI / 180);
  const requiredDistance = (ringRadius / Math.tan(halfFovRad)) * 1.2;
  const framingAltitude = Math.max(DEFAULT_VIEW_ALTITUDE, requiredDistance);
  world.pointOfView({ altitude: framingAltitude }, 800);
}

async function showSatelliteDetails(sat) {
  document.getElementById("detailsName").textContent = sat.name;
  const baseBlurb = SATELLITE_INFO[sat.name] || "Live-tracked object from CelesTrak's catalog of bright, easily observed satellites.";
  document.getElementById("detailsNorad").textContent = sat.norad_id ?? "—";
  document.getElementById("detailsLat").textContent = sat.latitude.toFixed(2) + "°";
  document.getElementById("detailsLon").textContent = sat.longitude.toFixed(2) + "°";
  document.getElementById("detailsAlt").textContent = sat.altitude_km.toFixed(1) + " km";
  document.getElementById("detailsUpdated").textContent = new Date(sat.timestamp).toLocaleTimeString();
  document.getElementById("satDetails").classList.add("open");

  try {
    const res = await fetch(`${API_BASE}/api/orbit-path?name=${encodeURIComponent(sat.name)}`);
    const data = await res.json();

    world.pathsData([{ name: sat.name, points: data.points }]);
    const maxAlt = Math.max(...data.points.map(p => p.alt));
    frameOrbitPath(maxAlt);

    document.getElementById("detailsBlurb").textContent = data.is_geostationary
      ? baseBlurb + " Geostationary — this ring shows its true motion through space; its ground track alone would stay fixed over one spot, since that motion exactly matches Earth's rotation."
      : baseBlurb;
  } catch (err) {
    console.error("Failed to load orbit path:", err);
    document.getElementById("detailsBlurb").textContent = baseBlurb;
  }
}

document.getElementById("closeDetails").addEventListener("click", () => {
  document.getElementById("satDetails").classList.remove("open");
  world.pathsData([]);
  world.pointOfView({ altitude: DEFAULT_VIEW_ALTITUDE }, 800);
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
        <strong>${p.satellite}</strong>
        <div class="meta">${new Date(p.rise_time).toLocaleString()} · max ${p.max_elevation_deg}° · ${p.duration_seconds}s</div>
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