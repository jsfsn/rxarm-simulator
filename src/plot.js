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
  editorBadgeBg: "rgba(15, 17, 21, 0.82)",
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
      if (opts.voltraSourceScale) {
        const maxKgf = Math.max(1e-9, opts.voltraSourceScale.maxKgf);
        const visualPeak = Math.max(1e-9, opts.voltraSourceScale.visualPeak);
        return (yValue / visualPeak) * maxKgf;
      }
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

function drawPointLabel(ctx, text, p, box, W) {
  ctx.font = "11px system-ui, sans-serif";
  const padX = 5;
  const w = Math.ceil(ctx.measureText(text).width + padX * 2);
  const h = 17;
  const x = clamp(p.x - w * 0.5, box.L + 2, W - box.R - w - 2);
  const y = Math.max(box.T + 2, p.y - 25);

  ctx.fillStyle = COL.editorBadgeBg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COL.editor;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = COL.editor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w * 0.5, y + h * 0.5 + 0.5);
  ctx.textBaseline = "alphabetic";
}

function drawOutputCurveLabels(ctx, xs, ys, xr, yr, box, W, H) {
  if (xs.length < 2) return;
  const n = 6;
  const baseIndex = 0;
  const base = Math.max(1e-9, ys[baseIndex]);

  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let k = 0; k < n; k++) {
    const i = Math.round((k / (n - 1)) * (xs.length - 1));
    const p = xy({ x: xs[i], y: ys[i] }, xr, yr, box, W, H);
    const pct = k === 0 ? 100 : (ys[i] / base) * 100;
    const text = `${pct.toFixed(0)}%`;
    const padX = 5;
    const w = Math.ceil(ctx.measureText(text).width + padX * 2);
    const h = 17;
    const x = clamp(p.x - w * 0.5, box.L + 2, W - box.R - w - 2);
    const y = Math.min(H - box.B - h - 2, p.y + 10);

    ctx.fillStyle = "rgba(15, 17, 21, 0.78)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COL.force;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = COL.force;
    ctx.fillText(text, x + w * 0.5, y + h * 0.5 + 0.5);
  }

  ctx.textBaseline = "alphabetic";
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
  const outputPeak = Math.max(...ys, 0);
  const yMax = outputPeak;
  const yr = niceRange(0, yMax);
  const voltraMax = Math.max(1e-9, opts.voltraMaxKgf ?? 1);
  const voltraVisualPeak = Math.max(outputPeak, yr.hi * 0.82, 1);
  const voltraSourceScale = opts.editableVoltra
    ? { maxKgf: voltraMax, visualPeak: voltraVisualPeak }
    : null;
  opts.voltraSourceScale = voltraSourceScale;
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

  drawOutputCurveLabels(ctx, xs, ys, xr, yr, box, W, H);

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
      const y = (pt.fKgf / voltraMax) * voltraVisualPeak;
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

    const baseForce = opts.voltraPoints[0]?.fKgf ?? 0;
    for (const p of points) {
      const fKgf = opts.voltraPoints[p.index]?.fKgf ?? 0;
      const pct = p.index === 0 || baseForce <= 1e-9
        ? 100
        : (fKgf / baseForce) * 100;
      drawPointLabel(ctx, `${pct.toFixed(0)}%`, p, box, W);
    }
  }

  return meta;
}
