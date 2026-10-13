// -----------------------------------------------------------------------------
// The "Live energy" widget: vocabulary and budget of the core
// (validateWidgetContent), live tiles bound to features that exist, the
// values deduced with a solar meter.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { SERIALS, createAll, createWorld, deviceId, fake } from './helpers/world.js';

const KWH = '5c2fafa00020';

async function world({ create = true } = {}) {
  const meter = await fake({ model: 'HWE-P1-four-tariffs', serial: SERIALS.P1 });
  const solar = await fake({ model: 'HWE-KWH1', serial: KWH });
  const w = await createWorld({ devices: [meter, solar] });
  if (create) {
    await createAll(w);
  }
  return { w, meter, solar };
}

const content = async (w, settings, language = 'en') => {
  const ack = await w.fake.widgetGet('live_energy', { settings, language });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

const byLabel = (components, label) => components.find((component) => component.label === label);

test('without settings: the first P1 Meter, a signed gauge, live tiles, a hint for solar', async (t) => {
  const { w, meter } = await world();
  t.after(() => w.stop());
  meter.setPower(-1500);
  await w.hub.pollAll();
  const c = await content(w, {});
  assert.deepEqual(validateWidgetContent(c), []);
  const gauge = c.components.find((component) => component.type === 'gauge');
  assert.deepEqual(
    [gauge.value, gauge.min, gauge.max, gauge.color],
    [-1500, -5000, 5000, 'success'],
  );
  // The live tiles are bound to features the device really has.
  const features = w.fake.devices.flatMap((device) => device.features.map((f) => f.external_id));
  for (const tile of c.components.filter((component) => component.device_feature)) {
    assert.ok(features.includes(tile.device_feature), tile.device_feature);
  }
  assert.equal(byLabel(c.components, 'Import').device_feature.endsWith(':power-import'), true);
  assert.ok(
    c.components.some((component) => component.type === 'text' && /kWh meter/.test(component.text)),
  );
  const status = c.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => item.value),
    ['T2', '111.111 m³', 'read'],
  );
});

test('with a solar kWh meter: production and house consumption', async (t) => {
  const { w, meter, solar } = await world();
  t.after(() => w.stop());
  meter.setPower(-1000); // exporting 1 kW
  solar.setPower(-3000); // the inverter produces 3 kW
  await w.hub.pollAll();
  const c = await content(
    w,
    {
      meter: deviceId(w.gladys, 'p1', SERIALS.P1),
      solar: deviceId(w.gladys, 'kwh', KWH),
    },
    'fr',
  );
  assert.deepEqual(validateWidgetContent(c), []);
  assert.equal(byLabel(c.components, 'Solaire').value, 3000);
  assert.equal(byLabel(c.components, 'Maison').value, 2000);
  assert.ok(!c.components.some((component) => component.type === 'text'));
  // Big powers widen the gauge.
  meter.setPower(7300);
  await w.hub.pollAll();
  const wide = await content(w, {});
  const gauge = wide.components.find((component) => component.type === 'gauge');
  assert.deepEqual([gauge.min, gauge.max, gauge.color], [-8000, 8000, 'warning']);
});

test('before the device is added to Gladys, the tiles carry the values themselves', async (t) => {
  const { w } = await world({ create: false });
  t.after(() => w.stop());
  const c = await content(w, {});
  assert.deepEqual(validateWidgetContent(c), []);
  assert.equal(byLabel(c.components, 'Export').value, 123);
});

test('no P1 Meter, or another device chosen: a sentence says what to do', async (t) => {
  const empty = await createWorld({ devices: [] });
  t.after(() => empty.stop());
  let c = await content(empty, {}, 'de');
  assert.deepEqual(validateWidgetContent(c), []);
  assert.match(c.components[0].text, /Noch kein HomeWizard P1 Meter/);

  const { w } = await world();
  t.after(() => w.stop());
  c = await content(w, { meter: deviceId(w.gladys, 'kwh', KWH) }, 'es');
  assert.match(c.components[0].text, /no es un medidor P1/);
});

test('an unreachable solar meter shows no invented production', async (t) => {
  const { w, solar } = await world();
  t.after(() => w.stop());
  solar.setOffline(true);
  for (let i = 0; i < 3; i += 1) {
    await w.hub.pollAll();
  }
  const c = await content(w, { solar: deviceId(w.gladys, 'kwh', KWH) });
  assert.equal(byLabel(c.components, 'Solar').value, '-');
  assert.equal(byLabel(c.components, 'House').value, '-');
  const status = c.components.find((component) => component.type === 'status');
  assert.equal(status.items.at(-1).value, 'not answering');
});
