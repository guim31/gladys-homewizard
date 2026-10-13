import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THRESHOLDS, evaluatePower } from '../src/triggers.js';

test('nothing fires on the first reading', () => {
  const { fired, crossed } = evaluatePower(1200, undefined);
  assert.deepEqual(crossed, []);
  assert.deepEqual(fired, [100, 250, 500, 1000]);
});

test('each step fires once on the way up', () => {
  let state = evaluatePower(0, undefined).fired;
  const step = (value) => {
    const result = evaluatePower(value, state);
    state = result.fired;
    return result.crossed;
  };
  assert.deepEqual(step(600), [100, 250, 500]);
  assert.deepEqual(step(700), []);
  assert.deepEqual(step(480), [], 'within the re-arm margin of 500 W');
  assert.deepEqual(step(520), []);
  assert.deepEqual(step(440), [], 'below 450 W: 500 re-armed');
  assert.deepEqual(step(510), [500]);
  assert.deepEqual(step(9000), [1000, 1500, 2000, 3000, 5000, 8000]);
  assert.deepEqual(step(0), []);
  assert.deepEqual(state, []);
});

test('the margin is 10 %, at least 50 W', () => {
  let state = evaluatePower(0, undefined).fired;
  state = evaluatePower(150, state).fired;
  assert.ok(evaluatePower(60, state).fired.includes(100), '100 W re-arms below 50 W');
  assert.ok(!evaluatePower(40, state).fired.includes(100));
  assert.deepEqual(
    THRESHOLDS,
    [...THRESHOLDS].sort((a, b) => a - b),
  );
});
