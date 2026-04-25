import assert from "node:assert/strict";
import test from "node:test";

import { solveArmIK } from "../src/body.js";
import {
  effectiveHandleRadius,
  effectiveLever,
  forceAtHandle,
  forceVectorAtHandle,
  sweep,
} from "../src/physics.js";
import { overlaySeries } from "../src/strength-curves.js";

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
