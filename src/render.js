// 2D canvas rendering for the RX Mini Arms scene.
// World coords in metres, y-UP. Nothing here affects physics.
//
// Mechanism rendered:
//   - narrow rack post with spaced holes
//   - rack bracket at the pivot (where the main arm hinges)
//   - main arm extending outward from the pivot
//   - weight bracket (indexable dial) along the main arm, with its own
//     short arm ending in a plate-loading peg and stacked plates
//   - handle bracket (indexable dial) at the far end of the main arm,
//     with its own short arm ending in a T-bar grip
//   - optional cable from the weight-arm tip to a pulley + stack

import {
  handlePos, weightPos, handleBracketPos, weightBracketPos,
} from "./physics.js";

// Visual radius for the stacked weight plates, in metres. Intentionally
// oversized vs. real Olympic plates (~0.225 m) so the load is always
// clearly visible on screen, roughly the same scale as the main arm.
const PLATE_RADIUS_M = 0.38;

const COL = {
  bg: "#0f1115",
  rack: "#3a4150",
  rackEdge: "#596274",
  rackHole: "#0a0c10",
  bracket: "#6a7384",
  mainArm: "#c9d0dd",
  mainArmEdge: "#7a8192",
  dial: "#d8dee9",
  dialRim: "#8a93a4",
  dialTick: "#4a5161",
  handleArm: "#ffd166",
  handleGrip: "#ffe39a",
  weightArm: "#ef476f",
  plate: "#2a2f3a",
  plateRim: "#8e95a4",
  plateHub: "#8a93a4",
  cable: "#06d6a0",
  pulleyHousing: "#3a4150",
  pulleyRim: "#8a93a4",
  stack: "#262b36",
  stackRim: "#6a7384",
  ghost: "rgba(224,230,241,0.14)",
};

// ---------- Transform ----------

// X is flipped on screen so the rack (which sits at +x in physics) renders
// on the right side of the canvas and the arm extends to the left — matches
// how you'd look at a rack from inside the training space.
function fitTransform(ctx, bounds) {
  const { width, height } = ctx.canvas;
  const pad = 28;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    toPx: (p) => ({
      x: width / 2 - (p.x - cx) * scale,
      y: height / 2 - (p.y - cy) * scale,
    }),
    toLen: (m) => m * scale,
  };
}

function sceneBounds(state) {
  const pts = [state.pivot];
  // only require a modest rack extent in the scene — enough to show it, not
  // so much that it stretches the view vertically
  pts.push({ x: state.pivot.x + 0.12, y: state.pivot.y - 0.55 });
  pts.push({ x: state.pivot.x + 0.12, y: state.pivot.y + 0.35 });

  const n = 24;
  const plateR = state.mode === "plate" ? PLATE_RADIUS_M : 0;
  for (let i = 0; i <= n; i++) {
    const t = state.romStart + (i / n) * (state.romEnd - state.romStart);
    pts.push(handlePos(state, t));
    pts.push(handleBracketPos(state, t));
    pts.push(weightBracketPos(state, t));
    // include the plate disc footprint around the weight tip so plates
    // don't get clipped at the scene bounds
    const wt = weightPos(state, t);
    pts.push({ x: wt.x + plateR, y: wt.y + plateR });
    pts.push({ x: wt.x - plateR, y: wt.y - plateR });
  }
  if (state.mode === "cable") {
    pts.push(state.pulley);
    pts.push({ x: state.pulley.x, y: state.pulley.y - 1.0 });
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const mx = Math.max(0.3, (maxX - minX) * 0.08);
  const my = Math.max(0.3, (maxY - minY) * 0.08);
  return { minX: minX - mx, maxX: maxX + mx, minY: minY - my, maxY: maxY + my };
}

// ---------- Primitives ----------

function disc(ctx, p, r, fill, stroke, lw = 1.5) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function segment(ctx, a, b, width, fill, stroke) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = fill;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, width * 0.14);
    ctx.stroke();
  }
}

function drawDial(ctx, center, rPx, strong) {
  disc(ctx, center, rPx, COL.dial, COL.dialRim, strong ? 2 : 1.5);
  // tick marks
  ctx.strokeStyle = COL.dialTick;
  ctx.lineWidth = 1;
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const a0 = { x: center.x + Math.cos(a) * rPx * 0.72, y: center.y + Math.sin(a) * rPx * 0.72 };
    const a1 = { x: center.x + Math.cos(a) * rPx * 0.96, y: center.y + Math.sin(a) * rPx * 0.96 };
    ctx.beginPath();
    ctx.moveTo(a0.x, a0.y);
    ctx.lineTo(a1.x, a1.y);
    ctx.stroke();
  }
  disc(ctx, center, Math.max(1.5, rPx * 0.08), COL.dialTick, null);
}

// ---------- Rack ----------

function drawRack(ctx, T, pivot) {
  const postW = 0.08;
  const postX0 = pivot.x + 0.02;
  const topM = pivot.y + 0.7;
  const botM = pivot.y - 1.3;
  const topPx = T.toPx({ x: postX0, y: topM });
  const botPx = T.toPx({ x: postX0 + postW, y: botM });

  ctx.fillStyle = COL.rack;
  ctx.fillRect(topPx.x, topPx.y, botPx.x - topPx.x, botPx.y - topPx.y);
  ctx.strokeStyle = COL.rackEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(topPx.x, topPx.y);
  ctx.lineTo(topPx.x, botPx.y);
  ctx.stroke();

  const holeR = Math.max(1.2, T.toLen(0.012));
  const col1X = postX0 + postW * 0.3;
  const col2X = postX0 + postW * 0.7;
  for (let y = botM + 0.05; y <= topM - 0.02; y += 0.05) {
    disc(ctx, T.toPx({ x: col1X, y }), holeR, COL.rackHole, null);
    disc(ctx, T.toPx({ x: col2X, y }), holeR, COL.rackHole, null);
  }
}

// ---------- Brackets ----------

function drawRackBracket(ctx, T, pivotPx) {
  const bw = T.toLen(0.09);
  const bh = T.toLen(0.14);
  ctx.fillStyle = COL.bracket;
  ctx.fillRect(pivotPx.x - bw * 0.5, pivotPx.y - bh * 0.5, bw, bh);
  // pivot bolt
  disc(ctx, pivotPx, Math.max(3, T.toLen(0.018)), COL.dialTick, null);
}

// ---------- Main arm + sub-arms ----------

function drawMainArm(ctx, T, state, theta, alpha = 1) {
  const pivotPx = T.toPx(state.pivot);
  const endPx = T.toPx(handleBracketPos(state, theta));

  ctx.globalAlpha = alpha;
  const w = Math.max(6, T.toLen(0.045));
  segment(ctx, pivotPx, endPx, w, COL.mainArm, COL.mainArmEdge);
  ctx.globalAlpha = 1;
}

function drawSubArmAndEnd(ctx, T, state, theta, kind, alpha = 1) {
  const bracketPx = T.toPx(
    kind === "handle" ? handleBracketPos(state, theta) : weightBracketPos(state, theta)
  );
  const tipPx = T.toPx(kind === "handle" ? handlePos(state, theta) : weightPos(state, theta));
  const color = kind === "handle" ? COL.handleArm : COL.weightArm;
  const w = Math.max(4, T.toLen(0.028));

  ctx.globalAlpha = alpha;
  segment(ctx, bracketPx, tipPx, w, color, COL.mainArmEdge);
  if (alpha >= 1) {
    if (kind === "handle") drawHandleGrip(ctx, T, state, theta, tipPx);
    else drawWeightPegAndPlates(ctx, T, state, theta, tipPx);
  }
  ctx.globalAlpha = 1;
}

function armDir(state, theta, kind) {
  const a = theta + (kind === "handle" ? state.aHandle : state.aWeight);
  return { x: Math.cos(a), y: Math.sin(a) };
}
function perp(v) { return { x: -v.y, y: v.x }; }

function drawHandleGrip(ctx, T, state, theta, tipPx) {
  const d = armDir(state, theta, "handle");
  const p = perp(d);
  // canvas has both x and y flipped relative to world coords
  const screenP = { x: -p.x, y: -p.y };
  const half = T.toLen(0.11);
  const a = { x: tipPx.x - screenP.x * half, y: tipPx.y - screenP.y * half };
  const b = { x: tipPx.x + screenP.x * half, y: tipPx.y + screenP.y * half };
  segment(ctx, a, b, Math.max(4, T.toLen(0.024)), COL.handleGrip, COL.mainArmEdge);
  disc(ctx, a, Math.max(3, T.toLen(0.016)), COL.handleGrip, COL.mainArmEdge, 1);
  disc(ctx, b, Math.max(3, T.toLen(0.016)), COL.handleGrip, COL.mainArmEdge, 1);
  disc(ctx, tipPx, Math.max(2.5, T.toLen(0.012)), COL.handleArm, COL.mainArmEdge, 1);
}

function drawWeightPegAndPlates(ctx, T, state, theta, tipPx) {
  // The peg sticks out of the page; in the 2D side view it appears as a
  // short collinear stub at the tip, with stacked plates drawn as discs.
  const d = armDir(state, theta, "weight");
  const screenDir = { x: -d.x, y: -d.y };
  const stubLen = T.toLen(0.05);
  const stubEnd = {
    x: tipPx.x + screenDir.x * stubLen,
    y: tipPx.y + screenDir.y * stubLen,
  };
  segment(ctx, tipPx, stubEnd, Math.max(4, T.toLen(0.022)), COL.plateHub, COL.mainArmEdge);

  const kg = state.plateKg;
  const nPlates = Math.max(1, Math.round(kg / 20));
  const rOuter = Math.max(12, T.toLen(PLATE_RADIUS_M));
  const rHole = Math.max(2, T.toLen(0.025));
  for (let i = 0; i < nPlates; i++) {
    const r = rOuter * (1 - i * 0.025);
    disc(ctx, tipPx, r, COL.plate, COL.plateRim, 1.5);
  }
  disc(ctx, tipPx, rHole, COL.plateHub, COL.plateRim, 1);
}

// ---------- Cable ----------

function drawCable(ctx, T, state, theta) {
  const weightTip = T.toPx(weightPos(state, theta));
  const pulleyPx = T.toPx(state.pulley);

  ctx.strokeStyle = COL.cable;
  ctx.lineWidth = Math.max(1.8, T.toLen(0.006));
  ctx.beginPath();
  ctx.moveTo(weightTip.x, weightTip.y);
  ctx.lineTo(pulleyPx.x, pulleyPx.y);
  ctx.lineTo(pulleyPx.x, pulleyPx.y + T.toLen(0.9));
  ctx.stroke();

  const rHousing = Math.max(6, T.toLen(0.055));
  disc(ctx, pulleyPx, rHousing, COL.pulleyHousing, COL.pulleyRim, 1.5);
  disc(ctx, pulleyPx, rHousing * 0.55, COL.dial, COL.pulleyRim, 1);

  const stackW = T.toLen(0.24);
  const stackH = T.toLen(0.5);
  const sx = pulleyPx.x - stackW * 0.5;
  const sy = pulleyPx.y + T.toLen(0.9);
  ctx.fillStyle = COL.stack;
  ctx.fillRect(sx, sy, stackW, stackH);
  ctx.strokeStyle = COL.stackRim;
  ctx.strokeRect(sx, sy, stackW, stackH);
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const y = sy + (i / 8) * stackH;
    ctx.beginPath();
    ctx.moveTo(sx, y);
    ctx.lineTo(sx + stackW, y);
    ctx.stroke();
  }
}

// ---------- ROM hints ----------

function drawRomArcs(ctx, T, state) {
  const pivotPx = T.toPx(state.pivot);
  ctx.strokeStyle = COL.ghost;
  ctx.lineWidth = 1.2;

  // Since the whole body is rigid, the handle tip traces a perfect circle
  // around the rack pivot with constant radius. Draw that arc.
  const drawArc = (worldR, thetaOffset = 0) => {
    const r = T.toLen(worldR);
    // canvas has both x and y flipped relative to world coords
    const pA = { x: -Math.cos(state.romStart + thetaOffset), y: -Math.sin(state.romStart + thetaOffset) };
    const pB = { x: -Math.cos(state.romEnd + thetaOffset), y: -Math.sin(state.romEnd + thetaOffset) };
    const a0 = Math.atan2(pA.y, pA.x);
    const a1 = Math.atan2(pB.y, pB.x);
    ctx.beginPath();
    ctx.arc(pivotPx.x, pivotPx.y, r, Math.min(a0, a1), Math.max(a0, a1));
    ctx.stroke();
  };

  // compute absolute angle from pivot to handle/weight tip at theta=0
  const hTipOff = Math.atan2(
    handlePos(state, 0).y - state.pivot.y,
    handlePos(state, 0).x - state.pivot.x
  );
  const wTipOff = Math.atan2(
    weightPos(state, 0).y - state.pivot.y,
    weightPos(state, 0).x - state.pivot.x
  );
  const rH = Math.hypot(
    handlePos(state, 0).x - state.pivot.x,
    handlePos(state, 0).y - state.pivot.y
  );
  const rW = Math.hypot(
    weightPos(state, 0).x - state.pivot.x,
    weightPos(state, 0).y - state.pivot.y
  );
  drawArc(rH, hTipOff);
  drawArc(rW, wTipOff);
}

// ---------- Main ----------

export function renderScene(canvas, state, currentTheta) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const bounds = sceneBounds(state);
  const T = fitTransform(ctx, bounds);

  drawRack(ctx, T, state.pivot);
  drawRomArcs(ctx, T, state);

  // Ghost poses at ROM ends
  for (const theta of [state.romStart, state.romEnd]) {
    drawMainArm(ctx, T, state, theta, 0.18);
    drawSubArmAndEnd(ctx, T, state, theta, "weight", 0.18);
    drawSubArmAndEnd(ctx, T, state, theta, "handle", 0.18);
  }

  // Active pose: main arm first, then sub-arms so brackets cleanly overlap.
  drawMainArm(ctx, T, state, currentTheta, 1);

  // Dials at each bracket, on top of the main arm
  const weightBkPx = T.toPx(weightBracketPos(state, currentTheta));
  const handleBkPx = T.toPx(handleBracketPos(state, currentTheta));
  drawDial(ctx, weightBkPx, Math.max(9, T.toLen(0.055)), false);
  drawDial(ctx, handleBkPx, Math.max(10, T.toLen(0.06)), true);

  drawSubArmAndEnd(ctx, T, state, currentTheta, "weight", 1);
  drawSubArmAndEnd(ctx, T, state, currentTheta, "handle", 1);

  if (state.mode === "cable") drawCable(ctx, T, state, currentTheta);

  // Rack bracket over everything at the pivot.
  drawRackBracket(ctx, T, T.toPx(state.pivot));
}
