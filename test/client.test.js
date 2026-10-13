// -----------------------------------------------------------------------------
// The HTTP client against fake devices on the loopback interface: v1, v2 with
// its token and its certificate checks, and the errors the hub acts on.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  certificateName,
  getDeviceInfo,
  getMeasurement,
  hasV2Api,
  homewizardRequest,
  identify,
  requestToken,
} from '../src/homewizard/client.js';
import { FakeHomeWizard, TEST_CA, loadTls } from '../tools/fake-homewizard.mjs';

const SERIAL = '5c2fafa00001';

async function p1(options = {}) {
  return new FakeHomeWizard({
    model: 'HWE-P1',
    serial: SERIAL,
    v2: loadTls('p1'),
    ...options,
  }).start();
}

const v1Target = (device) => ({ address: '127.0.0.1', port: device.v1Port, version: 1 });
const v2Target = (device, extra = {}) => ({
  address: '127.0.0.1',
  port: device.v2Port,
  version: 2,
  ca: TEST_CA,
  identity: certificateName('HWE-P1', SERIAL),
  ...extra,
});

test('the certificate names follow the HomeWizard table', () => {
  assert.equal(certificateName('HWE-P1', 'AABBCCDDEEFF'), 'appliance/p1dongle/aabbccddeeff');
  assert.equal(
    certificateName('SDM630-wifi', 'aabbccddeeff'),
    'appliance/energymeter/aabbccddeeff',
  );
  assert.equal(certificateName('HWE-BAT', 'aabbccddeeff'), 'appliance/battery/aabbccddeeff');
  assert.equal(certificateName('HWE-XYZ', 'aabbccddeeff'), null);
});

test('v1: identification, measurement, identify; a disabled API is told apart', async (t) => {
  const device = await p1();
  t.after(() => device.stop());
  const info = await getDeviceInfo(v1Target(device));
  assert.equal(info.product_type, 'HWE-P1');
  assert.equal((await getMeasurement(v1Target(device))).active_tariff, 2);
  await identify(v1Target(device));
  assert.equal(device.identified, 1);
  device.v1Enabled = false;
  await assert.rejects(getMeasurement(v1Target(device)), { kind: 'disabled', status: 403 });
});

test('v2: no token before the button, a token after, data with it', async (t) => {
  const device = await p1();
  t.after(() => device.stop());
  assert.equal(await hasV2Api(v2Target(device)), true);
  assert.equal(await hasV2Api(v1Target(device)), false, 'a plain HTTP port is no v2 API');
  await assert.rejects(requestToken(v2Target(device)), { kind: 'not-paired' });
  device.pressButton();
  const token = await requestToken(v2Target(device));
  assert.match(token, /^[0-9A-F]{32}$/);
  assert.equal((await getMeasurement(v2Target(device, { token }))).tariff, 2);
  await assert.rejects(getMeasurement(v2Target(device, { token: 'F'.repeat(32) })), {
    kind: 'unauthorized',
  });
  await identify(v2Target(device, { token }));
  assert.equal(device.identified, 1);
  const user = device.requests.find((request) => request.path === '/api/user');
  assert.equal(user.method, 'POST');
});

test('v2: the token only goes to a HomeWizard certificate naming the expected device', async (t) => {
  const device = await p1();
  const rogue = await new FakeHomeWizard({
    model: 'HWE-P1',
    serial: SERIAL,
    v1: false,
    v2: loadTls('rogue'),
  }).start();
  t.after(() => Promise.all([device.stop(), rogue.stop()]));
  device.pressButton();
  const token = await requestToken(v2Target(device));
  await assert.rejects(
    getMeasurement(
      v2Target(device, { token, identity: certificateName('HWE-P1', '5c2fafa09999') }),
    ),
    { kind: 'tls' },
  );
  // The real HomeWizard CA does not sign the test certificate.
  await assert.rejects(getMeasurement(v2Target(device, { token, ca: undefined })), { kind: 'tls' });
  await assert.rejects(getMeasurement(v2Target(rogue, { token })), { kind: 'tls' });
  assert.equal(rogue.requests.length, 0);
});

test('timeouts, refused connections, oversized and broken answers', async (t) => {
  const silent = http.createServer(() => {});
  const huge = http.createServer((req, res) => res.end('x'.repeat(400 * 1024)));
  const broken = http.createServer((req, res) => res.end('<html>'));
  const listen = (server) =>
    new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const [silentPort, hugePort, brokenPort] = await Promise.all([silent, huge, broken].map(listen));
  t.after(() => {
    silent.closeAllConnections();
    [silent, huge, broken].forEach((server) => server.close());
  });
  const target = (port) => ({ address: '127.0.0.1', port, version: 1 });
  await assert.rejects(homewizardRequest(target(silentPort), { path: '/api', timeoutMs: 50 }), {
    kind: 'unreachable',
  });
  await assert.rejects(homewizardRequest(target(hugePort), { path: '/api' }), { kind: 'invalid' });
  await assert.rejects(homewizardRequest(target(brokenPort), { path: '/api' }), {
    kind: 'invalid',
  });
  await assert.rejects(homewizardRequest(target(1), { path: '/api' }), { kind: 'unreachable' });
});
