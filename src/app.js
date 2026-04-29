import {
  sweep,
  peakForce,
  minForce,
  handlePos,
  handleBracketPos,
  weightBracketPos,
} from "./physics.js";
import { anatomy, shoulderPos, solveArmIK } from "./body.js";
import { renderScene } from "./render.js";
import { renderPlot } from "./plot.js";
import { decodeConfig, encodeConfig } from "./config-codec.js";
import {
  defaultVoltraPoints,
  normalizeVoltraPoints,
  resampleVoltraPoints,
} from "./voltra-curve.js";

const DEG = Math.PI / 180;
const G = 9.80665;

// Defaults sized to the RX Arms product page: 579 mm arm depth, with handle
// and force-curve/weight extensions set up as a horizontal jammer press.
// Tune freely in the UI.
const defaultState = () => ({
  mode: "plate",
  pivot: { x: 0, y: 1.3 },
  // Main arm: rack pivot → handle bracket at the far end.
  lArm: 0.579,
  // Weight bracket position along the main arm (distance from pivot).
  lWeightMount: 0.29,
  // Sub-arms extending from each bracket.
  lHandle: 0.29,    // ~half the main arm length, matches the real arm
  aHandle: 0,       // degrees: bracket rotation, 0 = inline with main arm
  lWeight: 0.45,
  aWeight: -60,     // default: peg angled down-and-back from the main arm
  plateKg: 40,
  plateKgBracket: 0,
  stackKg: 40,
  cableMA: 1,
  voltraMaxKgf: 150,
  voltraPointCount: 7,
  voltraPoints: defaultVoltraPoints(7, 40),
  pulley: { x: -0.9, y: 0.4 },
  armMassKg: 6,
  armComFrac: 0.45,
  romStart: -30,
  romEnd: 30,
  currentAngle: 0,
  forceDir: "perpMain",
  xAxis: "angle",
  unit: "kgf",
  overlay: "none",
  animate: false,
  // Body / bench
  showBody: true,
  userHeight: 1.80,     // metres
  benchAngle: 0,        // degrees from horizontal (0 = flat, 90 = vertical)
  hipX: 0.85,           // hip pivot position in world coords
  hipY: 0.50,           // bench top height at hip
});

const state = defaultState();

function physicsState(s) {
  return {
    ...s,
    aHandle: s.aHandle * DEG,
    aWeight: s.aWeight * DEG,
    romStart: s.romStart * DEG,
    romEnd: s.romEnd * DEG,
  };
}

const $ = (sel) => document.querySelector(sel);
const sceneCanvas = $("#scene");
const plotCanvas = $("#plot");
let sceneMeta = null;
let plotMeta = null;
let activeSceneHandle = null;
let activeVoltraPoint = null;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeDeg(deg) {
  let out = ((deg + 180) % 360 + 360) % 360 - 180;
  if (out === -180) out = 180;
  return out;
}

function clampToInput(id, value) {
  const el = $(`#${id}`);
  if (!el) return value;
  const min = Number.isFinite(+el.min) ? +el.min : -Infinity;
  const max = Number.isFinite(+el.max) ? +el.max : Infinity;
  return clamp(value, min, max);
}

// Match internal canvas resolution to the rendered size in device pixels.
// The renderers work in device pixels directly — no dpr transform — so on
// high-DPI displays we still draw at native resolution but the coordinate
// math stays consistent with `canvas.width` / `canvas.height`.
function fitCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  c.width = Math.max(1, Math.floor(rect.width * dpr));
  c.height = Math.max(1, Math.floor(rect.height * dpr));
}

function resizeAll() {
  fitCanvas(sceneCanvas);
  fitCanvas(plotCanvas);
  redraw();
}

function formatVal(key, v) {
  switch (key) {
    case "lArm":
    case "lWeightMount":
    case "lHandle":
    case "lWeight":
      return `${(v * 100).toFixed(0)} cm`;
    case "aHandle":
    case "aWeight":
    case "romStart":
    case "romEnd":
    case "currentAngle":
      return `${(+v).toFixed(0)}°`;
    case "plateKg":
    case "plateKgBracket":
    case "stackKg":
    case "armMassKg":
    case "voltraMaxKgf":
      return `${(+v).toFixed(0)} kg`;
    case "armComFrac":
      return (+v).toFixed(2);
    case "cableMA":
      return `${(+v).toFixed(1)}×`;
    case "pivotY":
    case "pulleyX":
    case "pulleyY":
    case "hipX":
    case "hipY":
      return `${(+v).toFixed(2)} m`;
    case "userHeightCm":
      return `${(+v).toFixed(0)} cm`;
    case "benchAngle":
      return `${(+v).toFixed(0)}°`;
    default:
      return String(v);
  }
}

function setState(key, value) {
  if (key === "pivotY") state.pivot.y = value;
  else if (key === "pulleyX") state.pulley.x = value;
  else if (key === "pulleyY") state.pulley.y = value;
  else if (key === "userHeightCm") state.userHeight = value / 100;
  else if (key === "voltraMaxKgf") {
    state.voltraMaxKgf = value;
    state.voltraPoints = normalizeVoltraPoints(state.voltraPoints, value);
  }
  else state[key] = value;
}

function getStateVal(key) {
  if (key === "pivotY") return state.pivot.y;
  if (key === "pulleyX") return state.pulley.x;
  if (key === "pulleyY") return state.pulley.y;
  if (key === "userHeightCm") return state.userHeight * 100;
  return state[key];
}

function bindSlider(id) {
  const el = $(`#${id}`);
  const out = $(`#${id}-val`);
  const sync = () => {
    const v = +el.value;
    setState(id, v);
    out.textContent = formatVal(id, v);
    redraw();
  };
  el.value = getStateVal(id);
  el.addEventListener("input", sync);
  out.textContent = formatVal(id, getStateVal(id));
}

function syncControl(id) {
  const el = $(`#${id}`);
  if (!el) return;
  const v = getStateVal(id);
  el.value = v;
  const out = $(`#${id}-val`);
  if (out) out.textContent = formatVal(id, v);
}

function setControlValue(id, value) {
  const next = clampToInput(id, value);
  setState(id, next);
  syncControl(id);
}

function syncAllControls() {
  syncFixedReadouts();
  SLIDER_IDS.forEach(syncControl);
  $("#forceDir").value = state.forceDir;
  $("#xAxis").value = state.xAxis;
  $("#unit").value = state.unit;
  $("#overlay").value = state.overlay;
  $("#voltraPointCount").value = String(state.voltraPointCount);
  $("#animate").checked = state.animate;
  $("#showBody").checked = state.showBody;
  document.querySelectorAll(`input[name="mode"]`).forEach((el) => {
    el.checked = el.value === state.mode;
  });
}

function bindRadio(name, key) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
    el.checked = el.value === state[key];
    el.addEventListener("change", () => {
      if (el.checked) {
        state[key] = el.value;
        redraw();
      }
    });
  });
}

function bindSelect(id, key) {
  const el = $(`#${id}`);
  el.value = state[key];
  el.addEventListener("change", () => {
    state[key] = el.value;
    redraw();
  });
}

function bindCheckbox(id, key, onChange) {
  const el = $(`#${id}`);
  el.checked = !!state[key];
  el.addEventListener("change", () => {
    state[key] = el.checked;
    if (onChange) onChange();
    redraw();
  });
}

function canvasPointFromEvent(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left) * (canvas.width / rect.width),
    y: (ev.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function hitSceneHandle(p) {
  if (!sceneMeta?.handles?.length) return null;
  let best = null;
  let bestD2 = Infinity;
  for (const h of sceneMeta.handles) {
    const dx = p.x - h.x;
    const dy = p.y - h.y;
    const d2 = dx * dx + dy * dy;
    const r = h.hitRadius ?? 16;
    if (d2 <= r * r && d2 < bestD2) {
      best = h;
      bestD2 = d2;
    }
  }
  return best;
}

function angleDegFrom(anchor, p) {
  return Math.atan2(p.y - anchor.y, p.x - anchor.x) / DEG;
}

function updateSceneHandleFromEvent(ev) {
  if (!activeSceneHandle || !sceneMeta) return;

  const screen = canvasPointFromEvent(sceneCanvas, ev);
  const world = sceneMeta.screenToWorld(screen);
  const ps = physicsState(state);
  const theta = state.currentAngle * DEG;

  switch (activeSceneHandle.id) {
    case "pivotY":
      setControlValue("pivotY", world.y);
      break;

    case "currentAngle": {
      const deg = angleDegFrom(state.pivot, world);
      setControlValue("currentAngle", deg);
      break;
    }

    case "aHandle": {
      if (state.lHandle <= 1e-6) break;
      const anchor = handleBracketPos(ps, theta);
      const deg = normalizeDeg(angleDegFrom(anchor, world) - state.currentAngle);
      setControlValue("aHandle", deg);
      break;
    }

    case "aWeight": {
      if (state.lWeight <= 1e-6) break;
      const anchor = weightBracketPos(ps, theta);
      const deg = normalizeDeg(angleDegFrom(anchor, world) - state.currentAngle);
      setControlValue("aWeight", deg);
      break;
    }

    case "pulley":
      setControlValue("pulleyX", world.x);
      setControlValue("pulleyY", world.y);
      break;

    case "benchHip":
      setControlValue("hipX", world.x);
      setControlValue("hipY", world.y);
      break;

    case "benchAngle": {
      const dx = world.x - state.hipX;
      const dy = world.y - state.hipY;
      const deg = Math.atan2(dy, -dx || 1e-9) / DEG;
      setControlValue("benchAngle", deg);
      break;
    }

    default:
      break;
  }

  redraw();
}

function bindSceneEditor() {
  sceneCanvas.addEventListener("pointerdown", (ev) => {
    const hit = hitSceneHandle(canvasPointFromEvent(sceneCanvas, ev));
    if (!hit) return;

    ev.preventDefault();
    activeSceneHandle = hit;
    sceneCanvas.setPointerCapture(ev.pointerId);
    sceneCanvas.style.cursor = "grabbing";
    updateSceneHandleFromEvent(ev);
  });

  sceneCanvas.addEventListener("pointermove", (ev) => {
    if (activeSceneHandle) {
      ev.preventDefault();
      updateSceneHandleFromEvent(ev);
      return;
    }

    const hit = hitSceneHandle(canvasPointFromEvent(sceneCanvas, ev));
    sceneCanvas.style.cursor = hit ? "grab" : "";
  });

  const endDrag = (ev) => {
    if (!activeSceneHandle) return;
    activeSceneHandle = null;
    if (sceneCanvas.hasPointerCapture(ev.pointerId)) {
      sceneCanvas.releasePointerCapture(ev.pointerId);
    }
    sceneCanvas.style.cursor = "";
  };

  sceneCanvas.addEventListener("pointerup", endDrag);
  sceneCanvas.addEventListener("pointercancel", endDrag);
}

function hitVoltraPoint(p) {
  if (!plotMeta?.controlPoints?.length) return null;
  let best = null;
  let bestD2 = Infinity;
  for (const cp of plotMeta.controlPoints) {
    const dx = p.x - cp.x;
    const dy = p.y - cp.y;
    const d2 = dx * dx + dy * dy;
    const r = cp.hitRadius ?? 16;
    if (d2 <= r * r && d2 < bestD2) {
      best = cp;
      bestD2 = d2;
    }
  }
  return best;
}

function updateVoltraPointFromEvent(ev) {
  if (state.mode !== "voltra" || activeVoltraPoint == null || !plotMeta) return;

  const p = canvasPointFromEvent(plotCanvas, ev);
  const pts = state.voltraPoints.map((pt) => ({ ...pt }));
  const i = activeVoltraPoint;
  const minGap = 0.035;

  let nextT = pts[i].t;
  if (i === 0) nextT = 0;
  else if (i === pts.length - 1) nextT = 1;
  else {
    const lo = pts[i - 1].t + minGap;
    const hi = pts[i + 1].t - minGap;
    nextT = clamp(plotMeta.xToT(p.x), lo, hi);
  }

  pts[i] = {
    t: nextT,
    fKgf: clamp(plotMeta.yToForceKgf(p.y), 0, state.voltraMaxKgf),
  };
  state.voltraPoints = normalizeVoltraPoints(pts, state.voltraMaxKgf);
  redraw();
}

function bindVoltraPlotEditor() {
  plotCanvas.addEventListener("pointerdown", (ev) => {
    if (state.mode !== "voltra") return;
    const hit = hitVoltraPoint(canvasPointFromEvent(plotCanvas, ev));
    if (!hit) return;

    ev.preventDefault();
    activeVoltraPoint = hit.index;
    plotCanvas.setPointerCapture(ev.pointerId);
    plotCanvas.style.cursor = "grabbing";
    updateVoltraPointFromEvent(ev);
  });

  plotCanvas.addEventListener("pointermove", (ev) => {
    if (activeVoltraPoint != null) {
      ev.preventDefault();
      updateVoltraPointFromEvent(ev);
      return;
    }

    if (state.mode !== "voltra") {
      plotCanvas.style.cursor = "";
      return;
    }
    const hit = hitVoltraPoint(canvasPointFromEvent(plotCanvas, ev));
    plotCanvas.style.cursor = hit ? "grab" : "crosshair";
  });

  const endDrag = (ev) => {
    if (activeVoltraPoint == null) return;
    activeVoltraPoint = null;
    if (plotCanvas.hasPointerCapture(ev.pointerId)) {
      plotCanvas.releasePointerCapture(ev.pointerId);
    }
    plotCanvas.style.cursor = state.mode === "voltra" ? "crosshair" : "";
  };
  plotCanvas.addEventListener("pointerup", endDrag);
  plotCanvas.addEventListener("pointercancel", endDrag);
}

function bindVoltraControls() {
  const count = $("#voltraPointCount");
  count.value = String(state.voltraPointCount);
  count.addEventListener("change", () => {
    state.voltraPointCount = +count.value;
    state.voltraPoints = resampleVoltraPoints(
      state.voltraPoints,
      state.voltraPointCount,
      state.voltraMaxKgf,
    );
    redraw();
  });

  $("#voltraReset").addEventListener("click", () => {
    state.voltraPoints = defaultVoltraPoints(state.voltraPointCount, state.stackKg);
    redraw();
  });

  $("#voltraFlat").addEventListener("click", () => {
    const pts = normalizeVoltraPoints(state.voltraPoints, state.voltraMaxKgf);
    const avg = pts.reduce((sum, p) => sum + p.fKgf, 0) / pts.length;
    state.voltraPoints = defaultVoltraPoints(state.voltraPointCount, avg);
    redraw();
  });
}

function syncConfigString(force = false) {
  const el = $("#configString");
  if (!el) return;
  if (force || document.activeElement !== el) {
    el.value = encodeConfig(state);
  }
}

function setConfigStatus(text, isError = false) {
  const el = $("#configStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function applyConfig(nextState) {
  Object.assign(state, defaultState(), nextState);
  syncAllControls();
  redraw();
  syncConfigString(true);
}

function bindConfigControls() {
  $("#configCopy").addEventListener("click", async () => {
    syncConfigString(true);
    const el = $("#configString");
    try {
      await navigator.clipboard.writeText(el.value);
      setConfigStatus("Copied");
    } catch {
      el.select();
      setConfigStatus("Selected");
    }
  });

  $("#configLoad").addEventListener("click", () => {
    try {
      applyConfig(decodeConfig($("#configString").value));
      setConfigStatus("Loaded");
    } catch {
      setConfigStatus("Invalid config", true);
    }
  });

  $("#configString").addEventListener("input", () => setConfigStatus(""));
}

function loadConfigFromLocation() {
  if (!location.hash && !location.search) return;
  try {
    Object.assign(state, defaultState(), decodeConfig(location.href));
  } catch {
    // Ignore invalid/missing URL config and keep defaults.
  }
}

function redraw() {
  const ps = physicsState(state);
  const samples = sweep(ps, 181);

  document.body.classList.toggle("mode-plate", state.mode === "plate");
  document.body.classList.toggle("mode-cable", state.mode === "cable");
  document.body.classList.toggle("mode-voltra", state.mode === "voltra");

  const currentTheta = state.currentAngle * DEG;
  sceneMeta = renderScene(sceneCanvas, ps, currentTheta);

  const span = state.romEnd - state.romStart;
  const rawIdx = span !== 0
    ? Math.round(((state.currentAngle - state.romStart) / span) * (samples.length - 1))
    : 0;
  const idx = Math.max(0, Math.min(samples.length - 1, rawIdx));

  plotMeta = renderPlot(plotCanvas, samples, {
    xAxis: state.xAxis,
    unit: state.unit,
    overlay: state.overlay,
    currentIndex: idx,
    editableVoltra: state.mode === "voltra",
    voltraPoints: state.voltraPoints,
    voltraMaxKgf: state.voltraMaxKgf,
  });

  const peak = peakForce(samples);
  const low = minForce(samples);
  const cur = samples[idx];
  const variation = peak.fN > 0 ? (low.fN / peak.fN) * 100 : 0;
  const fmt = (fN) =>
    state.unit === "kgf" ? `${(fN / G).toFixed(1)} kgf` : `${fN.toFixed(0)} N`;

  $("#stat-peak").textContent = fmt(peak.fN);
  $("#stat-low").textContent = fmt(low.fN);
  $("#stat-current").textContent = fmt(cur.fN);
  $("#stat-variation").textContent = `${variation.toFixed(0)}%`;
  // Handle position. X is horizontal distance from the rack face (the inner
  // face sits at pivot.x + 0.02 in the current rack model). Y is height
  // above floor (floor = world y=0).
  const h = handlePos(ps, currentTheta);
  const rackFaceX = state.pivot.x + 0.02;
  $("#stat-handle-x").textContent = `${((h.x - rackFaceX) * 100).toFixed(0)} cm`;
  $("#stat-handle-y").textContent = `${(h.y * 100).toFixed(0)} cm`;

  // Arm-reach indicator
  if (state.showBody) {
    const anat = anatomy(state.userHeight);
    const sh = shoulderPos(state);
    const ik = solveArmIK(sh, h, anat.upper, anat.forearm);
    const label = ik.reachable
      ? `${ik.stretchPct.toFixed(0)}%`
      : `out of reach`;
    $("#stat-arm-reach").textContent = label;
    $("#stat-arm-reach").style.color = ik.reachable ? "" : "#ef476f";
  } else {
    $("#stat-arm-reach").textContent = "—";
    $("#stat-arm-reach").style.color = "";
  }

  syncConfigString();
}

const SLIDER_IDS = [
  "lArm",
  "lHandle", "aHandle", "aWeight",
  "pivotY", "romStart", "romEnd", "currentAngle",
  "plateKg", "plateKgBracket", "stackKg", "cableMA",
  "voltraMaxKgf",
  "pulleyX", "pulleyY", "armMassKg", "armComFrac",
  "userHeightCm", "benchAngle", "hipX", "hipY",
];

const FIXED_READOUT_IDS = ["lWeightMount", "lWeight"];

function syncFixedReadouts() {
  FIXED_READOUT_IDS.forEach((id) => {
    const out = $(`#${id}-val`);
    if (out) out.textContent = formatVal(id, getStateVal(id));
  });
}

let animReq = null;
function toggleAnimation() {
  if (state.animate && animReq == null) {
    let dir = 1;
    const step = () => {
      const span = state.romEnd - state.romStart;
      const rate = span * 0.012;
      state.currentAngle += dir * rate;
      if (state.currentAngle >= state.romEnd) {
        state.currentAngle = state.romEnd;
        dir = -1;
      } else if (state.currentAngle <= state.romStart) {
        state.currentAngle = state.romStart;
        dir = 1;
      }
      const el = $("#currentAngle");
      el.value = state.currentAngle;
      $("#currentAngle-val").textContent = formatVal("currentAngle", state.currentAngle);
      redraw();
      animReq = state.animate ? requestAnimationFrame(step) : null;
    };
    animReq = requestAnimationFrame(step);
  } else if (!state.animate && animReq != null) {
    cancelAnimationFrame(animReq);
    animReq = null;
  }
}

function resetAll() {
  Object.assign(state, defaultState());
  syncAllControls();
  redraw();
  syncConfigString(true);
  setConfigStatus("");
}

function initApp() {
  loadConfigFromLocation();
  syncFixedReadouts();
  SLIDER_IDS.forEach(bindSlider);
  bindRadio("mode", "mode");
  bindSelect("forceDir", "forceDir");
  bindSelect("xAxis", "xAxis");
  bindSelect("unit", "unit");
  bindSelect("overlay", "overlay");
  bindCheckbox("animate", "animate", toggleAnimation);
  bindCheckbox("showBody", "showBody");
  bindSceneEditor();
  bindVoltraControls();
  bindVoltraPlotEditor();
  bindConfigControls();
  $("#reset").addEventListener("click", resetAll);
  window.addEventListener("resize", resizeAll);
  window.visualViewport?.addEventListener("resize", resizeAll);
  resizeAll();
}

document.addEventListener("DOMContentLoaded", initApp);
