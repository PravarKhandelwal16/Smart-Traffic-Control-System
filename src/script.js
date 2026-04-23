const MAX_GREEN_TIME     = 15;
const MIN_GREEN_TIME     = 4;
const SEC_PER_VEHICLE    = 2;
const YELLOW_TIME        = 3;
const ALL_RED_TIME       = 1;
const DENSITY_MEDIUM     = 3;
const DENSITY_HIGH       = 6;
const MAX_QUEUE_SIZE     = 8;
const TICK_MS            = 1000;
const RELEASE_MS         = 950;
const PASS_DURATION_MS   = 1300;
const AUTO_SPAWN_MS      = 1600;
const MANUAL_SPAWN_COUNT = 5;
const SLIDE_TRANSITION   = "top 0.32s ease, left 0.32s ease";

const NORTH = "north";
const SOUTH = "south";
const EAST  = "east";
const WEST  = "west";

const DIRS = [NORTH, SOUTH, EAST, WEST];

const LANE = {
  [NORTH]: {
    orientation: "vertical",
    queueStartX: 226,
    queueStartY: 182,
    spacingX:    0,
    spacingY:   -30,
    moveAnim:   "anim-north",
    countId:    "countNorth",  barId:     "barNorth",
    densityId:  "densityNorth", cardId:   "statsNorth",
    lightIds: { red: "lightNorthRed", yellow: "lightNorthYellow", green: "lightNorthGreen" },
  },
  [SOUTH]: {
    orientation: "vertical",
    queueStartX: 280,
    queueStartY: 338,
    spacingX:    0,
    spacingY:   30,
    moveAnim:   "anim-south",
    countId:    "countSouth",  barId:     "barSouth",
    densityId:  "densitySouth", cardId:   "statsSouth",
    lightIds: { red: "lightSouthRed", yellow: "lightSouthYellow", green: "lightSouthGreen" },
  },
  [EAST]: {
    orientation: "horizontal",
    queueStartX: 320,
    queueStartY: 229,
    spacingX:    30,
    spacingY:    0,
    moveAnim:   "anim-east",
    countId:    "countEast",  barId:     "barEast",
    densityId:  "densityEast", cardId:   "statsEast",
    lightIds: { red: "lightEastRed", yellow: "lightEastYellow", green: "lightEastGreen" },
  },
  [WEST]: {
    orientation: "horizontal",
    queueStartX: 184,
    queueStartY: 279,
    spacingX:   -30,
    spacingY:    0,
    moveAnim:   "anim-west",
    countId:    "countWest",  barId:     "barWest",
    densityId:  "densityWest", cardId:   "statsWest",
    lightIds: { red: "lightWestRed", yellow: "lightWestYellow", green: "lightWestGreen" },
  },
};

const queues = { [NORTH]: [], [SOUTH]: [], [EAST]: [], [WEST]: [] };

const signals = { [NORTH]: "red", [SOUTH]: "red", [EAST]: "red", [WEST]: "red" };

let activeDir       = NORTH;
let countdown       = 0;
let isRunning       = false;
let isYellow        = false;
let isAllRed        = false;
let speedMult       = 1;

let totalSpawned    = 0;
let totalThrough    = 0;
let cycleCount      = 0;
let totalWait       = 0;
let waitSamples     = 0;

let tickInterval    = null;
let spawnInterval   = null;
let releaseInterval = null;

let vehicleIdCounter = 0;

let vehicleLayer = null;
let logBox       = null;

document.addEventListener("DOMContentLoaded", () => {
  vehicleLayer = document.getElementById("vehicleLayer");
  logBox       = document.getElementById("logBox");

  document.getElementById("btnStart").addEventListener("click", startSim);
  document.getElementById("btnPause").addEventListener("click", pauseSim);
  document.getElementById("btnReset").addEventListener("click", resetSim);

  document.getElementById("spawnNorth").addEventListener("click", () => spawnVehicles(NORTH, MANUAL_SPAWN_COUNT));
  document.getElementById("spawnSouth").addEventListener("click", () => spawnVehicles(SOUTH, MANUAL_SPAWN_COUNT));
  document.getElementById("spawnEast") .addEventListener("click", () => spawnVehicles(EAST,  MANUAL_SPAWN_COUNT));
  document.getElementById("spawnWest") .addEventListener("click", () => spawnVehicles(WEST,  MANUAL_SPAWN_COUNT));

  // Speed slider
  const slider = document.getElementById("speedSlider");
  slider.addEventListener("input", () => {
    speedMult = parseFloat(slider.value);
    document.getElementById("speedValue").textContent = speedMult + "×";
    addLog(`Speed → ${speedMult}×`, "yellow-log");
    if (isRunning) restartIntervals(); // apply new speed immediately
  });

  // All signals red to start
  DIRS.forEach(d => setSignal(d, "red"));

  // Seed the lanes so the canvas isn't empty on load
  spawnVehicles(NORTH, 3);
  spawnVehicles(SOUTH, 2);
  spawnVehicles(EAST,  4);
  spawnVehicles(WEST,  1);

  addLog("System ready. Press ▶ Start.", "green-log");
  updateUI();
});


/* ──────────────────────────────────────────────────────────────
   SECTION 5 · SIMULATION LIFECYCLE
   ────────────────────────────────────────────────────────────── */

/** Start (or resume) the simulation. */
function startSim() {
  if (isRunning) return;
  isRunning = true;

  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnPause").disabled = false;

  chooseNextGreen();   // pick first green lane
  restartIntervals();  // start tick + auto-spawn intervals

  addLog("▶ Simulation started.", "green-log");
}

/** Pause: freeze all intervals, cars stay in place. */
function pauseSim() {
  if (!isRunning) return;
  isRunning = false;

  clearInterval(tickInterval);
  clearInterval(spawnInterval);
  clearInterval(releaseInterval);
  tickInterval = spawnInterval = releaseInterval = null;

  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnPause").disabled = true;

  addLog("⏸ Paused.", "yellow-log");
}

/** Full reset: clear everything and re-seed. */
function resetSim() {
  clearInterval(tickInterval);
  clearInterval(spawnInterval);
  clearInterval(releaseInterval);
  tickInterval = spawnInterval = releaseInterval = null;

  isRunning = false;
  isYellow  = false;

  DIRS.forEach(d => {
    queues[d] = [];
    setSignal(d, "red");
    document.getElementById(LANE[d].cardId).classList.remove("active");
  });

  totalSpawned = totalThrough = cycleCount = totalWait = waitSamples = countdown = 0;
  activeDir = NORTH;

  vehicleLayer.innerHTML = "";

  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnPause").disabled = true;
  document.getElementById("countdown").textContent      = "--";
  document.getElementById("activeDirection").textContent = "--";
  document.getElementById("activeGreenTime").textContent = "--";

  spawnVehicles(NORTH, 3);
  spawnVehicles(SOUTH, 2);
  spawnVehicles(EAST,  4);
  spawnVehicles(WEST,  1);

  logBox.innerHTML = '<p class="log-entry">System reset.</p>';
  addLog("↺ Ready. Press ▶ Start.", "green-log");
  updateUI();
}


function restartIntervals() {
  clearInterval(tickInterval);
  clearInterval(spawnInterval);

  tickInterval  = setInterval(tick,      Math.round(TICK_MS      / speedMult));
  spawnInterval = setInterval(autoSpawn, Math.round(AUTO_SPAWN_MS / speedMult));
}

function startReleasing(dir) {
  clearInterval(releaseInterval);
  const rate = Math.round(RELEASE_MS / speedMult);
  releaseInterval = setInterval(() => {
    if (!isRunning || signals[dir] !== "green") { stopReleasing(); return; }
    releaseOneCar(dir);
  }, rate);
}

function stopReleasing() {
  clearInterval(releaseInterval);
  releaseInterval = null;
}


function tick() {
  countdown--;
  document.getElementById("countdown").textContent = Math.max(0, countdown) + "s";

  if (countdown <= 0) {
    if (!isYellow && !isAllRed) {
      goYellow();

    } else if (isYellow) {
      isYellow = false;
      isAllRed = true;
      stopReleasing();
      DIRS.forEach(d => setSignal(d, "red"));   // ALL lanes → red
      setPhase("allred");       // update phase badge
      countdown = ALL_RED_TIME;
      document.getElementById("activeDirection").textContent = "---";
      document.getElementById("activeFormula").textContent = "";
      document.getElementById("countdown").textContent = countdown + "s";
      addLog("🔴 All-red buffer (" + ALL_RED_TIME + "s)…", "red-log");

    } else if (isAllRed) {
      // ── All-red buffer over → run Greedy Algorithm → next GREEN ─
      isAllRed = false;
      chooseNextGreen();   // §1 greedy selection + §2 adaptive timer
      cycleCount++;
      document.getElementById("cycleCount").textContent = cycleCount;
    }
  }

  updateUI();
}

/** Switch the current active lane to yellow. */
function goYellow() {
  isYellow = true;
  stopReleasing();              // no more cars released during yellow
  setSignal(activeDir, "yellow");
  setPhase("yellow");           // update phase badge
  countdown = YELLOW_TIME;
  addLog(`⚠ ${cap(activeDir)} → Yellow (${YELLOW_TIME}s)`, "yellow-log");
}

function chooseNextGreen() {
  let maxCount = -1;
  let chosen   = DIRS[0];
  DIRS.forEach(d => {
    const n = queues[d].length;
    if (n > maxCount) { maxCount = n; chosen = d; }
  });
  DIRS.forEach(d => setSignal(d, d === chosen ? "green" : "red"));
  activeDir = chosen;
  const greenTime = calcGreenTime(maxCount);
  countdown = greenTime;
  document.getElementById("activeDirection").textContent = cap(chosen);
  document.getElementById("activeGreenTime").textContent = greenTime + "s";
  document.getElementById("countdown").textContent       = countdown + "s";
  DIRS.forEach(d => document.getElementById(LANE[d].cardId).classList.toggle("active", d === chosen));
  addLog(`🟢 ${cap(chosen)} GREEN — ${greenTime}s | queue=${maxCount} | formula=min(${MAX_GREEN_TIME}, ${maxCount}×${SEC_PER_VEHICLE})`, "green-log");
  document.getElementById("activeFormula").textContent = `min(${MAX_GREEN_TIME}, ${maxCount}×${SEC_PER_VEHICLE}) = ${greenTime}s`;
  setPhase("green");
  startReleasing(chosen);
}

function calcGreenTime(count) {
  return Math.max(MIN_GREEN_TIME, Math.min(MAX_GREEN_TIME, count * SEC_PER_VEHICLE));
}


function releaseOneCar(dir) {
  if (queues[dir].length === 0) return;
  const meta    = LANE[dir];
  const vehicle = queues[dir].shift();
  const el      = vehicle.el;
  if (!el || !el.parentNode) { updateUI(); return; }
  el.classList.remove("waiting");
  el.classList.add("moving");
  el.style.transition = "none";
  const duration = Math.round(PASS_DURATION_MS / speedMult);
  el.style.animationDuration = duration + "ms";
  el.classList.add(meta.moveAnim);
  totalThrough++;
  totalWait += Math.max(1, countdown);
  waitSamples++;
  updateStatsPanel();
  setTimeout(() => { el.remove(); }, duration + 60);
  repositionQueue(dir);
  updateUI();
}

function spawnVehicles(dir, count) {
  const meta  = LANE[dir];
  const queue = queues[dir];
  for (let i = 0; i < count; i++) {
    if (queue.length >= MAX_QUEUE_SIZE) break;
    const pos = getPos(dir, queue.length);
    const el  = document.createElement("div");
    el.id        = "v" + vehicleIdCounter++;
    el.className = `vehicle ${meta.orientation} waiting`;
    el.style.transition = "none";
    el.style.left = pos.x + "px";
    el.style.top  = pos.y + "px";
    vehicleLayer.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = SLIDE_TRANSITION; }));
    queue.push({ id: el.id, el });
    totalSpawned++;
  }
  updateUI();
}

function autoSpawn() {
  const numLanes = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < numLanes; i++) {
    spawnVehicles(DIRS[Math.floor(Math.random() * 4)], 1 + Math.floor(Math.random() * 2));
  }
}


function getPos(dir, index) {
  const m = LANE[dir];
  return { x: m.queueStartX + index * m.spacingX, y: m.queueStartY + index * m.spacingY };
}

function repositionQueue(dir) {
  queues[dir].forEach((v, i) => {
    const p = getPos(dir, i);
    v.el.style.transition = SLIDE_TRANSITION;
    v.el.style.left = p.x + "px";
    v.el.style.top  = p.y + "px";
  });
}


function setSignal(dir, phase) {
  signals[dir] = phase;
  const ids = LANE[dir].lightIds;
  const r = document.getElementById(ids.red);
  const y = document.getElementById(ids.yellow);
  const g = document.getElementById(ids.green);
  r.classList.remove("red-on");
  y.classList.remove("yellow-on");
  g.classList.remove("green-on");
  if (phase === "red")    r.classList.add("red-on");
  if (phase === "yellow") y.classList.add("yellow-on");
  if (phase === "green")  g.classList.add("green-on");
}


/* ──────────────────────────────────────────────────────────────
   SECTION 12 · UI UPDATES
   ────────────────────────────────────────────────────────────── */

/** Refresh all lane cards and the statistics panel. */
function updateUI() {
  const busiestDir = getBusiestDir(); // find most congested lane
  DIRS.forEach(d => updateLaneCard(d, busiestDir));
  updateStatsPanel();
}

/**
 * Update the density card for one lane.
 * Drives: count badge, progress bar, density label,
 *         heat-dot colour, road-arm heat overlay, busiest badge.
 *
 * @param {string} dir        - lane direction
 * @param {string} busiestDir - direction with most vehicles (from getBusiestDir)
 */
function updateLaneCard(dir, busiestDir) {
  const count = queues[dir].length;
  const m     = LANE[dir];

  // ── 1. Live vehicle count number ─────────────────────────────────
  document.getElementById(m.countId).textContent = count;

  // ── 2. Density progress bar (0 → MAX_QUEUE_SIZE = 100%) ─────────
  const pct = Math.min(100, (count / MAX_QUEUE_SIZE) * 100);
  const bar = document.getElementById(m.barId);
  bar.style.width = pct + "%";

  // Determine heat level string: "low" | "medium" | "high"
  let heat = "low";
  if      (count >= DENSITY_HIGH)   heat = "high";
  else if (count >= DENSITY_MEDIUM) heat = "medium";

  // Colour the bar: green → yellow → red
  bar.classList.remove("medium", "high");
  if      (heat === "high")   bar.classList.add("high");
  else if (heat === "medium") bar.classList.add("medium");

  // ── 3. Density text label (Low / Medium / High) ────────────────
  const labelMap = { low: "Low", medium: "Medium", high: "High" };
  document.getElementById(m.densityId).textContent = labelMap[heat];

  // ── 4. Heat dot (small coloured circle in lane card header) ────
  const dot = document.getElementById("heatDot" + cap(dir));
  dot.classList.remove("heat-dot-low", "heat-dot-medium", "heat-dot-high");
  dot.classList.add("heat-dot-" + heat);

  // ── 5. Road-arm heat overlay (colour tint on the canvas) ───────
  // Overlay ID matches: heatNorth, heatSouth, heatEast, heatWest
  const overlay = document.getElementById("heat" + cap(dir));
  overlay.classList.remove("heat-low", "heat-medium", "heat-high");
  if (count > 0) {
    // Only show tint when there are actually vehicles waiting
    overlay.classList.add("heat-" + heat);
  }

  // ── 6. Busiest-lane badge ─────────────────────────────────────
  // Show "🔥 BUSIEST" only on the lane with the most vehicles.
  // If count is 0, don't label any lane as busiest.
  const badge = document.getElementById("busiest" + cap(dir));
  const isBusiest = dir === busiestDir && count > 0;
  badge.classList.toggle("visible", isBusiest);

  // Also highlight the lane card border for the busiest lane
  // (.active class is reserved for the green signal lane)
  document.getElementById(m.cardId).classList.toggle("busiest", isBusiest);
}

/**
 * Find the direction that currently has the most waiting vehicles.
 * Used to set the busiest-badge and busiest card highlight.
 * Returns null if all queues are empty.
 *
 * @returns {string|null} direction string or null
 */
function getBusiestDir() {
  let max   = 0;
  let found = null;
  DIRS.forEach(d => {
    if (queues[d].length > max) {
      max   = queues[d].length;
      found = d;
    }
  });
  return found; // null when every lane is empty
}

/**
 * Refresh the statistics panel:
 * - Spawned, Passed, Avg Wait, Cycles  (existing)
 * - Efficiency = Passed / Spawned × 100  (new)
 * - Waiting Now = total cars in all queues (new, colour-coded)
 */
function updateStatsPanel() {
  // Basic counters
  document.getElementById("totalVehicles").textContent = totalSpawned;
  document.getElementById("throughput").textContent    = totalThrough;
  document.getElementById("cycleCount").textContent    = cycleCount;

  // Average wait time
  const avg = waitSamples > 0 ? Math.round(totalWait / waitSamples) : 0;
  document.getElementById("avgWait").textContent = avg + "s";

  // Efficiency = how many spawned vehicles have actually passed through (0–100%)
  const efficiency = totalSpawned > 0
    ? Math.round((totalThrough / totalSpawned) * 100)
    : 0;
  document.getElementById("statEfficiency").textContent = efficiency + "%";

  // Total currently waiting across all lanes
  const waitingNow = DIRS.reduce((sum, d) => sum + queues[d].length, 0);
  const waitEl = document.getElementById("statTotal");
  waitEl.textContent = waitingNow;

  // Colour-code the waiting-now number by severity
  waitEl.classList.remove("warn", "alert");
  if      (waitingNow >= DENSITY_HIGH * 2)   waitEl.classList.add("alert"); // many waiting
  else if (waitingNow >= DENSITY_MEDIUM * 2) waitEl.classList.add("warn");
}

/**
 * Append a timestamped entry to the system log.
 * Oldest entries are pruned once count exceeds 30.
 *
 * @param {string} msg      - message text
 * @param {string} cssClass - optional colour class
 */
function addLog(msg, cssClass = "") {
  const p   = document.createElement("p");
  p.className = "log-entry" + (cssClass ? " " + cssClass : "");

  const t = new Date().toLocaleTimeString("en-US", { hour12: false });
  p.textContent = `[${t}] ${msg}`;

  logBox.appendChild(p);

  // Keep only the most recent 30 entries
  const all = logBox.querySelectorAll(".log-entry");
  if (all.length > 30) all[0].remove();

  logBox.scrollTop = logBox.scrollHeight;
}


/* ──────────────────────────────────────────────────────────────
   SECTION 13 · UTILITIES
   ────────────────────────────────────────────────────────────── */

/**
 * Update the Phase badge in the Active Signal panel.
 * Called on every phase transition.
 *
 * @param {string} phase - "green" | "yellow" | "allred" | "red"
 */
function setPhase(phase) {
  const el    = document.getElementById("activePhase");
  const label = phase === "allred" ? "ALL-RED"
              : phase === "green"  ? "GREEN"
              : phase === "yellow" ? "YELLOW"
              : "RED";
  const cls   = phase === "green"  ? "phase-green"
              : phase === "yellow" ? "phase-yellow"
              : "phase-red";

  el.innerHTML = `<span class="phase-badge ${cls}">${label}</span>`;
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}
