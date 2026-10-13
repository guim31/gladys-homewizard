// -----------------------------------------------------------------------------
// The mDNS records relayed by the core, turned into devices to read.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit, parseMdnsServices } from '../src/discovery.js';

const record = (service, txt, extra = {}) => ({
  name: `p1meter-aabbcc._${service}._tcp.local`,
  host: 'p1meter-aabbcc.local',
  addresses: ['192.0.2.20'],
  port: service === 'hwenergy' ? 80 : 443,
  txt,
  ...extra,
});
const TXT = ['serial=5C2FAFAABBCC', 'product_type=HWE-P1', 'product_name=P1 meter'];

test('one device announcing both APIs is one device', () => {
  const found = parseMdnsServices([
    record('hwenergy', ['api_enabled=1', 'path=/api/v1', ...TXT]),
    record('homewizard', ['api_version=2.0.0', 'id=appliance/p1dongle/5c2fafaabbcc', ...TXT], {
      addresses: ['fe80::1', '192.0.2.21'],
    }),
  ]);
  assert.deepEqual(found, [
    {
      serial: '5c2fafaabbcc',
      productType: 'HWE-P1',
      address: '192.0.2.21',
      v1: { port: 80, enabled: true },
      v2: { port: 443 },
    },
  ]);
});

test('the v1 API turned off in the app is read from the TXT record', () => {
  const [found] = parseMdnsServices([record('hwenergy', ['api_enabled=0', ...TXT])]);
  assert.deepEqual(found.v1, { port: 80, enabled: false });
  assert.equal(found.v2, null);
});

test('foreign services, unknown products, no IPv4 or no serial are left out', () => {
  assert.deepEqual(
    parseMdnsServices([
      record('hue', TXT),
      record('homewizard', ['serial=5c2fafaabbcc', 'product_type=HWE-DSP']),
      record('homewizard', TXT, { addresses: ['fe80::1'] }),
      record('homewizard', ['product_type=HWE-P1']),
      null,
      'nonsense',
    ]),
    [],
  );
  assert.deepEqual(parseMdnsServices(undefined), []);
});

test('mapLimit keeps the order and the errors', async () => {
  const results = await mapLimit([1, 2, 3], 2, async (n) => {
    if (n === 2) {
      throw new Error('two');
    }
    return n * 10;
  });
  assert.deepEqual(results[0], { value: 10 });
  assert.equal(results[1].error.message, 'two');
  assert.deepEqual(results[2], { value: 30 });
});
