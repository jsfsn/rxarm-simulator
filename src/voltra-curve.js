const G = 9.80665;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function finiteNumber(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

export function defaultVoltraPoints(count = 7, fKgf = 40) {
  const n = Math.max(2, Math.round(count));
  return Array.from({ length: n }, (_, i) => ({
    t: n === 1 ? 0 : i / (n - 1),
    fKgf,
  }));
}

export function normalizeVoltraPoints(points, maxKgf = Infinity) {
  const hi = Number.isFinite(maxKgf) ? Math.max(0, maxKgf) : Infinity;
  const src = Array.isArray(points) && points.length
    ? points
    : defaultVoltraPoints(7, 0);

  return src
    .map((p) => ({
      t: clamp(finiteNumber(+p.t, 0), 0, 1),
      fKgf: clamp(finiteNumber(+p.fKgf, 0), 0, hi),
    }))
    .sort((a, b) => a.t - b.t);
}

export function voltraForceKgfAt(points, t, maxKgf = Infinity) {
  const pts = normalizeVoltraPoints(points, maxKgf);
  const x = clamp(finiteNumber(+t, 0), 0, 1);

  if (pts.length === 1 || x <= pts[0].t) return pts[0].fKgf;
  const last = pts[pts.length - 1];
  if (x >= last.t) return last.fKgf;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x < a.t || x > b.t) continue;
    const span = b.t - a.t;
    if (span <= 1e-9) return b.fKgf;
    const u = (x - a.t) / span;
    return a.fKgf + (b.fKgf - a.fKgf) * u;
  }

  return last.fKgf;
}

export function resampleVoltraPoints(points, count, maxKgf = Infinity) {
  const n = Math.max(2, Math.round(count));
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    return {
      t,
      fKgf: voltraForceKgfAt(points, t, maxKgf),
    };
  });
}

export function normalizedRomT(state, theta) {
  const span = state.romEnd - state.romStart;
  if (Math.abs(span) < 1e-12) return 0;
  return clamp((theta - state.romStart) / span, 0, 1);
}

export function voltraForceNAt(state, theta) {
  return voltraForceKgfAt(
    state.voltraPoints,
    normalizedRomT(state, theta),
    state.voltraMaxKgf,
  ) * G;
}
