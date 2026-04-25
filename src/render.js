// 2D canvas rendering for the RX Mini Arms scene.
// World coords in metres, y-UP. Nothing here affects physics.
//
// Mechanism rendered:
//   - narrow rack post with spaced holes
//   - rack bracket at the pivot (where the main arm hinges)
//   - black rectangular RX arm body with product-style indexed plates
//   - handle extension and force-curve/weight horn as locked indexed arms
//   - optional cable from the force-curve horn to a pulley + stack

import {
  handlePos, weightPos, handleBracketPos, weightBracketPos,
  forceVectorAtHandle,
} from "./physics.js";
import { anatomy, shoulderPos, solveArmIK } from "./body.js";

// Visual radius for the stacked weight plates, in metres. Deliberately
// compact so the plates don't dominate the scene.
const PLATE_RADIUS_M = 0.08;

const COL = {
  bg: "#0f1115",
  rack: "#242936",
  rackEdge: "#596274",
  rackHole: "#0a0c10",
  bracket: "#4b5361",
  mainArm: "#171a20",
  mainArmEdge: "#596274",
  armHighlight: "#2b3039",
  dial: "#cfd3da",
  dialRim: "#7b8491",
  dialTick: "#222731",
  handleArm: "#1d2128",
  handleGrip: "#d7dce3",
  weightArm: "#1d2128",
  plate: "#2a2f3a",
  plateRim: "#8e95a4",
  plateHub: "#c2c8d0",
  steel: "#c2c8d0",
  steelEdge: "#737c89",
  label: "#eef2f7",
  labelText: "#2d333d",
  loadAnchor: "#ef476f",
  cable: "#06d6a0",
  forceArrow: "#64b5ff",
  forceArrowHalo: "rgba(100, 181, 255, 0.25)",
  bench: "#2e323d",
  benchEdge: "#4a5161",
  benchPad: "#3b424f",
  bodySkin: "#9aa2b2",
  bodyLine: "#c9d0dd",
  bodyUnreachable: "#ef476f",
  bodyGhost: "rgba(201, 208, 221, 0.18)",
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
  const w = Math.max(1e-6, bounds.maxX - bounds.minX);
  const h = Math.max(1e-6, bounds.maxY - bounds.minY);
  const drawW = Math.max(1, width - 2 * pad);
  const drawH = Math.max(1, height - 2 * pad);
  const scale = Math.min(drawW / w, drawH / h);
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

  if (state.showBody) {
    const s = shoulderPos(state);
    const a = anatomy(state.userHeight);
    pts.push({ x: state.hipX, y: state.hipY });
    pts.push({ x: state.hipX + 0.45, y: state.hipY - 0.05 }); // towards feet
    pts.push({ x: s.x, y: s.y + a.head * 2 + a.neck });         // crown
    pts.push({ x: state.hipX, y: 0 });                          // floor
  }

  const n = 24;
  const tipPlateR = state.mode === "plate" && state.plateKg > 0 ? PLATE_RADIUS_M : 0;
  const bktPlateR = state.plateKgBracket > 0 ? PLATE_RADIUS_M : 0;
  for (let i = 0; i <= n; i++) {
    const t = state.romStart + (i / n) * (state.romEnd - state.romStart);
    pts.push(handlePos(state, t));
    pts.push(handleBracketPos(state, t));
    // include the plate disc footprints around the weight tip and bracket
    // so the stacked plates never get clipped at the scene edge
    const wt = weightPos(state, t);
    const wb = weightBracketPos(state, t);
    pts.push({ x: wt.x + tipPlateR, y: wt.y + tipPlateR });
    pts.push({ x: wt.x - tipPlateR, y: wt.y - tipPlateR });
    pts.push({ x: wb.x + bktPlateR, y: wb.y + bktPlateR });
    pts.push({ x: wb.x - bktPlateR, y: wb.y - bktPlateR });
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

function roundedRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }

  const rr = Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}

function worldTube(ctx, T, a, b, widthM, fill, stroke, alpha = 1) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return;

  const nx = (-dy / len) * widthM * 0.5;
  const ny = (dx / len) * widthM * 0.5;
  const pts = [
    T.toPx({ x: a.x + nx, y: a.y + ny }),
    T.toPx({ x: b.x + nx, y: b.y + ny }),
    T.toPx({ x: b.x - nx, y: b.y - ny }),
    T.toPx({ x: a.x - nx, y: a.y - ny }),
  ];

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, T.toLen(0.006));
    ctx.stroke();
  }
  ctx.restore();
}

function drawDial(ctx, center, rPx, strong) {
  disc(ctx, center, rPx, COL.dial, COL.dialRim, strong ? 2 : 1.5);

  // Product-style adjustment holes around the indexing plate.
  const n = 18;
  const holeR = Math.max(1.8, rPx * 0.075);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * 0.9 + (i / (n - 1)) * Math.PI * 1.8;
    const p = {
      x: center.x + Math.cos(a) * rPx * 0.76,
      y: center.y + Math.sin(a) * rPx * 0.76,
    };
    disc(ctx, p, holeR, COL.bg, COL.dialRim, Math.max(0.75, rPx * 0.012));
  }
  disc(ctx, center, rPx * 0.42, COL.mainArm, COL.dialRim, strong ? 2 : 1.5);
  disc(ctx, center, Math.max(2.5, rPx * 0.16), COL.bg, COL.dialRim, 1);
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
  disc(ctx, pivotPx, Math.max(5, T.toLen(0.026)), COL.steel, COL.steelEdge, 1.5);
  disc(ctx, pivotPx, Math.max(2, T.toLen(0.012)), COL.dialTick, null);
}

// ---------- Main arm + sub-arms ----------

function armUnit(theta) {
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

function offsetPoint(p, u, dist) {
  return { x: p.x + u.x * dist, y: p.y + u.y * dist };
}

function drawMainArm(ctx, T, state, theta, alpha = 1) {
  const u = armUnit(theta);
  const a = offsetPoint(state.pivot, u, 0.035);
  const b = offsetPoint(handleBracketPos(state, theta), u, -0.035);
  worldTube(ctx, T, a, b, 0.075, COL.mainArm, COL.mainArmEdge, alpha);

  // Subtle top highlight gives the black rectangular tube visible shape.
  ctx.save();
  ctx.globalAlpha = alpha * 0.55;
  segment(
    ctx,
    T.toPx(offsetPoint(a, { x: -u.y, y: u.x }, 0.024)),
    T.toPx(offsetPoint(b, { x: -u.y, y: u.x }, 0.024)),
    Math.max(1, T.toLen(0.006)),
    COL.armHighlight,
    null,
  );
  ctx.restore();

  // Clevis/pivot end plate and a small product label on the tube.
  const pivotPx = T.toPx(state.pivot);
  ctx.save();
  ctx.globalAlpha = alpha;
  disc(ctx, pivotPx, Math.max(9, T.toLen(0.056)), COL.mainArm, COL.mainArmEdge, 2);
  drawArmLabel(ctx, T, state, theta, alpha);
  ctx.restore();
}

function drawArmLabel(ctx, T, state, theta, alpha) {
  if (alpha < 0.9 || T.toLen(state.lArm) < 120) return;
  const u = armUnit(theta);
  const center = T.toPx(offsetPoint(state.pivot, u, state.lArm * 0.55));
  const end = T.toPx(offsetPoint(state.pivot, u, state.lArm * 0.75));
  const angle = Math.atan2(end.y - center.y, end.x - center.x);
  const w = Math.max(46, T.toLen(0.17));
  const h = Math.max(9, T.toLen(0.026));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  ctx.fillStyle = COL.label;
  ctx.strokeStyle = COL.steelEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  roundedRectPath(ctx, -w * 0.5, -h * 0.5, w, h, h * 0.28);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COL.labelText;
  ctx.font = `${Math.max(7, Math.min(12, h * 0.78))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PUSH N PULL", 0, 0.5);
  ctx.restore();
}

function drawSubArmAndEnd(ctx, T, state, theta, kind, alpha = 1) {
  const bracket = kind === "handle" ? handleBracketPos(state, theta) : weightBracketPos(state, theta);
  const tip = kind === "handle" ? handlePos(state, theta) : weightPos(state, theta);
  const bracketPx = T.toPx(bracket);
  const tipPx = T.toPx(tip);
  const color = kind === "handle" ? COL.handleArm : COL.weightArm;

  worldTube(ctx, T, bracket, tip, 0.046, color, COL.mainArmEdge, alpha);
  if (alpha >= 1) {
    if (kind === "handle") drawHandleGrip(ctx, T, state, theta, tipPx);
    else drawWeightPegAndPlates(ctx, T, state, theta, tipPx);
  }

  // Visible spring-pin/locking knob on each indexed extension.
  ctx.save();
  ctx.globalAlpha = alpha;
  disc(ctx, bracketPx, Math.max(4, T.toLen(0.021)), COL.steel, COL.steelEdge, 1);
  ctx.restore();
}

function drawHandleGrip(ctx, T, state, theta, tipPx) {
  drawCylindricalPeg(ctx, T, tipPx, 0.035, 0.16, COL.handleGrip, COL.steelEdge);
  disc(ctx, tipPx, Math.max(4, T.toLen(0.02)), COL.handleArm, COL.mainArmEdge, 1);
}

function drawCylindricalPeg(ctx, T, basePx, radiusM, lengthM, fill, stroke) {
  // Side-view approximation of an out-of-plane cylindrical handle/horn.
  const r = Math.max(5, T.toLen(radiusM));
  const len = Math.max(16, T.toLen(lengthM));
  const dir = { x: -0.92, y: -0.18 };
  const end = { x: basePx.x + dir.x * len, y: basePx.y + dir.y * len };

  segment(ctx, basePx, end, r * 1.55, fill, stroke);
  disc(ctx, end, r, fill, stroke, 1.5);
  disc(ctx, end, r * 0.58, "rgba(255,255,255,0.12)", null);
}

// Plates loaded on the horn at the weight bracket — rendered as a stack of
// discs centred on the bracket position, behind the dial.
function drawBracketPlates(ctx, T, bracketPx, kg) {
  const nPlates = Math.max(1, Math.round(kg / 20));
  const rOuter = Math.max(10, T.toLen(PLATE_RADIUS_M));
  const rHole = Math.max(2, T.toLen(0.025));
  for (let i = 0; i < nPlates; i++) {
    const r = rOuter * (1 - i * 0.025);
    disc(ctx, bracketPx, r, COL.plate, COL.plateRim, 1.5);
  }
  disc(ctx, bracketPx, rHole, COL.plateHub, COL.plateRim, 1);
}

function drawWeightPegAndPlates(ctx, T, state, theta, tipPx) {
  drawCylindricalPeg(ctx, T, tipPx, 0.026, 0.10, COL.plateHub, COL.mainArmEdge);

  const kg = state.mode === "plate" ? state.plateKg : 0;
  if (kg <= 0) return;
  const nPlates = Math.max(1, Math.round(kg / 20));
  const rOuter = Math.max(12, T.toLen(PLATE_RADIUS_M));
  const rHole = Math.max(2, T.toLen(0.025));
  for (let i = 0; i < nPlates; i++) {
    const r = rOuter * (1 - i * 0.025);
    disc(ctx, tipPx, r, COL.plate, COL.plateRim, 1.5);
  }
  disc(ctx, tipPx, rHole, COL.plateHub, COL.plateRim, 1);
}

function drawForceCurveGuide(ctx, T, state, theta) {
  if (state.mode !== "cable") return;

  const radiusM = Math.max(0.14, Math.min(0.32, state.lWeightMount + 0.08));
  const start = theta - 0.42;
  const end = theta + 0.95;
  const steps = 20;

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = COL.dialRim;
  ctx.lineWidth = Math.max(6, T.toLen(0.03));
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = start + (i / steps) * (end - start);
    const p = T.toPx({
      x: state.pivot.x + radiusM * Math.cos(a),
      y: state.pivot.y + radiusM * Math.sin(a),
    });
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  ctx.globalAlpha = 0.9;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = start + (i / (n - 1)) * (end - start);
    const p = T.toPx({
      x: state.pivot.x + radiusM * Math.cos(a),
      y: state.pivot.y + radiusM * Math.sin(a),
    });
    disc(ctx, p, Math.max(2.2, T.toLen(0.012)), COL.bg, COL.steelEdge, 1);
  }

  const anchor = T.toPx(weightBracketPos(state, theta));
  disc(ctx, anchor, Math.max(4, T.toLen(0.018)), COL.loadAnchor, COL.steelEdge, 1.5);
  ctx.restore();
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
  ctx.strokeStyle = COL.ghost;
  ctx.lineWidth = 1.2;

  // Since the whole body is rigid, the handle tip traces a perfect circle
  // around the rack pivot with constant radius. Draw that arc.
  const drawArc = (worldR, thetaOffset = 0) => {
    const steps = Math.max(2, Math.ceil(Math.abs(state.romEnd - state.romStart) / (Math.PI / 48)));
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const theta = state.romStart + t * (state.romEnd - state.romStart) + thetaOffset;
      const p = T.toPx({
        x: state.pivot.x + worldR * Math.cos(theta),
        y: state.pivot.y + worldR * Math.sin(theta),
      });
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
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

// ---------- Bench + body ----------

function rotateAroundCW(p, origin, angleRad) {
  const dx = p.x - origin.x, dy = p.y - origin.y;
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return { x: origin.x + dx * c + dy * s, y: origin.y - dx * s + dy * c };
}

function drawBench(ctx, T, state) {
  const hip = { x: state.hipX, y: state.hipY };
  const headEnd = { x: hip.x - 0.75, y: hip.y };
  const footEnd = { x: hip.x + 0.40, y: hip.y };
  const angleRad = state.benchAngle * Math.PI / 180;

  const headRot = rotateAroundCW(headEnd, hip, angleRad);
  const footRot = footEnd; // keep foot end at hipY for simplicity (typical adjustable bench)

  const thickness = 0.08;
  // pad polygon (top surface)
  const up = { x: -Math.sin(angleRad), y: Math.cos(angleRad) };
  const padTopHead = headRot;
  const padTopFoot = footRot;
  const padBotHead = { x: headRot.x - up.x * thickness, y: headRot.y - up.y * thickness };
  const padBotFoot = { x: footRot.x, y: footRot.y - thickness };

  ctx.fillStyle = COL.bench;
  ctx.strokeStyle = COL.benchEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const a = T.toPx(padTopHead), b = T.toPx(padTopFoot);
  const c = T.toPx(padBotFoot), d = T.toPx(padBotHead);
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
  ctx.fill(); ctx.stroke();

  // hip-pivot base block (support under bench)
  ctx.fillStyle = COL.bench;
  const basePx = T.toPx({ x: hip.x, y: state.hipY - thickness });
  const baseW = T.toLen(0.12);
  const baseH = T.toLen(state.hipY - thickness); // down to floor
  ctx.fillRect(basePx.x - baseW / 2, basePx.y, baseW, baseH);

  return {
    headEnd: headRot,
    padTopHead,
    padTopFoot,
  };
}

function drawBody(ctx, T, state, handlePoint) {
  const a = anatomy(state.userHeight);
  const hip = { x: state.hipX, y: state.hipY };
  const shoulder = shoulderPos(state);

  // torso line (hip → shoulder), rising along the bench
  ctx.strokeStyle = COL.bodyLine;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(5, T.toLen(0.09));
  const hipPx = T.toPx(hip);
  const shPx = T.toPx(shoulder);
  ctx.beginPath();
  ctx.moveTo(hipPx.x, hipPx.y);
  ctx.lineTo(shPx.x, shPx.y);
  ctx.stroke();

  // head — positioned in the direction continuing along the torso from shoulder
  const torsoUx = (shoulder.x - hip.x) / Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  const torsoUy = (shoulder.y - hip.y) / Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  const headCenter = {
    x: shoulder.x + torsoUx * (a.neck + a.head),
    y: shoulder.y + torsoUy * (a.neck + a.head),
  };
  const headPx = T.toPx(headCenter);
  const rHead = Math.max(8, T.toLen(a.head));
  ctx.fillStyle = COL.bodySkin;
  ctx.strokeStyle = COL.bodyLine;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(headPx.x, headPx.y, rHead, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // arm via IK
  const ik = solveArmIK(shoulder, handlePoint, a.upper, a.forearm);
  const elbowPx = T.toPx(ik.elbow);
  const handPx = T.toPx(ik.hand);
  const color = ik.reachable ? COL.bodyLine : COL.bodyUnreachable;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(4, T.toLen(0.06));
  ctx.beginPath();
  ctx.moveTo(shPx.x, shPx.y);
  ctx.lineTo(elbowPx.x, elbowPx.y);
  ctx.lineTo(handPx.x, handPx.y);
  ctx.stroke();

  // shoulder + elbow joints
  ctx.fillStyle = color;
  [shPx, elbowPx, handPx].forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, T.toLen(0.02)), 0, Math.PI * 2);
    ctx.fill();
  });

  return ik;
}

// ---------- Main ----------

export function renderScene(canvas, state, currentTheta) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const bounds = sceneBounds(state);
  const T = fitTransform(ctx, bounds);

  drawRack(ctx, T, state.pivot);
  if (state.showBody) drawBench(ctx, T, state);
  drawRomArcs(ctx, T, state);
  drawForceCurveGuide(ctx, T, state, currentTheta);

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

  // Plates loaded directly on the horn at the weight bracket.
  if (state.plateKgBracket > 0) {
    drawBracketPlates(ctx, T, weightBkPx, state.plateKgBracket);
  }

  if (state.mode === "cable") drawCable(ctx, T, state, currentTheta);

  // User body with arm connected to the handle at the current pose.
  if (state.showBody) drawBody(ctx, T, state, handlePos(state, currentTheta));

  // Force arrow at the handle, on top of the arm but below the rack bracket.
  drawForceArrow(ctx, T, state, currentTheta);

  // Rack bracket over everything at the pivot.
  drawRackBracket(ctx, T, T.toPx(state.pivot));
}

// Force arrow: shows the direction and relative magnitude of the force the
// user applies at the handle tip under `state.forceDir`. Length scales with
// the force magnitude against a running reference so the arrow stays a
// useful size regardless of load.
function drawForceArrow(ctx, T, state, theta) {
  const fv = forceVectorAtHandle(state, theta);
  if (!isFinite(fv.fN) || fv.fN < 1) return;
  const h = handlePos(state, theta);
  const tipPx = T.toPx(h);

  // canvas has both x and y flipped vs world coords
  const screenDir = { x: -fv.dir.x, y: -fv.dir.y };

  // Map force magnitude to arrow length. 1000 N (~100 kgf) → 120 px.
  const maxLen = 140;
  const len = Math.min(maxLen, 30 + fv.fN * 0.11);

  const start = tipPx;
  const end = { x: tipPx.x + screenDir.x * len, y: tipPx.y + screenDir.y * len };

  // halo for visibility over busy scene
  ctx.strokeStyle = COL.forceArrowHalo;
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  ctx.strokeStyle = COL.forceArrow;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  // arrowhead
  const headLen = 12;
  const headAng = 0.45;
  const ang = Math.atan2(screenDir.y, screenDir.x);
  const h1 = { x: end.x - headLen * Math.cos(ang - headAng), y: end.y - headLen * Math.sin(ang - headAng) };
  const h2 = { x: end.x - headLen * Math.cos(ang + headAng), y: end.y - headLen * Math.sin(ang + headAng) };
  ctx.fillStyle = COL.forceArrow;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(h1.x, h1.y);
  ctx.lineTo(h2.x, h2.y);
  ctx.closePath();
  ctx.fill();
}
