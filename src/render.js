// 2D canvas rendering for the rack + arm scene.
// World is in metres; we map to pixels with a fit-to-canvas transform.

import { handlePos, weightPos } from "./physics.js";

const COL = {
  bg: "#0f1115",
  grid: "#1b1f28",
  rack: "#4b5463",
  rackBolt: "#8a93a4",
  arm: "#e0e6f1",
  handle: "#ffd166",
  weight: "#ef476f",
  plate: "#2b2f3a",
  plateRim: "#5b6472",
  cable: "#06d6a0",
  pulley: "#8a93a4",
  pivot: "#ffd166",
  ghost: "rgba(224,230,241,0.14)",
  text: "#c9d0dd",
};

function fitTransform(ctx, bounds) {
  const { width, height } = ctx.canvas;
  const pad = 24;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    toPx: (p) => ({
      x: width / 2 + (p.x - cx) * scale,
      y: height / 2 - (p.y - cy) * scale, // flip Y
    }),
    toLen: (m) => m * scale,
  };
}

function sceneBounds(state) {
  const pts = [
    state.pivot,
    { x: state.pivot.x - 0.2, y: state.pivot.y - 1.4 },
    { x: state.pivot.x + 0.2, y: state.pivot.y + 0.6 },
  ];
  const thetas = [state.romStart, state.romEnd, (state.romStart + state.romEnd) / 2];
  for (const t of thetas) {
    pts.push(handlePos(state, t));
    pts.push(weightPos(state, t));
  }
  if (state.mode === "cable") pts.push(state.pulley);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // margin
  const mx = Math.max(0.25, (maxX - minX) * 0.1);
  const my = Math.max(0.25, (maxY - minY) * 0.1);
  return { minX: minX - mx, maxX: maxX + mx, minY: minY - my, maxY: maxY + my };
}

function drawRack(ctx, T, pivot) {
  const top = T.toPx({ x: pivot.x - 0.04, y: pivot.y + 0.6 });
  const bot = T.toPx({ x: pivot.x - 0.04, y: pivot.y - 1.4 });
  const w = T.toLen(0.08);
  ctx.fillStyle = COL.rack;
  ctx.fillRect(top.x, top.y, w, bot.y - top.y);

  // bolt holes every 0.1 m (rack pin spacing rough)
  ctx.fillStyle = COL.rackBolt;
  for (let y = -1.3; y <= 0.5; y += 0.1) {
    const p = T.toPx({ x: pivot.x, y: pivot.y + y });
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.2, T.toLen(0.01)), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlates(ctx, T, wpPx, state) {
  // Stack of plate-sized disks at the weight-arm tip.
  const kg = state.plateKg;
  const nPlates = Math.max(1, Math.round(kg / 20));
  const rPx = T.toLen(0.23); // ~450mm plate diameter
  for (let i = 0; i < nPlates; i++) {
    const off = (i - (nPlates - 1) / 2) * T.toLen(0.03);
    ctx.beginPath();
    ctx.arc(wpPx.x + off, wpPx.y, rPx, 0, Math.PI * 2);
    ctx.fillStyle = COL.plate;
    ctx.fill();
    ctx.strokeStyle = COL.plateRim;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawCable(ctx, T, wpPx, state) {
  const pulleyPx = T.toPx(state.pulley);
  ctx.strokeStyle = COL.cable;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(wpPx.x, wpPx.y);
  ctx.lineTo(pulleyPx.x, pulleyPx.y);
  // dangle straight down from pulley to represent the stack
  ctx.lineTo(pulleyPx.x, pulleyPx.y + T.toLen(0.9));
  ctx.stroke();

  ctx.fillStyle = COL.pulley;
  ctx.beginPath();
  ctx.arc(pulleyPx.x, pulleyPx.y, Math.max(4, T.toLen(0.04)), 0, Math.PI * 2);
  ctx.fill();

  // weight stack block
  const stackTop = { x: pulleyPx.x - T.toLen(0.12), y: pulleyPx.y + T.toLen(0.9) };
  ctx.fillStyle = COL.plate;
  ctx.fillRect(stackTop.x, stackTop.y, T.toLen(0.24), T.toLen(0.5));
  ctx.strokeStyle = COL.plateRim;
  ctx.strokeRect(stackTop.x, stackTop.y, T.toLen(0.24), T.toLen(0.5));
}

function drawArm(ctx, T, state, theta, alpha = 1) {
  const pivotPx = T.toPx(state.pivot);
  const handlePx = T.toPx(handlePos(state, theta));
  const weightPx = T.toPx(weightPos(state, theta));

  ctx.globalAlpha = alpha;

  // handle arm
  ctx.strokeStyle = COL.arm;
  ctx.lineWidth = Math.max(3, T.toLen(0.04));
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pivotPx.x, pivotPx.y);
  ctx.lineTo(handlePx.x, handlePx.y);
  ctx.stroke();

  // weight arm
  ctx.beginPath();
  ctx.moveTo(pivotPx.x, pivotPx.y);
  ctx.lineTo(weightPx.x, weightPx.y);
  ctx.stroke();

  if (alpha >= 1) {
    // plates or cable
    if (state.mode === "plate") drawPlates(ctx, T, weightPx, state);
    else drawCable(ctx, T, weightPx, state);

    // handle knob
    ctx.fillStyle = COL.handle;
    ctx.beginPath();
    ctx.arc(handlePx.x, handlePx.y, Math.max(5, T.toLen(0.05)), 0, Math.PI * 2);
    ctx.fill();

    // pivot
    ctx.fillStyle = COL.pivot;
    ctx.beginPath();
    ctx.arc(pivotPx.x, pivotPx.y, Math.max(4, T.toLen(0.025)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawArc(ctx, T, state) {
  const pivotPx = T.toPx(state.pivot);
  const r = T.toLen(state.lHandle);
  ctx.strokeStyle = COL.ghost;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // canvas Y is flipped, so invert start/end by negating
  const a0 = -(state.romStart + state.aHandle);
  const a1 = -(state.romEnd + state.aHandle);
  ctx.arc(pivotPx.x, pivotPx.y, r, Math.min(a0, a1), Math.max(a0, a1));
  ctx.stroke();
}

export function renderScene(canvas, state, currentTheta) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const bounds = sceneBounds(state);
  const T = fitTransform(ctx, bounds);

  drawRack(ctx, T, state.pivot);

  // ghosts at ROM ends
  drawArm(ctx, T, state, state.romStart, 0.28);
  drawArm(ctx, T, state, state.romEnd, 0.28);

  // ROM arc
  drawArc(ctx, T, state);

  // current pose
  drawArm(ctx, T, state, currentTheta, 1);
}
