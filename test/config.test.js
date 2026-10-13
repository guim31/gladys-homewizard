import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';

test('defaults', () => {
  assert.deepEqual(normalizeConfig(), {
    hosts: [],
    invalidHosts: [],
    pollSeconds: 10,
    language: 'fr',
  });
  assert.equal(DEFAULT_CONFIG.poll_interval, '10');
});

test('addresses: IPv4, host names, pasted URLs; the rest is reported', () => {
  assert.deepEqual(
    parseHosts(
      '192.168.001.040, http://192.168.1.41/api ;p1meter.lan\n192.168.1.40 300.1.1.1 a_b 12.34',
    ),
    {
      hosts: ['192.168.1.40', '192.168.1.41', 'p1meter.lan'],
      invalid: ['300.1.1.1', 'a_b', '12.34'],
    },
  );
  assert.deepEqual(parseHosts(42), { hosts: [], invalid: [] });
});

test('interval and language outside their lists fall back to the defaults', () => {
  assert.equal(normalizeConfig({ poll_interval: '5' }).pollSeconds, 5);
  assert.equal(normalizeConfig({ poll_interval: 7 }).pollSeconds, 10);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'de');
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});
