import { sweep, peakForce, minForce, handlePos } from "./physics.js";
import { renderScene } from "./render.js";
import { renderPlot } from "./plot.js";

const DEG = Math.PI / 180;
const G = 9.80665;

// Defaults sized to the RX Mini Arms: ~580 mm arm with handle + weight-arm
// extensions, set up as a horizontal jammer press. Tune freely in the UI.
const defaultState = () => ({
  mode: "plate",
  pivot: { x: 0, y: 1.3 },
  lHandle: 0.58,
  aHandle: 0,      // degrees, offset of handle arm from reference
  lWeight: 0.30,
  aWeight: 180,    // plate horn opposite the handle by default
  plateKg: 40,
  stackKg: 40,
  cableMA: 1,
  pulley: { x: -0.8, y: 0.4 },
  armMassKg: 6,
  armComFrac: 0.45,
  romStart: -30,   // degrees
  romEnd: 30,
  currentAngle: 0,
  xAxis: "angle",
  unit: "kgf",
  overlay: "none",
  animate: false,
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

function fitCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  c.width = Math.max(1, Math.floor(rect.width * dpr));
  c.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resizeAll() {
  fitCanvas(sceneCanvas);
  fitCanvas(plotCanvas);
  redraw();
}

function formatVal(key, v) {
  switch (key) {
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
      return `${(+v).toFixed(2)} m`;
    default:
      return String(v);
  }
}

function setState(key, value) {
  if (key === "pivotY") state.pivot.y = value;
  else if (key === "pulleyX") state.pulley.x = value;
  else if (key === "pulleyY") state.pulley.y = value;
  else state[key] = value;
}

function getStateVal(key) {
  if (key === "pivotY") return state.pivot.y;
  if (key === "pulleyX") return state.pulley.x;
  if (key === "pulleyY") return state.pulley.y;
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
  $("#stat-handle-y").textContent = `${(handlePos(ps, currentTheta).y * 100).toFixed(0)} cm`;
}

const SLIDER_IDS = [
  "lHandle", "aHandle", "lWeight", "aWeight",
  "pivotY", "romStart", "romEnd", "currentAngle",
  "plateKg", "stackKg", "cableMA",
  "pulleyX", "pulleyY", "armMassKg", "armComFrac",
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
  $("#xAxis").value = state.xAxis;
  $("#unit").value = state.unit;
  $("#overlay").value = state.overlay;
  $("#animate").checked = state.animate;
  document.querySelectorAll(`input[name="mode"]`).forEach((el) => {
    el.checked = el.value === state.mode;
  });
  redraw();
}

function initApp() {
  SLIDER_IDS.forEach(bindSlider);
  bindRadio("mode", "mode");
  bindSelect("xAxis", "xAxis");
  bindSelect("unit", "unit");
  bindSelect("overlay", "overlay");
  bindCheckbox("animate", "animate", toggleAnimation);
  $("#reset").addEventListener("click", resetAll);
  window.addEventListener("resize", resizeAll);
  resizeAll();
}

document.addEventListener("DOMContentLoaded", initApp);
