// -----------------------------------------------------------------------------
// What the integration writes at the default level (LOG_LEVEL=info): the life
// cycle only. A normal run (readings, states, scene events) writes nothing; a
// failure that repeats at every reading is written once, then once when it
// heals.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import {
  SERIALS,
  createAll,
  createWorld,
  fake,
  featureId,
  loadTls,
  pairAll,
} from './helpers/world.js';

/** Every line the SDK logger writes from now on, at the default level. */
function captureLogs(t) {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  for (const name of ['log', 'info', 'warn', 'error']) {
    t.mock.method(console, name, (...args) => lines.push(args.join(' ')));
  }
  return lines;
}

const p1v1 = () => fake({ model: 'HWE-P1-four-tariffs', serial: SERIALS.P1 });

test('the hub timer reads the devices by itself, without any poll from Gladys', async (t) => {
  const meter = await p1v1();
  const world = await createWorld({ devices: [meter] });
  t.after(() => world.stop());
  await createAll(world);
  assert.ok(world.fake.discoveredDevices.every((device) => device.should_poll === false));
  meter.setPower(1234);
  world.hub.timersEnabled = true;
  world.hub.config = { ...world.hub.config, pollSeconds: 0.05 };
  world.hub.startTimers();
  const feature = featureId(world.gladys, 'p1', SERIALS.P1, 'power-import');
  for (let wait = 0; wait < 100 && world.fake.lastState(feature) !== 1234; wait += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(world.fake.lastState(feature), 1234);
});

test('a normal run writes nothing at the info level', async (t) => {
  const meter = await p1v1();
  const plug = await fake({ model: 'HWE-SKT-21', serial: SERIALS.SOCKET });
  const world = await createWorld({ devices: [meter, plug], timings: { slowPublishMs: 0 } });
  t.after(() => world.stop());
  await createAll(world);
  const lines = captureLogs(t);
  const sent = world.fake.states.length;
  for (const watts of [300, 1500, 2600, 4200, 800, -1200, -3100]) {
    meter.setPower(watts);
    await world.hub.pollAll();
  }
  await world.hub.timerTask(world.hub.pollAll());
  await world.hub.idle();
  assert.ok(world.fake.states.length > sent, 'states were published');
  assert.ok(world.fake.sceneEvents.length > 0, 'scene events were sent');
  assert.deepEqual(lines, []);
});

test('an unplugged device is logged once when lost, once when back', async (t) => {
  const meter = await p1v1();
  const world = await createWorld({ devices: [meter] });
  t.after(() => world.stop());
  await createAll(world);
  const lines = captureLogs(t);
  meter.setOffline(true);
  for (let i = 0; i < 6; i += 1) {
    await world.hub.pollAll();
  }
  meter.setOffline(false);
  for (let i = 0; i < 3; i += 1) {
    await world.hub.pollAll();
  }
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[INFO\].*no longer answers/);
  assert.match(lines[1], /\[INFO\].*read at/);
});

test('a certificate refused at every reading is logged once', async (t) => {
  const real = await fake({ model: 'HWE-P1', serial: SERIALS.P1_V2, v1: false, v2: loadTls('p1') });
  const world = await createWorld({ devices: [real] });
  t.after(() => world.stop());
  await pairAll(world);
  const rogue = await fake({
    model: 'HWE-P1',
    serial: SERIALS.P1_V2,
    v1: false,
    v2: loadTls('rogue'),
  });
  t.after(() => rogue.stop());
  const record = world.hub.records.get(SERIALS.P1_V2);
  const lines = captureLogs(t);
  record.v2Port = rogue.v2Port;
  for (let i = 0; i < 5; i += 1) {
    await world.hub.pollAll();
  }
  record.v2Port = real.v2Port;
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*5c2fafa00001/);
  assert.match(lines[1], /\[INFO\].*read at/);
});

test('a discovery the core refuses is logged once, then once when it works', async (t) => {
  const meter = await p1v1();
  const world = await createWorld({ devices: [meter] });
  t.after(() => world.stop());
  const scan = world.gladys.scanNetwork.bind(world.gladys);
  const lines = captureLogs(t);
  world.gladys.scanNetwork = async () => {
    throw Object.assign(new Error('HTTP 403'), { status: 403 });
  };
  for (let i = 0; i < 3; i += 1) {
    await world.hub.rediscover();
  }
  world.gladys.scanNetwork = scan;
  await world.hub.rediscover();
  await world.hub.rediscover();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*discovery through Gladys failed/);
  assert.match(lines[1], /\[INFO\].*works again/);
});

test('a publication Gladys keeps refusing is logged once, then once when it works', async (t) => {
  const meter = await p1v1();
  const world = await createWorld({ devices: [meter] });
  t.after(() => world.stop());
  const publish = world.gladys.publishDiscoveredDevices.bind(world.gladys);
  const lines = captureLogs(t);
  world.gladys.publishDiscoveredDevices = async () => {
    throw new Error('HTTP 503');
  };
  world.hub.devicesDirty = true;
  for (let i = 0; i < 4; i += 1) {
    await world.hub.timerTask(world.hub.pollAll());
  }
  world.gladys.publishDiscoveredDevices = publish;
  await world.hub.timerTask(world.hub.pollAll());
  await world.hub.timerTask(world.hub.pollAll());
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*HTTP 503/);
  assert.match(lines[1], /\[INFO\]/);
});

test('a /data that cannot be written is logged once, then once when it can', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gladys-homewizard-'));
  const blocker = join(dir, 'file');
  writeFileSync(blocker, '');
  const store = new Store(join(blocker, 'data'));
  const lines = captureLogs(t);
  for (let i = 0; i < 3; i += 1) {
    await store.save({ devices: {} });
  }
  store.directory = dir;
  store.path = join(dir, 'homewizard-state.json');
  await store.save({ devices: {} });
  await store.save({ devices: {} });
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*Cannot write/);
  assert.match(lines[1], /\[INFO\].*written again/);
});
