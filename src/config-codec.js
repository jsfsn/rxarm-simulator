import {
  defaultVoltraPoints,
  pointsForVoltraMode,
  VOLTRA_CURVE_MODES,
} from "./voltra-curve.js";

const PREFIX = "rx1.";

const MODES = ["plate", "cable", "voltra"];
const FORCE_DIRS = ["tangent", "perpMain", "perpHandle", "horizontal", "vertical"];
const X_AXES = ["angle", "disp"];
const UNITS = ["kgf", "N"];
const OVERLAYS = ["none", "ascending", "descending", "bell", "flat"];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function q(v, scale = 1) {
  const n = +v;
  return Number.isFinite(n) ? Math.round(n * scale) : 0;
}

function dq(v, scale = 1, fallback = 0) {
  const n = +v;
  return Number.isFinite(n) ? n / scale : fallback;
}

function idx(list, value) {
  const i = list.indexOf(value);
  return i >= 0 ? i : 0;
}

function fromIdx(list, value, fallback = list[0]) {
  const i = Math.round(+value);
  return list[i] ?? fallback;
}

function toBase64Url(str) {
  const base64 = typeof btoa === "function"
    ? btoa(str)
    : Buffer.from(str, "utf8").toString("base64");
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(str) {
  const base64 = str.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return typeof atob === "function"
    ? atob(padded)
    : Buffer.from(padded, "base64").toString("utf8");
}

export function extractConfigString(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return "";

  const prefixed = input.match(/rx1\.[A-Za-z0-9_-]+/u);
  if (prefixed) return prefixed[0];

  try {
    const url = new URL(input);
    return url.hash.startsWith("#cfg=")
      ? decodeURIComponent(url.hash.slice(5))
      : (url.searchParams.get("cfg") ?? "");
  } catch {
    return input;
  }
}

export function encodeConfig(state) {
  const points = pointsForVoltraMode(
    state.voltraCurveMode,
    state.voltraPoints,
    state.voltraMaxKgf,
    state.voltraPointCount,
  )
    .flatMap((p) => [q(p.t, 1000), q(p.fKgf, 10)]);

  const payload = [
    1,
    idx(MODES, state.mode),
    q(state.pivot?.y, 1000),
    q(state.lArm, 1000),
    q(state.lWeightMount, 1000),
    q(state.lHandle, 1000),
    q(state.aHandle),
    q(state.lWeight, 1000),
    q(state.aWeight),
    q(state.plateKg, 10),
    q(state.plateKgBracket, 10),
    q(state.stackKg, 10),
    q(state.cableMA, 10),
    q(state.voltraMaxKgf, 10),
    q(state.voltraPointCount),
    q(state.pulley?.x, 1000),
    q(state.pulley?.y, 1000),
    q(state.armMassKg, 10),
    q(state.armComFrac, 1000),
    q(state.romStart),
    q(state.romEnd),
    q(state.currentAngle),
    idx(FORCE_DIRS, state.forceDir),
    idx(X_AXES, state.xAxis),
    idx(UNITS, state.unit),
    idx(OVERLAYS, state.overlay),
    state.showBody ? 1 : 0,
    q(state.userHeight, 1000),
    q(state.benchAngle),
    q(state.hipX, 1000),
    q(state.hipY, 1000),
    points,
    idx(VOLTRA_CURVE_MODES, state.voltraCurveMode),
  ];

  return `${PREFIX}${toBase64Url(JSON.stringify(payload))}`;
}

export function decodeConfig(raw) {
  const token = extractConfigString(raw);
  if (!token.startsWith(PREFIX)) {
    throw new Error("Config string must start with rx1.");
  }

  const payload = JSON.parse(fromBase64Url(token.slice(PREFIX.length)));
  if (!Array.isArray(payload) || payload[0] !== 1) {
    throw new Error("Unsupported config version.");
  }

  const voltraMaxKgf = clamp(dq(payload[13], 10, 150), 0, 300);
  const voltraCurveMode = fromIdx(VOLTRA_CURVE_MODES, payload[32], "points");
  const encodedPoints = Array.isArray(payload[31]) ? payload[31] : [];
  const voltraPoints = [];
  for (let i = 0; i < encodedPoints.length - 1; i += 2) {
    voltraPoints.push({
      t: clamp(dq(encodedPoints[i], 1000), 0, 1),
      fKgf: Math.max(0, dq(encodedPoints[i + 1], 10)),
    });
  }

  return {
    mode: fromIdx(MODES, payload[1]),
    pivot: { x: 0, y: clamp(dq(payload[2], 1000, 1.3), 0.2, 3) },
    lArm: clamp(dq(payload[3], 1000, 0.579), 0.05, 2),
    lWeightMount: clamp(dq(payload[4], 1000, 0.29), 0, 2),
    lHandle: clamp(dq(payload[5], 1000, 0.29), 0, 1),
    aHandle: clamp(dq(payload[6], 1, 0), -180, 180),
    lWeight: clamp(dq(payload[7], 1000, 0.45), 0, 1.5),
    aWeight: clamp(dq(payload[8], 1, -60), -180, 180),
    plateKg: clamp(dq(payload[9], 10, 40), 0, 300),
    plateKgBracket: clamp(dq(payload[10], 10, 0), 0, 300),
    stackKg: clamp(dq(payload[11], 10, 40), 0, 300),
    cableMA: clamp(dq(payload[12], 10, 1), 0.1, 10),
    voltraMaxKgf,
    voltraPointCount: clamp(Math.round(dq(payload[14], 1, 7)), 6, 8),
    pulley: {
      x: clamp(dq(payload[15], 1000, -0.9), -5, 5),
      y: clamp(dq(payload[16], 1000, 0.4), -2, 4),
    },
    armMassKg: clamp(dq(payload[17], 10, 6), 0, 100),
    armComFrac: clamp(dq(payload[18], 1000, 0.45), 0, 1),
    romStart: clamp(dq(payload[19], 1, -30), -180, 180),
    romEnd: clamp(dq(payload[20], 1, 30), -180, 180),
    currentAngle: clamp(dq(payload[21], 1, 0), -180, 180),
    forceDir: fromIdx(FORCE_DIRS, payload[22], "perpMain"),
    xAxis: fromIdx(X_AXES, payload[23]),
    unit: fromIdx(UNITS, payload[24]),
    overlay: fromIdx(OVERLAYS, payload[25]),
    animate: false,
    showBody: !!payload[26],
    userHeight: clamp(dq(payload[27], 1000, 1.8), 1, 2.5),
    benchAngle: clamp(dq(payload[28], 1, 0), 0, 90),
    hipX: clamp(dq(payload[29], 1000, 0.85), -2, 4),
    hipY: clamp(dq(payload[30], 1000, 0.5), 0, 2),
    voltraCurveMode,
    voltraPoints: pointsForVoltraMode(
      voltraCurveMode,
      voltraPoints.length ? voltraPoints : defaultVoltraPoints(7, 40),
      voltraMaxKgf,
      clamp(Math.round(dq(payload[14], 1, 7)), 6, 8),
    ),
  };
}
