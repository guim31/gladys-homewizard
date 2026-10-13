// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two readings of every device (`poll_interval` options).
export const POLL_INTERVALS = [2, 5, 10, 30, 60];

export const DEFAULT_CONFIG = {
  hosts: '',
  poll_interval: '10',
  language: 'fr',
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// A host name of the LAN (`p1meter-aabbcc.local`, `energysocket.lan`).
const HOST_NAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*$/i;
const MAX_HOSTS = 32;

/**
 * Parse the manual address list (commas, semicolons, spaces or new lines):
 * IPv4 addresses or host names, no port, no scheme.
 * @param {unknown} raw
 * @returns {{ hosts: string[], invalid: string[] }}
 */
export function parseHosts(raw) {
  const hosts = [];
  const invalid = [];
  const entries = typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  for (const entry of entries) {
    // Forgive a pasted URL: http://192.168.1.20/ -> 192.168.1.20
    const host = entry
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '');
    if (!host) {
      continue;
    }
    const match = host.match(IPV4);
    let normalized = null;
    if (match) {
      if (match.slice(1).every((part) => Number(part) <= 255)) {
        // Leading zeros would make another string for the same address.
        normalized = match.slice(1).map(Number).join('.');
      }
    } else if (HOST_NAME.test(host) && !/^\d+$/.test(host.replace(/\./g, ''))) {
      normalized = host.toLowerCase();
    }
    if (normalized === null) {
      invalid.push(entry.trim().slice(0, 64));
    } else if (!hosts.includes(normalized) && hosts.length < MAX_HOSTS) {
      hosts.push(normalized);
    }
  }
  return { hosts, invalid };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { hosts, invalid } = parseHosts(
    typeof source.hosts === 'string' ? source.hosts : DEFAULT_CONFIG.hosts,
  );
  const interval = Number(source.poll_interval ?? DEFAULT_CONFIG.poll_interval);
  return {
    hosts,
    invalidHosts: invalid,
    pollSeconds: POLL_INTERVALS.includes(interval)
      ? interval
      : Number(DEFAULT_CONFIG.poll_interval),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
