// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake HomeWizard devices (real
// HTTP and HTTPS servers on the loopback interface, tools/fake-homewizard.mjs)
// announced through the fake core's mDNS results, and a temporary /data, with
// the integration wired on top through registerHandlers. No timer runs: the
// tests read the devices with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeHomeWizard, TEST_CA, loadTls } from '../../tools/fake-homewizard.mjs';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const FAST_TIMINGS = { pairWindowMs: 600, pairRetryMs: 50 };

// One fake per real fixture: serials 5c2fafa000xx, v2 ones with a test certificate.
export const SERIALS = {
  P1_V2: '5c2fafa00001',
  KWH3_V2: '5c2fafa00002',
  BATTERY: '5c2fafa00003',
  P1: '5c2fafa00010',
  SOCKET: '5c2fafa00011',
};

/** A started fake device. */
export function fake(options) {
  return new FakeHomeWizard(options).start();
}

/** Every fixture, as the device it comes from (v1, v2 or both). */
export async function allFakes() {
  const v1 = [
    'HWE-P1',
    'HWE-P1-single-phase',
    'HWE-P1-four-tariffs',
    'HWE-SKT',
    'HWE-SKT-21',
    'HWE-KWH1',
    'HWE-KWH3',
    'SDM230-wifi',
    'SDM630-wifi',
    'HWE-WTR',
  ];
  const devices = [];
  for (const [index, model] of v1.entries()) {
    devices.push(await fake({ model, serial: `5c2fafa001${String(index).padStart(2, '0')}` }));
  }
  devices.push(
    await fake({ model: 'HWE-P1', serial: SERIALS.P1_V2, v1: false, v2: loadTls('p1') }),
    await fake({ model: 'HWE-KWH3', serial: SERIALS.KWH3_V2, v1: false, v2: loadTls('kwh3') }),
    await fake({ model: 'HWE-BAT', serial: SERIALS.BATTERY, v1: false, v2: loadTls('battery') }),
  );
  return devices;
}

/**
 * @param {object} [options]
 * @param {FakeHomeWizard[]} [options.devices] started fake devices
 * @param {boolean} [options.scan] whether the core's mDNS browse finds them
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.created] devices already created in Gladys
 */
export async function createWorld({
  devices = [],
  scan = true,
  config = { language: 'en' },
  created = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-homewizard-')),
  timings = {},
  ports,
} = {}) {
  const gladys = createFakeGladys({
    config,
    devices: created,
    scanResults: { mdns: scan ? devices.flatMap((device) => device.mdns()) : [] },
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    timers: false,
    timings: { ...FAST_TIMINGS, ...timings },
    network: { ca: TEST_CA, ports },
  });
  const world = { gladys, fake: gladys.fake, app, hub: app.hub, dataDir, devices };
  world.stop = async () => {
    await app.stop();
    await Promise.all(devices.map((device) => device.stop()));
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return world;
}

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await world.hub.idle();
}

export const deviceId = (gladys, type, serial) => gladys.externalIds(type, serial).device;
export const featureId = (gladys, type, serial, key) =>
  gladys.externalIds(type, serial).feature(key);

export { FakeHomeWizard, TEST_CA, loadTls };

/** Press the button of every v2 device and run the "Pair" action. */
export async function pairAll(world) {
  for (const device of world.devices) {
    device.pressButton();
  }
  const ack = await world.fake.action('pair', {});
  await world.hub.idle();
  return ack;
}
