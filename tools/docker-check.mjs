// -----------------------------------------------------------------------------
// End-to-end check of the integration inside its locked-down container (the
// Gladys sandbox: read-only root, no capabilities, 256 MB), against a
// simulated HomeWizard P1 Meter running in another container of the same
// Docker bridge network (tools/fake-homewizard.mjs, API v1 and v2), and the
// fake Gladys of the SDK. Development only, see CLAUDE.md:
//
//   docker run --rm --network <net> --read-only --cap-drop ALL ... \
//     -v $PWD/tools/docker-check.mjs:/app/tools/docker-check.mjs:ro \
//     -v $PWD/test/fixtures/tls/test-ca.pem:/app/tools/test-ca.pem:ro \
//     -e FAKE_HOST=<ip of the fake> <image> node tools/docker-check.mjs
// -----------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';
import { getMeasurement, homewizardRequest } from '../src/homewizard/client.js';

process.env.LOG_LEVEL ??= 'warn';
const FAKE = process.env.FAKE_HOST;
const control = (path) => fetch(`http://${FAKE}:8080${path}`, { method: 'POST' });
const ca = readFileSync(new URL('./test-ca.pem', import.meta.url), 'utf8');
const step = (text) => console.log(`- ${text}`);

// 1. The client alone: v1 in clear, v2 refused without a token, and refused
// against the real HomeWizard CA (the fake's certificate is a test one).
const v1 = await getMeasurement({ address: FAKE, version: 1 });
assert.equal(v1.active_tariff, 2);
step(`v1 measurement over the bridge: ${Object.keys(v1).length} values`);
await assert.rejects(
  homewizardRequest({ address: FAKE, version: 2, ca }, { path: '/api/measurement' }),
  {
    kind: 'unauthorized',
  },
);
await assert.rejects(
  homewizardRequest({ address: FAKE, version: 2, token: 'F'.repeat(32) }, { path: '/api' }),
  { kind: 'tls' },
);
step('v2 without token: 401; v2 with the real HomeWizard CA: certificate refused, token not sent');
await assert.rejects(getMeasurement({ address: '192.0.2.1', version: 1 }, {}), {
  kind: 'unreachable',
});
step('an address nobody answers on: unreachable');

// 2. The whole integration against the fake Gladys.
const gladys = createFakeGladys({ config: { hosts: FAKE, language: 'fr', poll_interval: '2' } });
const app = registerHandlers(gladys, {
  store: new Store('/data'),
  timers: false,
  network: { ca },
  timings: { pairWindowMs: 10_000, slowPublishMs: 0 },
});
await gladys.connect();
await app.ready;
const fake = gladys.fake;
assert.equal(fake.discoveredDevices.length, 1);
const device = fake.discoveredDevices[0];
step(`discovered by its typed address: ${device.name}, ${device.features.length} features`);
await fake.deviceCreated(device);
await app.hub.idle();
const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`)).external_id;
assert.equal(fake.lastState(feature('power-export')), 543);
step(`created: ${fake.states.length} states, export ${fake.lastState(feature('power-export'))} W`);

await control('/press');
let ack = await fake.action('pair', {});
assert.match(ack.data.message.fr, /Jumelé/);
step(`pairing after the button: "${ack.data.message.fr}"`);
await app.hub.pollAll();
const params = fake.discoveredDevices[0].params;
assert.equal(params.find((p) => p.name === 'LOCAL_API').value, 'v2');
step('read over HTTPS with its token');

await control('/power?w=-1600');
await app.hub.pollAll();
assert.deepEqual(
  fake.sceneEvents.map((event) => event.data.threshold),
  [1000, 1500],
);
step(`trigger "grid_export_above": ${fake.sceneEvents.length} steps crossed (1000, 1500 W)`);
ack = await fake.widgetGet('live_energy', { settings: {}, language: 'de' });
assert.equal(ack.success, true);
step(`widget: ${ack.data.content.components.length} components`);

await control('/offline?on=1');
for (let i = 0; i < 3; i += 1) {
  await app.hub.pollAll();
}
assert.equal(fake.transports.at(-1).transport, 'unreachable');
step('unplugged: unreachable after three readings');
await control('/offline?on=0');
await app.hub.pollAll();
assert.equal(fake.transports.at(-1).transport, 'local');
step('back: local');

const token = app.hub.records.get('5c2fafa00001').token;
const everything = JSON.stringify({ requests: fake.requests, ws: fake.wsMessages });
assert.ok(!everything.includes(token), 'the token never reaches Gladys');
step('the token never reaches Gladys');

await app.stop();
const memory = process.memoryUsage();
console.log(
  `OK (rss ${Math.round(memory.rss / 1048576)} MB, heap ${Math.round(memory.heapUsed / 1048576)} MB)`,
);
process.exit(0);
