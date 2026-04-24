// RX Arm 2D physics model.
//
// World: x-right, y-UP, units in metres, angles in radians.
// The arm is a rigid body rotating about a pivot attached to the rack.
// On the arm there are two extensions (each specified by length and angular
// offset from the arm's reference direction):
//   - the HANDLE arm, where the user applies force
//   - the WEIGHT arm, where the load is applied (plates or cable attachment)
//
// Sign convention for armAngle (theta):
//   theta = 0     → arm points along +x (horizontal, out from the rack)
//   theta > 0     → rotates CCW (handle moves up for a press)
//
// User force assumption:
//   The user pushes perpendicular to the handle-arm radius, i.e. tangentially.
//   F_user is reported as a magnitude (positive = load the user must overcome).

const G = 9.80665;

export function handlePos(state, theta) {
  const { pivot, lHandle, aHandle } = state;
  const a = theta + aHandle;
  return {
    x: pivot.x + lHandle * Math.cos(a),
    y: pivot.y + lHandle * Math.sin(a),
  };
}

export function weightPos(state, theta) {
  const { pivot, lWeight, aWeight } = state;
  const a = theta + aWeight;
  return {
    x: pivot.x + lWeight * Math.cos(a),
    y: pivot.y + lWeight * Math.sin(a),
  };
}

// Signed torque about the pivot produced by a force F=(fx,fy) applied at
// world point P=(px,py). z-component of (P-pivot) × F.
function torqueAt(state, p, fx, fy) {
  const rx = p.x - state.pivot.x;
  const ry = p.y - state.pivot.y;
  return rx * fy - ry * fx;
}

// Torque from loaded plates: gravity acting at the weight-arm tip.
function plateTorque(state, theta) {
  const wp = weightPos(state, theta);
  const fy = -state.plateKg * G;
  return torqueAt(state, wp, 0, fy);
}

// Torque from a cable pulling the weight-arm tip toward a fixed pulley.
// Tension = stackKg * g * mechanicalAdvantage (MA=1 for a single cable run).
function cableTorque(state, theta) {
  const wp = weightPos(state, theta);
  const dx = state.pulley.x - wp.x;
  const dy = state.pulley.y - wp.y;
  const len = Math.hypot(dx, dy) || 1;
  const T = state.stackKg * G * (state.cableMA ?? 1);
  return torqueAt(state, wp, (T * dx) / len, (T * dy) / len);
}

// Torque from the arm's own mass, if enabled. Treated as a point mass at
// a configurable fraction of the handle-arm length (simple approximation).
function armSelfTorque(state, theta) {
  if (!state.armMassKg) return 0;
  const comFrac = state.armComFrac ?? 0.5;
  const comPos = {
    x: state.pivot.x + comFrac * state.lHandle * Math.cos(theta),
    y: state.pivot.y + comFrac * state.lHandle * Math.sin(theta),
  };
  return torqueAt(state, comPos, 0, -state.armMassKg * G);
}

// Quasi-static magnitude of force the user must apply at the handle,
// assumed tangential (perpendicular to the handle-arm radius). The direction
// flips depending on how the arm is oriented; the magnitude is what matters
// for a force curve.
export function forceAtHandle(state, theta) {
  let tauLoad = 0;
  if (state.mode === "plate") tauLoad += plateTorque(state, theta);
  else if (state.mode === "cable") tauLoad += cableTorque(state, theta);
  tauLoad += armSelfTorque(state, theta);

  return Math.abs(tauLoad) / state.lHandle;
}

// Sweep across the ROM and return an array of samples for plotting.
// Each sample: { theta, fN, fKgf, handle:{x,y}, handleDispM }
// handleDispM is vertical handle displacement from the start of ROM.
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
    if (samples[i].fN > peak) {
      peak = samples[i].fN;
      idx = i;
    }
  }
  return { fN: peak, index: idx, sample: samples[idx] };
}

export function minForce(samples) {
  let lo = Infinity;
  let idx = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].fN < lo) {
      lo = samples[i].fN;
      idx = i;
    }
  }
  return { fN: lo, index: idx, sample: samples[idx] };
}
