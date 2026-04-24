// RX Mini Arms 2D physics.
//
// Mechanism:
//   - MAIN ARM pivots on the rack at the rack pin (rotation axis = page normal).
//   - WEIGHT BRACKET sits at a configurable distance along the main arm.
//     From it the WEIGHT ARM extends, set to an angle relative to the main
//     arm (360° indexable on the hardware) and rigidly locked.
//   - HANDLE BRACKET sits at the end of the main arm. From it the HANDLE ARM
//     extends, again at a locked 360° angle relative to the main arm.
//
// During exercise the whole assembly rotates as one rigid body about the
// rack pin. The sub-arm angles (aHandle, aWeight) don't change during the
// rep — they're set once via the indexable dials.
//
// World: x-right, y-UP, metres, radians. θ (the main-arm rotation) = 0
// points along +x, grows CCW.

const G = 9.80665;

// --- Key points on the rigid body as functions of the main-arm angle θ ---

export function handleBracketPos(state, theta) {
  return {
    x: state.pivot.x + state.lArm * Math.cos(theta),
    y: state.pivot.y + state.lArm * Math.sin(theta),
  };
}

export function weightBracketPos(state, theta) {
  return {
    x: state.pivot.x + state.lWeightMount * Math.cos(theta),
    y: state.pivot.y + state.lWeightMount * Math.sin(theta),
  };
}

export function handlePos(state, theta) {
  const b = handleBracketPos(state, theta);
  const a = theta + state.aHandle;
  return {
    x: b.x + state.lHandle * Math.cos(a),
    y: b.y + state.lHandle * Math.sin(a),
  };
}

export function weightPos(state, theta) {
  const b = weightBracketPos(state, theta);
  const a = theta + state.aWeight;
  return {
    x: b.x + state.lWeight * Math.cos(a),
    y: b.y + state.lWeight * Math.sin(a),
  };
}

// Distance from the rack pivot to the handle tip. The whole assembly is
// rigid so this is constant across θ; law of cosines gives:
//   R² = lArm² + lHandle² + 2·lArm·lHandle·cos(aHandle)
export function effectiveHandleRadius(state) {
  const la = state.lArm, lh = state.lHandle;
  return Math.sqrt(la * la + lh * lh + 2 * la * lh * Math.cos(state.aHandle));
}

// --- Torque helpers ---

function torqueAt(state, p, fx, fy) {
  const rx = p.x - state.pivot.x;
  const ry = p.y - state.pivot.y;
  return rx * fy - ry * fx;
}

function plateTorque(state, theta) {
  const wp = weightPos(state, theta);
  return torqueAt(state, wp, 0, -state.plateKg * G);
}

// Plates loaded on the horn at the weight bracket (the attachment point
// of the weight arm along the main arm). Always applied — independent of
// plate-vs-cable mode at the weight-arm tip.
function bracketPlateTorque(state, theta) {
  if (!state.plateKgBracket) return 0;
  const bp = weightBracketPos(state, theta);
  return torqueAt(state, bp, 0, -state.plateKgBracket * G);
}

function cableTorque(state, theta) {
  const wp = weightPos(state, theta);
  const dx = state.pulley.x - wp.x;
  const dy = state.pulley.y - wp.y;
  const len = Math.hypot(dx, dy) || 1;
  const T = state.stackKg * G * (state.cableMA ?? 1);
  return torqueAt(state, wp, (T * dx) / len, (T * dy) / len);
}

// Arm self-weight: point mass at a fraction of the main arm length.
function armSelfTorque(state, theta) {
  if (!state.armMassKg) return 0;
  const comFrac = state.armComFrac ?? 0.5;
  const p = {
    x: state.pivot.x + comFrac * state.lArm * Math.cos(theta),
    y: state.pivot.y + comFrac * state.lArm * Math.sin(theta),
  };
  return torqueAt(state, p, 0, -state.armMassKg * G);
}

// Magnitude of the (tangential) force the user must apply at the handle to
// hold the arm statically at angle θ.
export function forceAtHandle(state, theta) {
  let tauLoad = 0;
  if (state.mode === "plate") tauLoad += plateTorque(state, theta);
  else if (state.mode === "cable") tauLoad += cableTorque(state, theta);
  tauLoad += bracketPlateTorque(state, theta);
  tauLoad += armSelfTorque(state, theta);

  const R = effectiveHandleRadius(state);
  if (R < 1e-6) return 0; // handle at pivot — undefined
  return Math.abs(tauLoad) / R;
}

// Sweep across the ROM.
export function sweep(state, nSamples = 181) {
  const { romStart, romEnd } = state;
  const out = new Array(nSamples);
  const h0 = handlePos(state, romStart).y;
  for (let i = 0; i < nSamples; i++) {
    const t = i / (nSamples - 1);
    const theta = romStart + t * (romEnd - romStart);
    const h = handlePos(state, theta);
    const fN = forceAtHandle(state, theta);
    out[i] = {
      theta,
      fN,
      fKgf: fN / G,
      handle: h,
      handleDispM: h.y - h0,
    };
  }
  return out;
}

export function peakForce(samples) {
  let peak = -Infinity;
  let idx = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].fN > peak) { peak = samples[i].fN; idx = i; }
  }
  return { fN: peak, index: idx, sample: samples[idx] };
}

export function minForce(samples) {
  let lo = Infinity;
  let idx = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].fN < lo) { lo = samples[i].fN; idx = i; }
  }
  return { fN: lo, index: idx, sample: samples[idx] };
}
