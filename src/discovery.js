// -----------------------------------------------------------------------------
// Where to look for HomeWizard devices: the mDNS announcements the Gladys core
// captures for the integration, the addresses typed in the configuration, and
// the addresses already known.
//
// The integration container sits on a bridge network: mDNS never reaches it.
// The core browses the two services declared in the manifest
// `network_discovery` and relays the raw records:
//   - `_hwenergy._tcp`: local API v1 (HTTP); TXT `api_enabled` says whether
//     the user turned it on in the HomeWizard Energy app;
//   - `_homewizard._tcp`: local API v2 (HTTPS, token).
// Both carry `serial` (the MAC address) and `product_type`: a device that
// announces both is one device.
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { familyOf, normalizeSerial } from './homewizard/model.js';

export const SCAN_TIMEOUT_SECONDS = 5;
export const MDNS_SERVICES = { v1: '_hwenergy._tcp', v2: '_homewizard._tcp' };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function serviceOf(name) {
  const lower = String(name ?? '').toLowerCase();
  if (lower.includes(`.${MDNS_SERVICES.v2}`)) {
    return 'v2';
  }
  if (lower.includes(`.${MDNS_SERVICES.v1}`)) {
    return 'v1';
  }
  return null;
}

/**
 * Devices announced on the network, one per serial:
 * `[{ serial, productType, address, v1: { port, enabled } | null, v2: { port } | null }]`.
 * Products the integration does not know (the Energy Display) are left out.
 * @param {Array} services raw mDNS results `[{ name, host, addresses, port, txt }]`
 */
export function parseMdnsServices(services) {
  const found = new Map();
  for (const service of Array.isArray(services) ? services : []) {
    if (!service || typeof service !== 'object') {
      continue;
    }
    const api = serviceOf(service.name);
    if (!api) {
      continue;
    }
    const txt = parseMdnsTxt(Array.isArray(service.txt) ? service.txt : []);
    const serial = normalizeSerial(txt.serial);
    const productType = typeof txt.product_type === 'string' ? txt.product_type : null;
    const address = (Array.isArray(service.addresses) ? service.addresses : []).find(
      (entry) => typeof entry === 'string' && IPV4.test(entry),
    );
    if (!serial || !familyOf(productType) || !address) {
      continue;
    }
    const entry = found.get(serial) ?? { serial, productType, address, v1: null, v2: null };
    const port = Number.isInteger(service.port) && service.port > 0 ? service.port : undefined;
    if (api === 'v1') {
      entry.v1 = { port, enabled: txt.api_enabled !== '0' };
    } else {
      entry.v2 = { port };
      // The v2 announcement is the newer one: trust its address.
      entry.address = address;
    }
    found.set(serial, entry);
  }
  return [...found.values()];
}

/**
 * Run `task` on every item, `limit` at a time; resolves with the results in
 * order (`{ value }` or `{ error }`).
 */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await task(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
