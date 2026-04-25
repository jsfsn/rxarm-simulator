import { sweep, peakForce, minForce, handlePos } from "./physics.js";
import { anatomy, shoulderPos, solveArmIK } from "./body.js";
import { renderScene } from "./render.js";
import { renderPlot } from "./plot.js";

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

function redraw() {
  const ps = physicsState(state);
  const samples = sweep(ps, 181);

  document.body.classList.toggle("mode-plate", state.mode === "plate");
  document.body.classList.toggle("mode-cable", state.mode === "cable");

  const currentTheta = state.currentAngle * DEG;
  renderScene(sceneCanvas, ps, currentTheta);

  const span = state.romEnd - state.romStart;
  const rawIdx = span !== 0
    ? Math.round(((state.currentAngle - state.romStart) / span) * (samples.length - 1))
    : 0;
  const idx = Math.max(0, Math.min(samples.length - 1, rawIdx));

  renderPlot(plotCanvas, samples, {
    xAxis: state.xAxis,
    unit: state.unit,
    overlay: state.overlay,
    currentIndex: idx,
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
}

const SLIDER_IDS = [
  "lArm", "lWeightMount",
  "lHandle", "aHandle", "lWeight", "aWeight",
  "pivotY", "romStart", "romEnd", "currentAngle",
  "plateKg", "plateKgBracket", "stackKg", "cableMA",
  "pulleyX", "pulleyY", "armMassKg", "armComFrac",
  "userHeightCm", "benchAngle", "hipX", "hipY",
];

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
  SLIDER_IDS.forEach((id) => {
    const el = $(`#${id}`);
    if (!el) return;
    const v = getStateVal(id);
    el.value = v;
    const out = $(`#${id}-val`);
    if (out) out.textContent = formatVal(id, v);
  });
  $("#forceDir").value = state.forceDir;
  $("#xAxis").value = state.xAxis;
  $("#unit").value = state.unit;
  $("#overlay").value = state.overlay;
  $("#animate").checked = state.animate;
  $("#showBody").checked = state.showBody;
  document.querySelectorAll(`input[name="mode"]`).forEach((el) => {
    el.checked = el.value === state.mode;
  });
  redraw();
}

function initApp() {
  SLIDER_IDS.forEach(bindSlider);
  bindRadio("mode", "mode");
  bindSelect("forceDir", "forceDir");
  bindSelect("xAxis", "xAxis");
  bindSelect("unit", "unit");
  bindSelect("overlay", "overlay");
  bindCheckbox("animate", "animate", toggleAnimation);
  bindCheckbox("showBody", "showBody");
  $("#reset").addEventListener("click", resetAll);
  window.addEventListener("resize", resizeAll);
  resizeAll();
}

document.addEventListener("DOMContentLoaded", initApp);
