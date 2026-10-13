// -----------------------------------------------------------------------------
// Scene triggers: the grid power of a P1 Meter crossing a threshold.
//
// The scene filters of Gladys only compare for equality: a threshold cannot be
// a filter on a power. So the container fires one event per step of a fixed
// ladder the power goes up through, carrying the step as `threshold`; the
// scene picks its step in a required select. A step fires once, and is
// re-armed when the power is back below it by REARM_RATIO (at least
// REARM_MIN_W), so a power wobbling around a step does not repeat it.
//
// Nothing fires on the first reading of a meter: a house already exporting
// 2 kW when the integration starts is a state, not a crossing.
// -----------------------------------------------------------------------------

export const TRIGGERS = {
  EXPORT_ABOVE: 'grid_export_above',
  IMPORT_ABOVE: 'grid_import_above',
};

// The steps offered in the scene editor (W).
export const THRESHOLDS = [100, 250, 500, 1000, 1500, 2000, 3000, 5000, 8000];
export const DEFAULT_THRESHOLD = 500;
export const REARM_RATIO = 0.1;
export const REARM_MIN_W = 50;

/**
 * Compare a power with the steps already fired for it.
 * @param {number} value power now (W, >= 0)
 * @param {number[]|undefined} fired steps fired and not re-armed yet;
 *   undefined on the first reading
 * @returns {{ fired: number[], crossed: number[] }} the new fired list, and
 *   the steps crossed now (to fire), lowest first
 */
export function evaluatePower(value, fired) {
  const firstReading = fired === undefined;
  const next = [];
  const crossed = [];
  for (const threshold of THRESHOLDS) {
    const wasFired = !firstReading && fired.includes(threshold);
    if (value > threshold) {
      next.push(threshold);
      if (!firstReading && !wasFired) {
        crossed.push(threshold);
      }
    } else if (wasFired && value > threshold - Math.max(threshold * REARM_RATIO, REARM_MIN_W)) {
      next.push(threshold); // not far enough below the step yet
    }
  }
  return { fired: next, crossed };
}
