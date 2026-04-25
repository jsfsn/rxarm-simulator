// Idealised human strength curves for overlay comparison.
// All curves take a normalised position t in [0,1] where:
//   t = 0 → start of the ROM (eccentric bottom / stretched)
//   t = 1 → end of the ROM (top / contracted)
// and return a relative capability in [0,1].
//
// These are rough shapes for visual comparison, not biomechanical truth.

const curves = {
  ascending: (t) => 0.35 + 0.65 * t,
  descending: (t) => 1.0 - 0.65 * t,
  bell: (t) => 0.35 + 0.65 * Math.sin(Math.PI * t),
  flat: () => 1.0,
};

export const CURVE_NAMES = Object.keys(curves);

export function curveValue(name, t) {
  const f = curves[name] ?? curves.flat;
  return f(t);
}

// Scale an overlay curve so its peak matches the peak of the measured force
// samples — makes the shape comparison meaningful regardless of load.
export function overlaySeries(name, samples) {
  if (!samples.length) return [];
  let peak = 0;
  for (const s of samples) if (s.fN > peak) peak = s.fN;
  const out = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const t = samples.length === 1 ? 0 : i / (samples.length - 1);
    out[i] = { t, fN: curveValue(name, t) * peak };
  }
  return out;
}
