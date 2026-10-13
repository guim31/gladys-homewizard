// -----------------------------------------------------------------------------
// The hub against fake HomeWizard devices and the SDK's fake Gladys: discovery,
// states, commands, v2 pairing, triggers, reachability, persistence.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SERIALS,
  createAll,
  createWorld,
  deviceId,
  fake,
  featureId,
  loadTls,
  pairAll,
} from './helpers/world.js';

const p1v1 = () => fake({ model: 'HWE-P1-four-tariffs', serial: SERIALS.P1 });
const socket = () => fake({ model: 'HWE-SKT-21', serial: SERIALS.SOCKET });
const p1v2 = (options = {}) =>
  fake({ model: 'HWE-P1', serial: SERIALS.P1_V2, v2: loadTls('p1'), ...options });

const stateOf = (world, type, serial, key) =>
  world.fake.lastState(featureId(world.gladys, type, serial, key));

test('devices announced on mDNS are read and offered in the Discovery tab', async (t) => {
  const world = await createWorld({ devices: [await p1v1(), await socket()] });
  t.after(() => world.stop());
  assert.deepEqual(
    world.fake.scans.map((scan) => scan.type),
    ['mdns'],
  );
  const names = world.fake.discoveredDevices.map((device) => device.name).sort();
  assert.deepEqual(names, ['HomeWizard Energy Socket a00011', 'HomeWizard P1 Meter a00010']);
  const p1 = world.fake.discoveredDevices.find((device) => device.model === 'HWE-P1');
  assert.equal(p1.external_id, deviceId(world.gladys, 'p1', SERIALS.P1));
  assert.equal(p1.should_poll, false);
  assert.deepEqual(
    p1.params.map((param) => param.name),
    ['IP_ADDRESS', 'SERIAL_NUMBER', 'LOCAL_API', 'FIRMWARE'],
  );
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  // Nothing created yet: no state sent (Gladys would drop them).
  assert.equal(world.fake.states.length, 0);
});

test('no device anywhere: the connection status says so', async (t) => {
  const world = await createWorld({ devices: [] });
  t.after(() => world.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /Aucun appareil HomeWizard/);
});

test('a created device gets all its states, then only what changes, slow ones once a minute', async (t) => {
  const meter = await p1v1();
  const world = await createWorld({ devices: [meter], timings: { slowPublishMs: 60_000 } });
  t.after(() => world.stop());
  await createAll(world);
  assert.equal(stateOf(world, 'p1', SERIALS.P1, 'power-export'), 123);
  assert.equal(stateOf(world, 'p1', SERIALS.P1, 'power-import'), 0);
  assert.equal(stateOf(world, 'p1', SERIALS.P1, 'energy-import'), 13779.338);
  assert.equal(stateOf(world, 'p1', SERIALS.P1, 'voltage-l2'), 230.2);
  assert.equal(stateOf(world, 'p1', SERIALS.P1, 'gas'), 111.111);
  const sent = world.fake.states.length;

  meter.setPower(1800);
  meter.data.total_power_import_kwh = 13780;
  await world.hub.pollAll();
  const fresh = world.fake.states.slice(sent).map((state) => state.device_feature_external_id);
  // The powers changed; the index changed too, but was sent less than a minute ago.
  assert.deepEqual(
    fresh.sort(),
    [
      featureId(world.gladys, 'p1', SERIALS.P1, 'power-export'),
      featureId(world.gladys, 'p1', SERIALS.P1, 'power-import'),
    ].sort(),
  );
  assert.equal(stateOf(world, 'p1', SERIALS.P1, 'power-import'), 1800);
  assert.equal(stateOf(world, 'p1', SERIALS.P1, 'energy-import'), 13779.338);
});

test('the slow features follow once their minute is over', async (t) => {
  const meter = await p1v1();
  const world = await createWorld({ devices: [meter], timings: { slowPublishMs: 0 } });
  t.after(() => world.stop());
  await createAll(world);
  meter.data.total_power_import_kwh = 13780.5;
  await world.hub.pollAll();
  assert.equal(stateOf(world, 'p1', SERIALS.P1, 'energy-import'), 13780.5);
});

test('adding a device to Gladys re-sends its states and nudges the widget', async (t) => {
  const world = await createWorld({ devices: [await p1v1()] });
  t.after(() => world.stop());
  const refreshes = world.fake.widgetRefreshes.length;
  await createAll(world);
  assert.ok(world.fake.states.length > 10);
  assert.ok(world.fake.widgetRefreshes.length > refreshes);
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: deviceId(world.gladys, 'p1', SERIALS.P1),
    transport: 'local',
  });
});

test('the Energy Socket switches, refuses while locked, and drives its LED', async (t) => {
  const plug = await socket();
  const world = await createWorld({ devices: [plug] });
  t.after(() => world.stop());
  await createAll(world);
  const device = world.fake.devices[0];
  const feature = (key) => device.features.find((entry) => entry.external_id.endsWith(`:${key}`));

  let ack = await world.fake.setValue(device, feature('switch'), 0);
  assert.equal(ack.success, true, ack.error);
  assert.equal(plug.state.power_on, false);
  assert.equal(stateOf(world, 'socket', SERIALS.SOCKET, 'switch'), 0);

  ack = await world.fake.setValue(device, feature('led'), 50);
  assert.equal(ack.success, true);
  assert.equal(plug.state.brightness, 128);

  ack = await world.fake.setValue(device, feature('lock'), 1);
  assert.equal(ack.success, true);
  assert.equal(plug.state.switch_lock, true);
  ack = await world.fake.setValue(device, feature('switch'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /English|switch lock/i);
  assert.equal(plug.state.power_on, false);

  ack = await world.fake.setValue(device, feature('power'), 1);
  assert.equal(ack.success, false, 'a measurement takes no command');
});

test('the scene actions switch a socket and blink a device', async (t) => {
  const plug = await socket();
  const meter = await p1v1();
  const world = await createWorld({ devices: [plug, meter] });
  t.after(() => world.stop());
  await createAll(world);
  const socketId = deviceId(world.gladys, 'socket', SERIALS.SOCKET);
  const meterId = deviceId(world.gladys, 'p1', SERIALS.P1);

  let ack = await world.fake.sceneAction('turn_off_socket', { device: socketId });
  assert.deepEqual(ack, { success: true, data: { outputs: { power_on: false } } });
  ack = await world.fake.sceneAction('turn_on_socket', { device: socketId });
  assert.deepEqual(ack.data.outputs, { power_on: true });
  ack = await world.fake.sceneAction('turn_on_socket', { device: meterId });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Energy Socket/);

  ack = await world.fake.sceneAction('identify_device', { device: meterId });
  assert.deepEqual(ack.data.outputs, { identified: true });
  assert.equal(meter.identified, 1);
});

test('the identify action reports what happened, in four languages', async (t) => {
  const meter = await p1v1();
  const kwh = await fake({ model: 'HWE-KWH1', serial: '5c2fafa00020' });
  const world = await createWorld({ devices: [meter, kwh] });
  t.after(() => world.stop());
  let ack = await world.fake.action('identify', {
    device: deviceId(world.gladys, 'p1', SERIALS.P1),
  });
  assert.match(ack.data.message.fr, /clignote/);
  ack = await world.fake.action('identify', {
    device: deviceId(world.gladys, 'kwh', '5c2fafa00020'),
  });
  assert.match(ack.data.message.en, /cannot blink/);
  ack = await world.fake.action('identify', { device: 'ext:test-integration:p1:000000000000' });
  assert.equal(ack.success, false);
});

test('a v2 device is paired with its button, then read over HTTPS with its token', async (t) => {
  const meter = await p1v2({ v1: false });
  const world = await createWorld({ devices: [meter] });
  t.after(() => world.stop());
  // Announced, but nothing to read before the pairing.
  assert.equal(world.fake.discoveredDevices.length, 0);
  assert.match(world.fake.connectionStatus.message.en, /pair them/);
  let ack = await world.fake.action('search', {});
  assert.match(ack.data.message.en, /press its button after "Pair"/);

  // Nobody presses the button: the action says so at the end of its window.
  ack = await world.fake.action('pair', {});
  assert.match(ack.data.message.en, /No button pressed on: HomeWizard P1 Meter a00001/);
  assert.equal(world.hub.records.get(SERIALS.P1_V2).token, null);

  ack = await pairAll(world);
  assert.equal(ack.data.message.en, 'Paired: HomeWizard P1 Meter a00001.');
  assert.equal(world.fake.discoveredDevices.length, 1);
  const device = world.fake.discoveredDevices[0];
  assert.equal(device.params.find((param) => param.name === 'LOCAL_API').value, 'v2');
  assert.equal(world.fake.connectionStatus.connected, true);
  // Every v2 request carried the token; it never shows in the published data.
  const authorized = meter.requests.filter((request) => request.path === '/api/measurement');
  assert.ok(
    authorized.length > 0 && authorized.every((r) => /^Bearer [0-9A-F]{32}$/.test(r.authorization)),
  );
  const token = world.hub.records.get(SERIALS.P1_V2).token;
  assert.ok(!JSON.stringify(world.fake.requests).includes(token));

  // The token is kept under /data, readable by the integration only.
  await world.hub.store.flush();
  const file = join(world.dataDir, 'homewizard-state.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.devices[SERIALS.P1_V2].token, token);
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  ack = await world.fake.action('pair', {});
  assert.match(ack.data.message.en, /No device to pair/);
});

test('a P1 Meter with both APIs is read in v1 until it is paired', async (t) => {
  const meter = await p1v2();
  const world = await createWorld({ devices: [meter] });
  t.after(() => world.stop());
  assert.equal(world.hub.versionOf(world.hub.records.get(SERIALS.P1_V2)), 1);
  await pairAll(world);
  assert.equal(world.hub.versionOf(world.hub.records.get(SERIALS.P1_V2)), 2);
  const before = meter.requests.length;
  await world.hub.pollAll();
  assert.ok(meter.requests.slice(before).every((request) => request.api === 2));
});

test('a revoked token falls back to v1 and asks for a new pairing', async (t) => {
  const meter = await p1v2();
  const world = await createWorld({ devices: [meter] });
  t.after(() => world.stop());
  await pairAll(world);
  meter.tokens.clear();
  await world.hub.pollAll();
  const record = world.hub.records.get(SERIALS.P1_V2);
  assert.equal(record.token, null);
  assert.equal(record.problem, 'unauthorized');
  await world.hub.pollAll();
  assert.equal(record.reachable, true, 'read again over v1');
});

test('a certificate that is not HomeWizard never gets the token', async (t) => {
  const real = await p1v2({ v1: false });
  const world = await createWorld({ devices: [real] });
  t.after(() => world.stop());
  await pairAll(world);
  // Another device takes the address and port (rogue certificate, same name).
  const rogue = await fake({
    model: 'HWE-P1',
    serial: SERIALS.P1_V2,
    v1: false,
    v2: loadTls('rogue'),
  });
  t.after(() => rogue.stop());
  world.hub.records.get(SERIALS.P1_V2).v2Port = rogue.v2Port;
  await world.hub.pollAll();
  assert.equal(rogue.requests.length, 0);
  assert.equal(world.hub.records.get(SERIALS.P1_V2).problem, 'tls');
});

test('the local API turned off in the app is reported, and found again', async (t) => {
  const meter = await fake({ model: 'HWE-P1', serial: SERIALS.P1, v1Enabled: false });
  const world = await createWorld({ devices: [meter] });
  t.after(() => world.stop());
  assert.equal(world.fake.discoveredDevices.length, 0);
  let ack = await world.fake.action('search', {});
  assert.match(ack.data.message.fr, /API locale désactivée/);
  meter.v1Enabled = true;
  world.fake.scanResults.mdns = meter.mdns();
  ack = await world.fake.action('search', {});
  assert.match(ack.data.message.en, /1 device\(s\), 1 read/);
  assert.equal(world.fake.discoveredDevices.length, 1);
});

test('an unplugged device turns unreachable after three silent readings, then comes back', async (t) => {
  const meter = await p1v1();
  const world = await createWorld({ devices: [meter] });
  t.after(() => world.stop());
  await createAll(world);
  meter.setOffline(true);
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  await world.hub.pollAll();
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(world.fake.connectionStatus.connected, false);
  meter.setOffline(false);
  await world.hub.pollAll();
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the grid triggers fire once per step crossed, never on the first reading', async (t) => {
  const meter = await p1v1();
  meter.setPower(-3500); // already exporting 3.5 kW when the integration starts
  const world = await createWorld({ devices: [meter] });
  t.after(() => world.stop());
  await createAll(world);
  await world.hub.pollAll();
  assert.deepEqual(world.fake.sceneEvents, []);

  meter.setPower(-600);
  await world.hub.pollAll();
  meter.setPower(-1200); // back up through 1 kW (re-armed below 900 W)
  await world.hub.pollAll();
  meter.setPower(400); // now drawing: export steps re-armed, import 100 and 250 crossed
  await world.hub.pollAll();
  meter.setPower(450);
  await world.hub.pollAll();

  const device = deviceId(world.gladys, 'p1', SERIALS.P1);
  assert.deepEqual(world.fake.sceneEvents, [
    { key: 'grid_export_above', data: { device, threshold: 1000, power: 1200 } },
    { key: 'grid_import_above', data: { device, threshold: 100, power: 400 } },
    { key: 'grid_import_above', data: { device, threshold: 250, power: 400 } },
  ]);
});

test('a socket command does not fire the triggers, and a stale reading is dropped', async (t) => {
  const plug = await socket();
  const world = await createWorld({ devices: [plug] });
  t.after(() => world.stop());
  await createAll(world);
  const record = world.hub.records.get(SERIALS.SOCKET);
  const reading = world.hub.read(record); // starts, then a command overtakes it
  record.commandSeq += 1;
  await reading;
  assert.equal(world.fake.sceneEvents.length, 0);
});

test('a typed address is probed: v1 tells who it is, a v2-only device waits for its pairing', async (t) => {
  const battery = await fake({
    model: 'HWE-BAT',
    serial: SERIALS.BATTERY,
    v1: false,
    v2: loadTls('battery'),
  });
  const world = await createWorld({
    devices: [battery],
    scan: false,
    config: { language: 'en', hosts: '127.0.0.1, 300.1.1.1' },
    ports: { v1: 1, v2: battery.v2Port },
  });
  t.after(() => world.stop());
  assert.equal(world.fake.discoveredDevices.length, 0);
  let ack = await world.fake.action('search', {});
  assert.match(ack.data.message.en, /To pair or enable: 127\.0\.0\.1/);
  assert.match(ack.data.message.en, /Ignored addresses: 300\.1\.1\.1/);
  ack = await pairAll(world);
  assert.equal(ack.data.message.en, 'Paired: HomeWizard Plug-In Battery a00003.');
  assert.equal(world.fake.discoveredDevices[0].model, 'HWE-BAT');
});

test('a typed v1 address is adopted with its serial', async (t) => {
  const meter = await p1v1();
  const world = await createWorld({
    devices: [meter],
    scan: false,
    config: { language: 'en', hosts: 'http://127.0.0.1/' },
    ports: { v1: meter.v1Port, v2: 1 },
  });
  t.after(() => world.stop());
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(world.hub.records.get(SERIALS.P1).address, '127.0.0.1');
});

test('a restart knows the devices and tokens from /data before any scan', async (t) => {
  const meter = await p1v2({ v1: false });
  const first = await createWorld({ devices: [meter] });
  await pairAll(first);
  await first.app.stop();

  const second = await createWorld({ devices: [meter], scan: false, dataDir: first.dataDir });
  t.after(() => second.stop());
  assert.equal(second.fake.discoveredDevices.length, 1);
  assert.equal(second.hub.records.get(SERIALS.P1_V2).reachable, true);
});

test('a new external meter adds its feature without touching the others', async (t) => {
  const meter = await fake({ model: 'HWE-P1-single-phase', serial: SERIALS.P1 });
  const world = await createWorld({ devices: [meter] });
  t.after(() => world.stop());
  const before = world.fake.discoveredDevices[0].features.map((feature) => feature.external_id);
  assert.ok(!before.some((id) => id.endsWith(':water')));
  meter.data.external = [
    { unique_id: '57303031', type: 'water_meter', timestamp: 1, value: 3.5, unit: 'm3' },
  ];
  await world.hub.pollAll();
  const after = world.fake.discoveredDevices[0].features.map((feature) => feature.external_id);
  assert.deepEqual(
    after.slice(0, -1).filter((id) => !id.endsWith(':water')),
    before.filter((id) => !id.endsWith(':wifi')),
  );
  assert.ok(after.some((id) => id.endsWith(':water')));
});

test('a reconnection re-sends everything Gladys may have lost', async (t) => {
  const world = await createWorld({ devices: [await p1v1()] });
  t.after(() => world.stop());
  await createAll(world);
  const sent = world.fake.states.length;
  await world.hub.resync(world.hub.config);
  assert.ok(world.fake.states.length > sent);
});
