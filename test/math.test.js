import assert from "node:assert/strict";
import test from "node:test";

import { solveArmIK } from "../src/body.js";
import { decodeConfig, encodeConfig, extractConfigString } from "../src/config-codec.js";
import {
  effectiveHandleRadius,
  effectiveLever,
  forceAtHandle,
  forceVectorAtHandle,
  sweep,
} from "../src/physics.js";
import { overlaySeries } from "../src/strength-curves.js";
import {
  defaultVoltraLinearPoints,
  defaultVoltraPoints,
  pointsForVoltraMode,
  resampleVoltraPoints,
  voltraForceKgfAt,
} from "../src/voltra-curve.js";

const G = 9.80665;
const EPS = 1e-9;

function assertClose(actual, expected, tolerance = EPS) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function baseState() {
  return {
    mode: "plate",
    pivot: { x: 0, y: 0 },
    lArm: 1,
    lWeightMount: 0,
    lHandle: 0,
    aHandle: 0,
    lWeight: 1,
    aWeight: 0,
    plateKg: 10,
    plateKgBracket: 0,
    stackKg: 0,
    cableMA: 1,
    voltraMaxKgf: 100,
    voltraCurveMode: "points",
    voltraPointCount: 7,
    voltraPoints: defaultVoltraPoints(7, 40),
    pulley: { x: 0, y: 0 },
    armMassKg: 0,
    armComFrac: 0.5,
    romStart: 0,
    romEnd: Math.PI / 2,
    forceDir: "tangent",
  };
}

test("tangent lever equals fixed handle radius across rotation", () => {
  const state = {
    ...baseState(),
    lArm: 0.58,
    lHandle: 0.29,
    aHandle: -35 * Math.PI / 180,
    forceDir: "tangent",
  };
  const radius = effectiveHandleRadius(state);

  for (const theta of [-1.2, -0.4, 0, 0.7, 1.5]) {
    assertClose(effectiveLever(state, theta), radius);
  }
});

test("body-relative force directions have constant analytical lever arms", () => {
  const state = {
    ...baseState(),
    lArm: 0.58,
    lHandle: 0.29,
    aHandle: 40 * Math.PI / 180,
  };

  state.forceDir = "perpMain";
  const mainLever = state.lArm + state.lHandle * Math.cos(state.aHandle);
  for (const theta of [-1.2, 0, 1.2]) {
    assertClose(effectiveLever(state, theta), mainLever);
  }

  state.forceDir = "perpHandle";
  const handleLever = state.lArm * Math.cos(state.aHandle) + state.lHandle;
  for (const theta of [-1.2, 0, 1.2]) {
    assertClose(effectiveLever(state, theta), handleLever);
  }
});

test("plate torque resolves to the expected handle force", () => {
  const state = baseState();

  assertClose(forceAtHandle(state, 0), 10 * G);
  assertClose(forceAtHandle(state, Math.PI / 2), 0, 1e-12);
});

test("singular force directions are capped only when load torque exists", () => {
  const state = {
    ...baseState(),
    forceDir: "horizontal",
  };

  assert.equal(forceAtHandle({ ...state, plateKg: 0 }, 0), 0);
  assert.equal(forceAtHandle(state, 0), 100000);
  assert.equal(forceVectorAtHandle(state, 0).fN, 100000);
});

test("single-sample sweep and overlays stay finite", () => {
  const state = baseState();
  const samples = sweep(state, 1);
  assert.equal(samples.length, 1);
  assertClose(samples[0].theta, state.romStart);
  assert.ok(Number.isFinite(samples[0].fN));

  const overlay = overlaySeries("ascending", samples);
  assert.equal(overlay.length, 1);
  assert.equal(overlay[0].t, 0);
  assert.ok(Number.isFinite(overlay[0].fN));
});

test("voltra curve interpolates and resamples editable points", () => {
  const points = [
    { t: 0, fKgf: 10 },
    { t: 0.5, fKgf: 30 },
    { t: 1, fKgf: 20 },
  ];

  assertClose(voltraForceKgfAt(points, 0.25, 100), 20);
  assertClose(voltraForceKgfAt(points, 0.75, 100), 25);
  assertClose(voltraForceKgfAt(points, -1, 100), 10);
  assertClose(voltraForceKgfAt(points, 2, 100), 20);

  const resampled = resampleVoltraPoints(points, 5, 100);
  assert.equal(resampled.length, 5);
  assertClose(resampled[0].fKgf, 10);
  assertClose(resampled[2].fKgf, 30);
  assertClose(resampled[4].fKgf, 20);
});

test("voltra linear curve modes keep endpoint-only ascending or descending curves", () => {
  const ascending = pointsForVoltraMode(
    "ascending",
    [{ t: 0, fKgf: 70 }, { t: 0.5, fKgf: 10 }, { t: 1, fKgf: 40 }],
    100,
    7,
  );
  assert.equal(ascending.length, 2);
  assertClose(ascending[0].t, 0);
  assertClose(ascending[1].t, 1);
  assertClose(ascending[0].fKgf, 70);
  assertClose(ascending[1].fKgf, 70);

  const descending = pointsForVoltraMode(
    "descending",
    [{ t: 0, fKgf: 40 }, { t: 1, fKgf: 80 }],
    100,
    7,
  );
  assert.equal(descending.length, 2);
  assertClose(descending[0].fKgf, 40);
  assertClose(descending[1].fKgf, 40);

  const preset = defaultVoltraLinearPoints("descending", 120);
  assert.equal(preset.length, 2);
  assert.ok(preset[0].fKgf >= preset[1].fKgf);
});

test("voltra mode uses the programmed curve as cable source force", () => {
  const state = {
    ...baseState(),
    mode: "voltra",
    lArm: 1,
    lWeightMount: 1,
    lHandle: 0,
    lWeight: 0,
    aWeight: 0,
    pulley: { x: 1, y: 1 },
    plateKg: 0,
    armMassKg: 0,
    romStart: -Math.PI / 4,
    romEnd: Math.PI / 4,
    voltraMaxKgf: 100,
    voltraPoints: [
      { t: 0, fKgf: 12 },
      { t: 0.5, fKgf: 48 },
      { t: 1, fKgf: 24 },
    ],
  };

  const samples = sweep(state, 5);
  for (let i = 0; i < samples.length; i++) {
    const equivalentCable = {
      ...state,
      mode: "cable",
      stackKg: voltraForceKgfAt(state.voltraPoints, i / (samples.length - 1), state.voltraMaxKgf),
    };
    assertClose(samples[i].fKgf, forceAtHandle(equivalentCable, samples[i].theta) / G);
  }
});

test("config strings round-trip simulator UI state compactly", () => {
  const uiState = {
    mode: "voltra",
    pivot: { x: 0, y: 1.37 },
    lArm: 0.579,
    lWeightMount: 0.29,
    lHandle: 0.31,
    aHandle: 14,
    lWeight: 0.45,
    aWeight: -72,
    plateKg: 42.5,
    plateKgBracket: 15,
    stackKg: 37.5,
    cableMA: 1.7,
    voltraMaxKgf: 155,
    voltraCurveMode: "descending",
    voltraPointCount: 7,
    voltraPoints: [
      { t: 0, fKgf: 80 },
      { t: 1, fKgf: 30 },
    ],
    pulley: { x: -0.84, y: 0.52 },
    armMassKg: 6.5,
    armComFrac: 0.47,
    romStart: -22,
    romEnd: 54,
    currentAngle: 8,
    forceDir: "perpMain",
    xAxis: "angle",
    unit: "kgf",
    overlay: "bell",
    animate: false,
    showBody: true,
    userHeight: 1.83,
    benchAngle: 17,
    hipX: 0.91,
    hipY: 0.53,
  };

  const encoded = encodeConfig(uiState);
  assert.match(encoded, /^rx1\.[A-Za-z0-9_-]+$/u);
  assert.ok(encoded.length < 360, `expected compact config, got ${encoded.length} chars`);

  const decoded = decodeConfig(encoded);
  assert.equal(decoded.mode, uiState.mode);
  assertClose(decoded.pivot.y, uiState.pivot.y);
  assertClose(decoded.lArm, uiState.lArm);
  assertClose(decoded.aHandle, uiState.aHandle);
  assertClose(decoded.aWeight, uiState.aWeight);
  assertClose(decoded.pulley.x, uiState.pulley.x);
  assertClose(decoded.pulley.y, uiState.pulley.y);
  assert.equal(decoded.overlay, uiState.overlay);
  assert.equal(decoded.voltraCurveMode, uiState.voltraCurveMode);
  assert.equal(decoded.voltraPoints.length, 2);
  assertClose(decoded.voltraPoints[0].fKgf, uiState.voltraPoints[0].fKgf);
  assertClose(decoded.voltraPoints[1].fKgf, uiState.voltraPoints[1].fKgf);
  assert.equal(
    extractConfigString(`https://example.test/#cfg=${encodeURIComponent(encoded)}`),
    encoded,
  );
});

test("arm IK handles coincident shoulder and hand positions", () => {
  const shoulder = { x: 0, y: 0 };
  const hand = { x: 0, y: 0 };

  const folded = solveArmIK(shoulder, hand, 1, 1);
  assert.deepEqual(folded.hand, hand);
  assert.equal(folded.reachable, true);
  assert.ok(Number.isFinite(folded.elbow.x));
  assert.ok(Number.isFinite(folded.elbow.y));
  assertClose(folded.elbow.y, -1);

  const clamped = solveArmIK(shoulder, hand, 0.5, 0.3);
  assert.equal(clamped.reachable, false);
  assert.ok(Number.isFinite(clamped.elbow.x));
  assert.ok(Number.isFinite(clamped.elbow.y));
  assertClose(clamped.hand.x, 0.2);
});
