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

import { voltraForceNAt } from "./voltra-curve.js";

const G = 9.80665;
const MAX_HANDLE_FORCE_N = 100000;
const MIN_EFFECTIVE_LEVER_M = 1e-3;
const ZERO_TORQUE_NM = 1e-9;

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

// Unit vector of the direction the user is assumed to apply force at the
// handle tip. Body-relative modes (tangent / perpMain / perpHandle) rotate
// with the arm and only scale the force magnitude. World-fixed modes
// (horizontal / vertical) stay pointing along the world axes and genuinely
// reshape the force curve because r rotates while F stays put.
export function forceDirVector(state, theta) {
  switch (state.forceDir) {
    case "horizontal":
      // along world +x (the direction the arm extends away from the rack)
      return { x: 1, y: 0 };
    case "vertical":
      // along world +y (up)
      return { x: 0, y: 1 };
    case "perpMain":
      return { x: -Math.sin(theta), y: Math.cos(theta) };
    case "perpHandle": {
      const a = theta + state.aHandle;
      return { x: -Math.sin(a), y: Math.cos(a) };
    }
    case "tangent":
    default: {
      const h = handlePos(state, theta);
      const rx = h.x - state.pivot.x;
      const ry = h.y - state.pivot.y;
      const r = Math.hypot(rx, ry) || 1;
      return { x: -ry / r, y: rx / r };
    }
  }
}

// Signed effective lever arm: the moment arm of the applied unit force
// about the pivot. (r × F̂)_z gives a positive value when the force tends
// to rotate the arm CCW.
export function effectiveLever(state, theta) {
  const h = handlePos(state, theta);
  const rx = h.x - state.pivot.x;
  const ry = h.y - state.pivot.y;
  const f = forceDirVector(state, theta);
  return rx * f.y - ry * f.x;
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

function cableTorqueWithTension(state, theta, tensionN) {
  const wp = weightPos(state, theta);
  const dx = state.pulley.x - wp.x;
  const dy = state.pulley.y - wp.y;
  const len = Math.hypot(dx, dy) || 1;
  const T = tensionN * (state.cableMA ?? 1);
  return torqueAt(state, wp, (T * dx) / len, (T * dy) / len);
}

function cableTorque(state, theta) {
  return cableTorqueWithTension(state, theta, state.stackKg * G);
}

function voltraTorque(state, theta) {
  return cableTorqueWithTension(state, theta, voltraForceNAt(state, theta));
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

function loadTorque(state, theta) {
  let tauLoad = 0;
  if (state.mode === "plate") tauLoad += plateTorque(state, theta);
  else if (state.mode === "cable") tauLoad += cableTorque(state, theta);
  else if (state.mode === "voltra") tauLoad += voltraTorque(state, theta);
  tauLoad += bracketPlateTorque(state, theta);
  tauLoad += armSelfTorque(state, theta);
  return tauLoad;
}

function signedHandleForce(state, theta) {
  const tauLoad = loadTorque(state, theta);
  if (Math.abs(tauLoad) < ZERO_TORQUE_NM) return 0;

  const R = effectiveLever(state, theta);
  // Near-singular geometries mean the chosen force direction cannot create
  // the torque required to hold the load. Keep outputs finite for plotting,
  // but do not invent force when there is no load torque.
  if (Math.abs(R) < MIN_EFFECTIVE_LEVER_M) {
    return -Math.sign(tauLoad || 1) * MAX_HANDLE_FORCE_N;
  }

  const F = -tauLoad / R;
  return Math.max(-MAX_HANDLE_FORCE_N, Math.min(MAX_HANDLE_FORCE_N, F));
}

// Magnitude of the force the user must apply at the handle (in whichever
// direction `state.forceDir` selects) to hold the arm statically at θ.
export function forceAtHandle(state, theta) {
  return Math.abs(signedHandleForce(state, theta));
}

// Like forceAtHandle, but returns the actual force vector applied at the
// handle tip in equilibrium: magnitude and direction. Used for visualisation.
export function forceVectorAtHandle(state, theta) {
  const f = forceDirVector(state, theta);
  // τ_user + τ_load = 0 -> F * R = -τ_load.
  // Negative F means the user actually pushes opposite to f̂.
  const F = signedHandleForce(state, theta);
  const fN = Math.abs(F);
  const dir = F >= 0 ? f : { x: -f.x, y: -f.y };
  return { fN, dir };
}

// Sweep across the ROM.
export function sweep(state, nSamples = 181) {
  if (nSamples <= 0) return [];
  const { romStart, romEnd } = state;
  const out = new Array(nSamples);
  const h0 = handlePos(state, romStart).y;
  for (let i = 0; i < nSamples; i++) {
    const t = nSamples === 1 ? 0 : i / (nSamples - 1);
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
  if (!samples.length) return { fN: 0, index: -1, sample: null };
  let peak = -Infinity;
  let idx = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].fN > peak) { peak = samples[i].fN; idx = i; }
  }
  return { fN: peak, index: idx, sample: samples[idx] };
}

export function minForce(samples) {
  if (!samples.length) return { fN: 0, index: -1, sample: null };
  let lo = Infinity;
  let idx = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].fN < lo) { lo = samples[i].fN; idx = i; }
  }
  return { fN: lo, index: idx, sample: samples[idx] };
}
