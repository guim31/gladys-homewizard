// -----------------------------------------------------------------------------
// The v1 and v2 answers of every model, brought to the same measurement, and
// the feature values Gladys gets from them.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceValues,
  featureKeys,
  featureName,
  mergeKeys,
  stateChangeFor,
} from '../src/devices.js';
import {
  canIdentify,
  familyOf,
  normalizeMeasurement,
  normalizeSerial,
  rssiToPercent,
} from '../src/homewizard/model.js';
import { loadFixture } from '../tools/fake-homewizard.mjs';

const v1 = (name) => normalizeMeasurement(loadFixture(1, name).data);
const v2 = (name) => normalizeMeasurement(loadFixture(2, name).measurement);
const values = (productType, measurement, extra = {}) =>
  deviceValues({ productType, measurement, ...extra });

test('a v1 and a v2 P1 Meter read the same', () => {
  const one = v1('HWE-P1');
  const two = v2('HWE-P1');
  for (const key of [
    'tariff',
    'energy_import_kwh',
    'energy_import_t1_kwh',
    'power_w',
    'power_l2_w',
    'current_l1_a',
  ]) {
    assert.equal(one[key], two[key], key);
  }
  assert.equal(one.tariff, 2);
});

test('an older P1 firmware without totals gets the sum of its tariffs', () => {
  const m = v1('HWE-P1-single-phase');
  assert.equal(m.energy_import_kwh, 13779.338);
  assert.equal(m.energy_export_kwh, 4162.461);
  // Its gas reading is the legacy total_gas_m3.
  assert.deepEqual(m.external, [{ type: 'gas_meter', unit: 'm3', value: 2569.646 }]);
  assert.deepEqual(featureKeys('p1', m), [
    'power-import',
    'power-export',
    'energy-import',
    'energy-export',
    'energy-import-t1',
    'energy-import-t2',
    'energy-export-t1',
    'energy-export-t2',
    'gas',
  ]);
});

test('a P1 Meter splits its signed power into import and export, and reads its external meters', () => {
  const m = v1('HWE-P1-four-tariffs');
  const out = values('HWE-P1', m);
  assert.equal(out['power-import'], 0);
  assert.equal(out['power-export'], 123);
  assert.equal(out['energy-import-t4'], 2948.827);
  assert.equal(out['voltage-l3'], 230.3);
  // The P1 Meter signs the current with the direction: its size is published.
  assert.equal(out['current-l1'], 4);
  // Gas and water come from the M-Bus list; the heat meter in GJ is left out.
  assert.equal(out.gas, 111.111);
  assert.equal(out.water, 222.222);
  assert.equal(values('HWE-P1', { ...m, power_w: 1500.26 })['power-import'], 1500.3);
});

test('an invalid tariff is no tariff', () => {
  assert.equal(normalizeMeasurement({ wifi_ssid: 'x', active_tariff: 7 }).tariff, null);
});

test('a single-tariff meter publishes no tariff index', () => {
  assert.ok(featureKeys('p1', v2('HWE-P1-single-phase')).includes('energy-import-t2'));
  const keys = featureKeys('p1', {
    ...v2('HWE-P1-single-phase'),
    energy_import_t2_kwh: null,
    energy_export_t2_kwh: null,
  });
  assert.ok(!keys.some((key) => key.includes('-t')));
});

test('an Energy Socket: switch, lock and LED from its state', () => {
  const m = v1('HWE-SKT-21');
  const state = loadFixture(1, 'HWE-SKT-21').state;
  assert.deepEqual(featureKeys('socket', m, { state, wifi: 100 }), [
    'switch',
    'power',
    'energy',
    'voltage',
    'current',
    'lock',
    'led',
    'wifi',
  ]);
  const out = values('HWE-SKT', m, { state: { ...state, brightness: 128 }, wifi: 100 });
  assert.equal(out.switch, 1);
  assert.equal(out.lock, 0);
  assert.equal(out.led, 50);
  assert.equal(out.power, 543.3);
  assert.deepEqual(stateChangeFor('switch', 0), { power_on: false });
  assert.deepEqual(stateChangeFor('lock', 1), { switch_lock: true });
  assert.deepEqual(stateChangeFor('led', 100), { brightness: 255 });
  assert.deepEqual(stateChangeFor('led', 150), { brightness: 255 });
  assert.equal(stateChangeFor('power', 1), null);
  assert.throws(() => stateChangeFor('switch', 'on'));
});

test('kWh meters: signed power, phases on the three-phase models only', () => {
  assert.deepEqual(featureKeys('kwh', v1('HWE-KWH1')), [
    'power',
    'energy-import',
    'energy-export',
    'voltage',
    'current',
  ]);
  const three = featureKeys('kwh3', v1('SDM630-wifi'));
  assert.ok(
    three.includes('power-l2') && three.includes('voltage-l3') && !three.includes('voltage'),
  );
  assert.equal(values('HWE-KWH1', v1('HWE-KWH1')).power, -45.3);
  assert.equal(values('SDM230-wifi', v1('SDM230-wifi'))['energy-import'], 2.705);
});

test('the Watermeter flow is converted to m³/h', () => {
  const out = values('HWE-WTR', v1('HWE-WTR'));
  assert.equal(out.flow, 0.787);
  assert.equal(out.total, 8129.123);
});

test('the Plug-In Battery: charging is importing', () => {
  const out = values('HWE-BAT', v2('HWE-BAT'));
  assert.equal(out['charge-power'], 1234);
  assert.equal(out['discharge-power'], 0);
  assert.equal(out.level, 50);
  assert.equal(out['discharge-index'], 321.654);
  assert.equal(values('HWE-BAT', { ...v2('HWE-BAT'), power_w: -800 })['discharge-power'], 800);
});

test('known keys are merged in display order and never dropped', () => {
  assert.deepEqual(mergeKeys('p1', ['gas', 'power-import'], ['energy-import', 'power-export']), [
    'power-import',
    'power-export',
    'energy-import',
    'gas',
  ]);
});

test('names, serials, families, Wi-Fi and identification', () => {
  assert.equal(featureName('voltage-l2', 'fr'), 'Tension L2');
  assert.equal(featureName('energy-export-t3', 'de'), 'Zählerstand Einspeisung T3');
  assert.equal(normalizeSerial('5C:2F:AF:AA:BB:CC'), '5c2fafaabbcc');
  assert.equal(normalizeSerial('xyz'), null);
  assert.equal(familyOf('HWE-DSP'), null);
  assert.equal(familyOf('SDM630-wifi'), 'kwh3');
  assert.equal(rssiToPercent(-77), 46);
  assert.equal(rssiToPercent(-20), 100);
  assert.equal(rssiToPercent(undefined), null);
  assert.equal(canIdentify('HWE-KWH3', 1), false);
  assert.equal(canIdentify('HWE-KWH3', 2), true);
  assert.equal(canIdentify('HWE-P1', 1), true);
});
