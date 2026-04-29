// Force-curve plot. Two X-axis modes: arm angle (degrees) and handle vertical
// displacement (metres). Y is force at the handle (kgf by default, N optional).

import { overlaySeries } from "./strength-curves.js";

const COL = {
  bg: "#0f1115",
  grid: "#1b1f28",
  axis: "#3a4050",
  text: "#c9d0dd",
  force: "#ffd166",
  forceFill: "rgba(255,209,102,0.12)",
  overlay: "#06d6a0",
  marker: "#ef476f",
  editor: "#64b5ff",
  editorFill: "#0f1115",
  editorLine: "rgba(100, 181, 255, 0.85)",
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function niceRange(lo, hi) {
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.08;
  return { lo: Math.min(0, lo - pad), hi: hi + pad };
}

function xSeries(samples, xAxis) {
  if (xAxis === "angle") {
    return samples.map((s) => (s.theta * 180) / Math.PI);
  }
  return samples.map((s) => s.handleDispM);
}

function drawAxes(ctx, W, H, xLabel, yLabel) {
  const L = 54, R = 12, T = 12, B = 36;
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = COL.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, H - B);
  ctx.lineTo(W - R, H - B);
  ctx.stroke();
  ctx.fillStyle = COL.text;
  ctx.font = "12px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(xLabel, (L + W - R) / 2, H - 10);
  ctx.save();
  ctx.translate(16, (T + H - B) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
  return { L, R, T, B };
}

function xy(p, xr, yr, box, W, H) {
  const { L, R, T, B } = box;
  const u = (p.x - xr.lo) / (xr.hi - xr.lo);
  const v = (p.y - yr.lo) / (yr.hi - yr.lo);
  return {
    x: L + u * (W - L - R),
    y: H - B - v * (H - T - B),
  };
}

function xAtT(xs, t) {
  if (!xs.length) return 0;
  if (xs.length === 1) return xs[0];
  const pos = clamp(t, 0, 1) * (xs.length - 1);
  const i = Math.min(xs.length - 2, Math.floor(pos));
  const u = pos - i;
  return xs[i] + (xs[i + 1] - xs[i]) * u;
}

function makePlotMeta(box, xr, yr, W, H, xs, opts) {
  const { L, R, T, B } = box;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const xValueAtPx = (px) => xr.lo + ((px - L) / plotW) * (xr.hi - xr.lo);
  const yValueAtPx = (py) => yr.lo + ((H - B - py) / plotH) * (yr.hi - yr.lo);

  const xValueToT = (xv) => {
    if (xs.length <= 1) return 0;
    let bestT = 0;
    let bestD = Infinity;
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i];
      const b = xs[i + 1];
      const span = b - a;
      const u = Math.abs(span) < 1e-12
        ? 0
        : clamp((xv - a) / span, 0, 1);
      const xOnSegment = a + span * u;
      const d = Math.abs(xOnSegment - xv);
      if (d < bestD) {
        bestD = d;
        bestT = (i + u) / (xs.length - 1);
      }
    }
    return clamp(bestT, 0, 1);
  };

  return {
    controlPoints: [],
    xToT: (px) => xValueToT(xValueAtPx(px)),
    yToForceKgf: (py) => {
      const yValue = yValueAtPx(py);
      return opts.unit === "kgf" ? yValue : yValue / 9.80665;
    },
  };
}

function drawGrid(ctx, box, xr, yr, W, H, xUnit) {
  const { L, R, T, B } = box;
  ctx.strokeStyle = COL.grid;
  ctx.fillStyle = COL.text;
  ctx.lineWidth = 1;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";

  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const t = i / xTicks;
    const xv = xr.lo + t * (xr.hi - xr.lo);
    const p = xy({ x: xv, y: yr.lo }, xr, yr, box, W, H);
    ctx.beginPath();
    ctx.moveTo(p.x, T);
    ctx.lineTo(p.x, H - B);
    ctx.stroke();
    ctx.fillText(formatX(xv, xUnit), p.x, H - B + 16);
  }

  const yTicks = 5;
  ctx.textAlign = "right";
  for (let i = 0; i <= yTicks; i++) {
    const t = i / yTicks;
    const yv = yr.lo + t * (yr.hi - yr.lo);
    const p = xy({ x: xr.lo, y: yv }, xr, yr, box, W, H);
    ctx.beginPath();
    ctx.moveTo(L, p.y);
    ctx.lineTo(W - R, p.y);
    ctx.stroke();
    ctx.fillText(yv.toFixed(0), L - 6, p.y + 4);
  }
}

function formatX(v, unit) {
  if (unit === "°") return `${v.toFixed(0)}°`;
  return `${(v * 100).toFixed(0)} cm`;
}

export function renderPlot(canvas, samples, opts) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const xUnit = opts.xAxis === "angle" ? "°" : "m";
  const xLabel = opts.xAxis === "angle" ? "Arm angle" : "Handle vertical displacement";
  const yLabel = opts.unit === "kgf" ? "Force at handle (kgf)" : "Force at handle (N)";

  const box = drawAxes(ctx, W, H, xLabel, yLabel);

  if (!samples.length) {
    return {
      controlPoints: [],
      xToT: () => 0,
      yToForceKgf: () => 0,
    };
  }

  const xs = xSeries(samples, opts.xAxis);
  const ys = samples.map((s) => (opts.unit === "kgf" ? s.fKgf : s.fN));

  const xr = niceRange(Math.min(...xs), Math.max(...xs));
  const sourceValues = opts.editableVoltra && Array.isArray(opts.voltraPoints)
    ? opts.voltraPoints.map((pt) => (opts.unit === "kgf" ? pt.fKgf : pt.fKgf * 9.80665))
    : [];
  const yMax = Math.max(...ys, ...sourceValues, 0);
  const yr = niceRange(0, yMax);
  const meta = makePlotMeta(box, xr, yr, W, H, xs, opts);

  drawGrid(ctx, box, xr, yr, W, H, xUnit);

  // fill under force curve
  ctx.beginPath();
  const first = xy({ x: xs[0], y: 0 }, xr, yr, box, W, H);
  ctx.moveTo(first.x, first.y);
  for (let i = 0; i < xs.length; i++) {
    const p = xy({ x: xs[i], y: ys[i] }, xr, yr, box, W, H);
    ctx.lineTo(p.x, p.y);
  }
  const last = xy({ x: xs[xs.length - 1], y: 0 }, xr, yr, box, W, H);
  ctx.lineTo(last.x, last.y);
  ctx.closePath();
  ctx.fillStyle = COL.forceFill;
  ctx.fill();

  // overlay idealised strength curve (scaled to force peak, in N)
  if (opts.overlay && opts.overlay !== "none") {
    const overlay = overlaySeries(opts.overlay, samples);
    ctx.strokeStyle = COL.overlay;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < overlay.length; i++) {
      const yOv = opts.unit === "kgf" ? overlay[i].fN / 9.80665 : overlay[i].fN;
      const p = xy({ x: xs[i], y: yOv }, xr, yr, box, W, H);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // force curve
  ctx.strokeStyle = COL.force;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    const p = xy({ x: xs[i], y: ys[i] }, xr, yr, box, W, H);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  // current-angle marker
  if (opts.currentIndex != null && opts.currentIndex >= 0) {
    const i = opts.currentIndex;
    const p = xy({ x: xs[i], y: ys[i] }, xr, yr, box, W, H);
    ctx.fillStyle = COL.marker;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  if (opts.editableVoltra && Array.isArray(opts.voltraPoints)) {
    const points = opts.voltraPoints.map((pt, index) => {
      const y = opts.unit === "kgf" ? pt.fKgf : pt.fKgf * 9.80665;
      const p = xy({ x: xAtT(xs, pt.t), y }, xr, yr, box, W, H);
      return { ...p, index, hitRadius: 18 };
    });
    meta.controlPoints = points;

    ctx.strokeStyle = COL.editorLine;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) ctx.moveTo(points[i].x, points[i].y);
      else ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of points) {
      ctx.fillStyle = COL.editorFill;
      ctx.strokeStyle = COL.editor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  return meta;
}
