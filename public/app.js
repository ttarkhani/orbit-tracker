// Local dev: static files on :8000, Flask on :5000. Deployed: everything on one origin.
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_BASE = IS_LOCAL ? "http://127.0.0.1:5000" : "";
const EARTH_RADIUS_KM = 6371;
const DEFAULT_VIEW_ALTITUDE = 2.5;
const SAT_COLOR = "#FFB454";
const SELECTED_SAT_COLOR = "#E8EAED";
const LOCATION_STORAGE_KEY = "orbitTracker.location";
// Fly-to camera latitude for geostationary satellites. Centering on their ~0° latitude
// puts the camera in the ring's plane, so the ring would read as a flat line.
const GEO_FLYTO_LAT = 28;
const CAMERA_MOVE_MS = 800;
// Gap kept between a framed orbit ring and the nearest panel or bar edge.
const FRAME_MARGIN_PX = 16;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const mobileLayout = window.matchMedia("(max-width: 768px)");
const motionMs = ms => reducedMotion.matches ? 0 : ms;

const SATELLITE_INFO = {
  ISS: "The International Space Station — continuously crewed since November 2000, the largest human-made structure in orbit.",
  HUBBLE: "The Hubble Space Telescope — launched in 1990, still capturing deep-space imagery after more than 35 years.",
  "NOAA-18": "A NOAA polar-orbiting weather satellite, providing global atmospheric and sea-surface data.",
  "NOAA-19": "The last of NOAA's POES-series weather satellites, launched in 2009.",
  "GOES-16": "A NOAA geostationary weather satellite, providing continuous imagery of the Americas.",
};

let latestSatellitePositions = [];
let selectedSatelliteName = null;

// Color and size apply per particle set (one THREE.Points each), so the selected
// satellite is rendered as its own one-element set.
const isSelectedSet = set => set.some(s => s.name === selectedSatelliteName);

const world = new Globe(document.getElementById("globeViz"))
  .globeImageUrl("https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg")
  .backgroundColor("#0A0E14")
  .particleLat(d => d.latitude)
  .particleLng(d => d.longitude)
  .particleAltitude(d => d.altitude_km / EARTH_RADIUS_KM)
  .particlesColor(set => isSelectedSet(set) ? SELECTED_SAT_COLOR : SAT_COLOR)
  .particlesSize(set => isSelectedSet(set) ? 6 : 3)
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
  if (selectedSatelliteName) animateGlobeOffset(unobstructedCenterOffset(), 0);
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
    renderParticles();
  } catch (err) {
    console.error("Failed to fetch satellite positions:", err);
  }
}

function renderParticles() {
  const selected = latestSatellitePositions.filter(s => s.name === selectedSatelliteName);
  const others = latestSatellitePositions.filter(s => s.name !== selectedSatelliteName);
  world.particlesData(selected.length ? [others, selected] : [others]);
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

const controlsPanel = document.getElementById("controls");
const detailsPanel = document.getElementById("satDetails");

function isPanelShown(panel) {
  if (panel === controlsPanel && !mobileLayout.matches) return true;
  return panel.classList.contains("open");
}

// Viewport area not covered by the top bar, stats bar, or any open panel. Uses offset*
// (layout position) so a panel mid-slide is measured where it will end up.
function unobstructedRect() {
  const w = window.innerWidth;
  const rect = {
    left: 0,
    top: document.getElementById("topBar").offsetHeight,
    right: w,
    bottom: window.innerHeight - document.getElementById("statsBar").offsetHeight,
  };
  for (const panel of [controlsPanel, detailsPanel]) {
    if (!isPanelShown(panel)) continue;
    const left = panel.offsetLeft;
    const right = left + panel.offsetWidth;
    if (panel.offsetWidth > w * 0.6) rect.bottom = Math.min(rect.bottom, panel.offsetTop);  // bottom sheet
    else if ((left + right) / 2 < w / 2) rect.left = Math.max(rect.left, right);
    else rect.right = Math.min(rect.right, left);
  }
  return rect;
}

function unobstructedCenterOffset() {
  const r = unobstructedRect();
  return [(r.left + r.right - window.innerWidth) / 2, (r.top + r.bottom - window.innerHeight) / 2];
}

// globeOffset shifts the rendered globe in screen px; ease it alongside pointOfView's tween.
let globeOffset = [0, 0];
let globeOffsetFrame = null;

function animateGlobeOffset(target, ms) {
  cancelAnimationFrame(globeOffsetFrame);
  const from = globeOffset.slice();
  const start = performance.now();
  const step = (now) => {
    const t = ms ? Math.min(1, (now - start) / ms) : 1;
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;  // cubic in-out
    globeOffset = from.map((v, i) => v + (target[i] - v) * eased);
    world.globeOffset(globeOffset);
    if (t < 1) globeOffsetFrame = requestAnimationFrame(step);
  };
  step(start);
}

// Centers the globe in the unobstructed area and picks the altitude at which the whole ring
// fits inside it. Pass `focus` ({lat, lng}) to also rotate the globe so that point faces the camera.
function frameOrbitPath(maxAltitudeKm, focus) {
  const ringRadius = 1 + maxAltitudeKm / EARTH_RADIUS_KM;
  const free = unobstructedRect();
  const halfFitPx = Math.max(40, Math.min(free.right - free.left, free.bottom - free.top) / 2 - FRAME_MARGIN_PX);
  // The view offset only shifts the image, so the vertical FOV still sets px per unit of tan(angle).
  const halfFovRad = (world.camera().fov / 2) * (Math.PI / 180);
  const tanFit = halfFitPx * Math.tan(halfFovRad) / (window.innerHeight / 2);
  // The ring lies inside a sphere of radius ringRadius, which spans asin(ringRadius / distance)
  // from the view axis; solve for the distance where that angle's tan equals tanFit.
  const distance = ringRadius * Math.sqrt(1 + tanFit * tanFit) / tanFit;
  const framingAltitude = Math.max(DEFAULT_VIEW_ALTITUDE, distance - 1);
  const view = focus
    ? { lat: focus.lat, lng: focus.lng, altitude: framingAltitude }
    : { altitude: framingAltitude };
  animateGlobeOffset(unobstructedCenterOffset(), motionMs(CAMERA_MOVE_MS));
  world.pointOfView(view, motionMs(CAMERA_MOVE_MS));
}

// flyTo is set for selections from search or the pass list, not direct dot clicks.
async function showSatelliteDetails(sat, { flyTo = false } = {}) {
  selectedSatelliteName = sat.name;
  renderParticles();
  if (mobileLayout.matches) closePasses();

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
    // Another satellite was selected, or the panel closed, while this request was in flight.
    if (selectedSatelliteName !== sat.name) return;

    // Set the blurb before framing: on mobile its length changes the bottom sheet's height.
    document.getElementById("detailsBlurb").textContent = data.is_geostationary
      ? baseBlurb + " Geostationary — this ring shows its true motion through space; its ground track alone would stay fixed over one spot, since that motion exactly matches Earth's rotation."
      : baseBlurb;

    world.pathsData([{ name: sat.name, points: data.points }]);
    const maxAlt = Math.max(...data.points.map(p => p.alt));
    const focusLat = data.is_geostationary ? GEO_FLYTO_LAT : sat.latitude;
    frameOrbitPath(maxAlt, flyTo ? { lat: focusLat, lng: sat.longitude } : null);
  } catch (err) {
    console.error("Failed to load orbit path:", err);
    document.getElementById("detailsBlurb").textContent = baseBlurb;
  }
}

function closeDetails() {
  document.getElementById("satDetails").classList.remove("open");
  selectedSatelliteName = null;
  renderParticles();
  world.pathsData([]);
  animateGlobeOffset([0, 0], motionMs(CAMERA_MOVE_MS));
  world.pointOfView({ altitude: DEFAULT_VIEW_ALTITUDE }, motionMs(CAMERA_MOVE_MS));
}

document.getElementById("closeDetails").addEventListener("click", closeDetails);

// --- Mobile: passes sheet toggle (only one sheet open at a time) ---

const passesToggle = document.getElementById("passesToggle");

function setPassesOpen(open) {
  controlsPanel.classList.toggle("open", open);
  passesToggle.setAttribute("aria-expanded", String(open));
}

function closePasses() {
  setPassesOpen(false);
}

passesToggle.addEventListener("click", () => {
  const open = !controlsPanel.classList.contains("open");
  if (open && detailsPanel.classList.contains("open")) closeDetails();
  setPassesOpen(open);
});

// The desktop layout always shows the panel, so the sheet state resets on a layout switch.
mobileLayout.addEventListener("change", closePasses);

// --- Pass prediction UI ---

async function fetchPasses() {
  const lat = parseFloat(document.getElementById("lat").value);
  const lon = parseFloat(document.getElementById("lon").value);
  saveLocation(lat, lon);
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
restoreLocation();
fetchPasses();

document.getElementById("passResults").addEventListener("click", (e) => {
  const passEl = e.target.closest(".pass");
  if (!passEl) return;
  const sat = latestSatellitePositions.find(s => s.name === passEl.dataset.satellite);
  if (sat) showSatelliteDetails(sat, { flyTo: true });
});

// --- Location: geolocation + remembered coordinates ---

function isValidLocation(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function saveLocation(lat, lon) {
  if (!isValidLocation(lat, lon)) return;
  try {
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ lat, lon }));
  } catch (err) {
    // Storage unavailable (private mode, blocked cookies); not remembering is fine.
  }
}

function restoreLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY));
    if (saved && isValidLocation(saved.lat, saved.lon)) {
      document.getElementById("lat").value = saved.lat;
      document.getElementById("lon").value = saved.lon;
    }
  } catch (err) {
    // Missing, malformed, or unavailable storage: keep the default coordinates.
  }
}

const GEOLOCATION_ERRORS = {
  1: "Location permission denied. Enter coordinates manually.",
  2: "Location unavailable. Enter coordinates manually.",
  3: "Location request timed out. Try again.",
};

document.getElementById("useLocation").addEventListener("click", () => {
  const statusEl = document.getElementById("locationStatus");
  if (!navigator.geolocation) {
    statusEl.textContent = "Geolocation is not supported in this browser.";
    return;
  }
  statusEl.textContent = "Requesting location…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById("lat").value = pos.coords.latitude.toFixed(4);
      document.getElementById("lon").value = pos.coords.longitude.toFixed(4);
      statusEl.textContent = "";
      fetchPasses();
    },
    (err) => {
      statusEl.textContent = GEOLOCATION_ERRORS[err.code] || "Could not get location.";
    },
    { timeout: 10000, maximumAge: 300000 }
  );
});

// --- Satellite search ---

const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
let searchMatches = [];
let activeIndex = -1;

function setSearchOpen(open) {
  searchResults.hidden = !open;
  searchInput.setAttribute("aria-expanded", String(open));
  if (!open) {
    activeIndex = -1;
    searchInput.removeAttribute("aria-activedescendant");
  }
}

function renderSearchResults() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    searchMatches = [];
    setSearchOpen(false);
    return;
  }
  searchMatches = latestSatellitePositions.filter(s =>
    s.name.toLowerCase().includes(query) || String(s.norad_id ?? "").includes(query)
  );
  activeIndex = searchMatches.length ? 0 : -1;

  searchResults.replaceChildren(...(searchMatches.length
    ? searchMatches.map((sat, i) => {
        const option = document.createElement("div");
        option.className = "search-option";
        option.id = `search-option-${i}`;
        option.setAttribute("role", "option");
        option.dataset.index = i;
        const name = document.createElement("span");
        name.textContent = sat.name;
        const norad = document.createElement("span");
        norad.className = "norad";
        norad.textContent = sat.norad_id ?? "";
        option.append(name, norad);
        return option;
      })
    : [Object.assign(document.createElement("div"), { className: "search-empty", textContent: "No matching satellites" })]
  ));
  setSearchOpen(true);
  updateActiveOption();
}

function updateActiveOption() {
  searchResults.querySelectorAll(".search-option").forEach((el, i) => {
    el.setAttribute("aria-selected", String(i === activeIndex));
  });
  if (activeIndex < 0) {
    searchInput.removeAttribute("aria-activedescendant");
    return;
  }
  const activeEl = document.getElementById(`search-option-${activeIndex}`);
  searchInput.setAttribute("aria-activedescendant", activeEl.id);
  activeEl.scrollIntoView({ block: "nearest" });
}

function clearSearch() {
  searchInput.value = "";
  searchMatches = [];
  setSearchOpen(false);
}

function selectSearchResult(index) {
  const match = searchMatches[index];
  if (!match) return;
  // Use the freshest position in case the list was built before the last refresh.
  const sat = latestSatellitePositions.find(s => s.name === match.name) || match;
  clearSearch();
  searchInput.blur();
  showSatelliteDetails(sat, { flyTo: true });
}

searchInput.addEventListener("input", renderSearchResults);

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!searchMatches.length) return;
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    activeIndex = (activeIndex + step + searchMatches.length) % searchMatches.length;
    updateActiveOption();
  } else if (e.key === "Enter") {
    e.preventDefault();
    selectSearchResult(activeIndex);
  } else if (e.key === "Escape") {
    e.preventDefault();
    clearSearch();
  }
});

searchInput.addEventListener("blur", () => setSearchOpen(false));
searchInput.addEventListener("focus", renderSearchResults);

// Keep focus in the input while clicking an option, so blur doesn't close the list first.
searchResults.addEventListener("mousedown", (e) => e.preventDefault());
searchResults.addEventListener("click", (e) => {
  const option = e.target.closest(".search-option");
  if (option) selectSearchResult(Number(option.dataset.index));
});

// --- Keyboard shortcuts ---

function isTypingTarget(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !isTypingTarget(document.activeElement) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    searchInput.focus();
  } else if (e.key === "Escape" && document.activeElement !== searchInput) {
    if (detailsPanel.classList.contains("open")) closeDetails();
    else if (mobileLayout.matches && controlsPanel.classList.contains("open")) closePasses();
  }
});