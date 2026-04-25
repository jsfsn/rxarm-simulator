// Simple anthropometric model for the user on the bench, plus 2D inverse
// kinematics to place the elbow when the hand is on the handle.
//
// Proportions follow Drillis & Contini's mean values:
//   torso (hip → shoulder joint): 0.288 · H
//   upper arm (shoulder → elbow): 0.186 · H
//   forearm + hand to grip:       0.225 · H
// These are rough — individual limb ratios vary by 5–10%.

export function anatomy(userHeightM) {
  return {
    height: userHeightM,
    torso:   0.288 * userHeightM,
    upper:   0.186 * userHeightM,
    forearm: 0.225 * userHeightM,
    head:    0.065 * userHeightM, // radius of head circle
    neck:    0.052 * userHeightM,
  };
}

// Shoulder world position given hip position and bench angle (from horizontal,
// +θ tilts the head end upward = incline).
export function shoulderPos(state) {
  const a = anatomy(state.userHeight);
  const rad = state.benchAngle * Math.PI / 180;
  // Head end is in −x direction (toward rack); incline lifts it upward.
  return {
    x: state.hipX - a.torso * Math.cos(rad),
    y: state.hipY + a.torso * Math.sin(rad),
  };
}

// Two-segment IK: given shoulder S and target hand position H (world coords),
// upper-arm length a and forearm length f, return the elbow world position.
// If the target is unreachable the arm is clamped (fully extended or fully
// folded) and `reachable = false` is returned.
export function solveArmIK(shoulder, hand, upperLen, forearmLen) {
  const dx = hand.x - shoulder.x;
  const dy = hand.y - shoulder.y;
  const d0 = Math.hypot(dx, dy);

  const maxReach = upperLen + forearmLen;
  const minReach = Math.abs(upperLen - forearmLen);
  let reachable = true;
  let d = d0;
  if (d0 > maxReach) { d = maxReach; reachable = false; }
  else if (d0 < minReach) { d = minReach; reachable = false; }

  if (d < 1e-9) {
    return {
      elbow: { x: shoulder.x, y: shoulder.y - upperLen },
      hand: { x: hand.x, y: hand.y },
      reachable,
      distance: d0,
      maxReach,
      minReach,
      stretchPct: 0,
    };
  }

  // Unit vector along shoulder → hand, and its perpendicular.
  const ux = d0 < 1e-9 ? 1 : dx / d0;
  const uy = d0 < 1e-9 ? 0 : dy / d0;
  const vx = -uy, vy = ux; // CCW perpendicular

  // Distance along the line from shoulder to the elbow's projection.
  const p = (upperLen * upperLen + d * d - forearmLen * forearmLen) / (2 * d);
  const h = Math.sqrt(Math.max(0, upperLen * upperLen - p * p));

  // Two IK solutions; pick the one with the lower elbow (bends toward chest
  // in a press, which is the natural pose).
  const e1 = { x: shoulder.x + p * ux + h * vx, y: shoulder.y + p * uy + h * vy };
  const e2 = { x: shoulder.x + p * ux - h * vx, y: shoulder.y + p * uy - h * vy };
  const elbow = e1.y <= e2.y ? e1 : e2;

  // Effective hand position (clamped toward target along the line if
  // unreachable).
  const handClamped = reachable
    ? { x: hand.x, y: hand.y }
    : { x: shoulder.x + ux * d, y: shoulder.y + uy * d };

  return {
    elbow,
    hand: handClamped,
    reachable,
    distance: d0,
    maxReach,
    minReach,
    stretchPct: Math.min(150, (d0 / maxReach) * 100),
  };
}
