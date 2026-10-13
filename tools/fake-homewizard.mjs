// -----------------------------------------------------------------------------
// A simulated HomeWizard device, for the tests and for trying the integration
// without the hardware: local API v1 (HTTP) and/or v2 (HTTPS with a token got
// by "pressing the button"), answering the real payloads of
// test/fixtures/homewizard (python-homewizard-energy and Home Assistant test
// fixtures, Apache-2.0).
//
// As a program (Docker checks, development):
//   node tools/fake-homewizard.mjs --model HWE-P1 --api both --serial 5c2fafa00001 \
//     --tls test/fixtures/tls/p1 [--host 0.0.0.0] [--v1-port 80] [--v2-port 443] [--control-port 8080]
// The control port takes `POST /press` (the button) and `POST /power?w=-1200`.
// Development only: the HTTPS certificate is a test one.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const FIXTURES = new URL('../test/fixtures/homewizard/', import.meta.url);
const TLS = new URL('../test/fixtures/tls/', import.meta.url);

const PRODUCT_NAMES = {
  'HWE-P1': 'P1 Meter',
  'HWE-SKT': 'Energy Socket',
  'HWE-WTR': 'Watermeter',
  'HWE-KWH1': 'kWh Meter 1-phase',
  'HWE-KWH3': 'kWh Meter 3-phase',
  'SDM230-wifi': 'kWh Meter 1-phase',
  'SDM630-wifi': 'kWh Meter 3-phase',
  'HWE-BAT': 'Plug-In Battery',
};
const CERT_IDS = {
  'HWE-P1': 'p1dongle',
  'HWE-SKT': 'energysocket',
  'HWE-WTR': 'watermeter',
  'HWE-KWH1': 'energymeter',
  'HWE-KWH3': 'energymeter',
  'HWE-BAT': 'battery',
};

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

/** A fixture: `{ device, data?, state?, measurement?, system? }` (missing files are null). */
export function loadFixture(api, name) {
  const read = (file) => {
    try {
      return readJson(new URL(`v${api}/${name}/${file}.json`, FIXTURES));
    } catch {
      return null;
    }
  };
  return {
    device: read('device'),
    data: read('data'),
    state: read('state'),
    measurement: read('measurement'),
    system: read('system'),
  };
}

/** Certificate and key of a test device (`p1`, `kwh3`, `battery`, `rogue`). */
export function loadTls(name) {
  return {
    cert: readFileSync(new URL(`${name}.pem`, TLS), 'utf8'),
    key: readFileSync(new URL(`${name}.key`, TLS), 'utf8'),
  };
}

export const TEST_CA = readFileSync(new URL('test-ca.pem', TLS), 'utf8');

const BUTTON_WINDOW_MS = 30_000;

export class FakeHomeWizard {
  /**
   * @param {object} options
   * @param {string} options.model fixture name, e.g. 'HWE-P1', 'HWE-SKT-21'
   * @param {string} options.serial 12 hexadecimal characters
   * @param {boolean} [options.v1] serve the local API v1 (HTTP)
   * @param {object} [options.v2] serve the local API v2 (HTTPS): `{ cert, key }`
   * @param {boolean} [options.v1Enabled] false: the v1 API answers 403
   * @param {string} [options.host]
   * @param {object} [options.ports] `{ v1, v2 }`, 0 for any free port
   */
  constructor({
    model,
    serial,
    v1 = true,
    v2 = null,
    v1Enabled = true,
    host = '127.0.0.1',
    ports = {},
  }) {
    this.model = model;
    this.serial = serial;
    this.host = host;
    this.v1Enabled = v1Enabled;
    this.tls = v2;
    this.wantV1 = v1;
    this.wantPorts = { v1: ports.v1 ?? 0, v2: ports.v2 ?? 0 };
    const v1Fixture = v1 ? loadFixture(1, model) : null;
    const v2Fixture = v2 ? loadFixture(2, model) : null;
    const device = (v2Fixture?.device ?? v1Fixture?.device) || {};
    this.productType = device.product_type;
    this.firmware = device.firmware_version ?? '6.00';
    this.data = v1Fixture?.data ? structuredClone(v1Fixture.data) : null;
    this.state = v1Fixture?.state ? structuredClone(v1Fixture.state) : null;
    this.measurement = v2Fixture?.measurement ? structuredClone(v2Fixture.measurement) : null;
    this.system = v2Fixture?.system ? structuredClone(v2Fixture.system) : null;
    this.tokens = new Set();
    this.buttonUntil = 0;
    this.offline = false;
    this.identified = 0;
    this.requests = [];
    this.servers = [];
    this.sockets = new Set();
  }

  async start() {
    if (this.wantV1) {
      this.v1Server = http.createServer((req, res) => this.handle(1, req, res));
      this.v1Port = await this.listen(this.v1Server, this.wantPorts.v1);
    }
    if (this.tls) {
      this.v2Server = https.createServer({ cert: this.tls.cert, key: this.tls.key }, (req, res) =>
        this.handle(2, req, res),
      );
      this.v2Port = await this.listen(this.v2Server, this.wantPorts.v2);
    }
    return this;
  }

  listen(server, port) {
    server.on('connection', (socket) => {
      if (this.offline) {
        socket.destroy();
        return;
      }
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    // A TLS handshake refused by the client is not an error of the fake.
    server.on('tlsClientError', () => {});
    this.servers.push(server);
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, this.host, () => resolve(server.address().port));
    });
  }

  async stop() {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await Promise.all(
      this.servers.map((server) => new Promise((resolve) => server.close(() => resolve()))),
    );
  }

  /** Unplugged: every connection is dropped. */
  setOffline(offline) {
    this.offline = offline;
    if (offline) {
      for (const socket of this.sockets) {
        socket.destroy();
      }
    }
  }

  /** The user presses the button: token requests are accepted for 30 s. */
  pressButton() {
    this.buttonUntil = Date.now() + BUTTON_WINDOW_MS;
  }

  /** Set the active power (W, negative when exporting), in both API flavours. */
  setPower(watts) {
    if (this.data) {
      this.data.active_power_w = watts;
    }
    if (this.measurement) {
      this.measurement.power_w = watts;
    }
  }

  /** The raw mDNS records the Gladys core relays for this device. */
  mdns() {
    const hostname = `${(CERT_IDS[this.productType] ?? 'device').replace('dongle', 'meter')}-${this.serial.slice(-6)}`;
    const common = [
      `serial=${this.serial}`,
      `product_name=${PRODUCT_NAMES[this.productType] ?? this.productType}`,
      `product_type=${this.productType}`,
    ];
    const records = [];
    if (this.v1Server) {
      records.push({
        name: `${hostname}._hwenergy._tcp.local`,
        host: `${hostname}.local`,
        addresses: [this.host],
        port: this.v1Port,
        txt: [`api_enabled=${this.v1Enabled ? 1 : 0}`, 'path=/api/v1', ...common],
      });
    }
    if (this.v2Server) {
      records.push({
        name: `${hostname}._homewizard._tcp.local`,
        host: `${hostname}.local`,
        addresses: [this.host],
        port: this.v2Port,
        txt: [
          'api_version=2.0.0',
          `id=appliance/${CERT_IDS[this.productType]}/${this.serial}`,
          ...common,
        ],
      });
    }
    return records;
  }

  info(api) {
    return {
      product_name: PRODUCT_NAMES[this.productType] ?? this.productType,
      product_type: this.productType,
      serial: this.serial,
      firmware_version: this.firmware,
      api_version: api === 2 ? '2.0.0' : 'v1',
    };
  }

  handle(api, req, res) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const path = req.url.split('?')[0];
      this.requests.push({
        api,
        method: req.method,
        path,
        authorization: req.headers.authorization,
      });
      const reply = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(payload === undefined ? '' : JSON.stringify(payload));
      };
      let json;
      try {
        json = body ? JSON.parse(body) : null;
      } catch {
        reply(400, { error: 'request:json-invalid' });
        return;
      }
      if (api === 1) {
        this.handleV1(req.method, path, json, reply);
      } else {
        this.handleV2(req, path, json, reply);
      }
    });
  }

  handleV1(method, path, json, reply) {
    if (!this.v1Enabled) {
      reply(403, { error: { id: 202, description: 'API not enabled' } });
      return;
    }
    if (method === 'GET' && path === '/api') {
      reply(200, this.info(1));
    } else if (method === 'GET' && path === '/api/v1/data' && this.data) {
      reply(200, this.data);
    } else if (path === '/api/v1/state' && this.state) {
      if (method === 'PUT') {
        if ('power_on' in (json ?? {}) && this.state.switch_lock) {
          reply(400, { error: { id: 7, description: 'switch locked' } });
          return;
        }
        Object.assign(this.state, json);
      }
      reply(200, this.state);
    } else if (method === 'PUT' && path === '/api/v1/identify' && this.productType !== 'HWE-KWH1') {
      this.identified += 1;
      reply(200, { identify: 'ok' });
    } else {
      reply(404, { error: { id: 404, description: 'not found' } });
    }
  }

  handleV2(req, path, json, reply) {
    if (req.method === 'POST' && path === '/api/user') {
      if (Date.now() > this.buttonUntil) {
        reply(403, { error: 'user:creation-not-enabled' });
        return;
      }
      const token = [...Array(32)]
        .map(() => '0123456789ABCDEF'[Math.floor(Math.random() * 16)])
        .join('');
      this.tokens.add(token);
      reply(200, { token, name: json?.name });
      return;
    }
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!this.tokens.has(token)) {
      reply(401, { error: 'user:unauthorized' });
      return;
    }
    if (req.method === 'GET' && path === '/api') {
      reply(200, this.info(2));
    } else if (req.method === 'GET' && path === '/api/measurement' && this.measurement) {
      reply(200, this.measurement);
    } else if (req.method === 'GET' && path === '/api/system' && this.system) {
      reply(200, this.system);
    } else if (req.method === 'PUT' && path === '/api/system/identify') {
      this.identified += 1;
      reply(204);
    } else {
      reply(404, { error: 'request:not-found' });
    }
  }
}

// --- As a program -------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  const api = args.api ?? '1';
  const fake = new FakeHomeWizard({
    model: args.model ?? 'HWE-P1',
    serial: args.serial ?? '5c2fafa00001',
    host: args.host ?? '0.0.0.0',
    v1: api === '1' || api === 'both',
    v2: api === '2' || api === 'both' ? loadTls(args.tls ?? 'p1') : null,
    ports: { v1: Number(args['v1-port'] ?? 80), v2: Number(args['v2-port'] ?? 443) },
  });
  await fake.start();
  const control = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://control');
    if (req.method === 'POST' && url.pathname === '/press') {
      fake.pressButton();
    } else if (req.method === 'POST' && url.pathname === '/power') {
      fake.setPower(Number(url.searchParams.get('w')));
    } else if (req.method === 'POST' && url.pathname === '/offline') {
      fake.setOffline(url.searchParams.get('on') !== '0');
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(204);
    res.end();
  });
  control.listen(Number(args['control-port'] ?? 8080), args.host ?? '0.0.0.0');
  console.log(
    `Fake HomeWizard ${fake.productType} ${fake.serial}: v1 ${fake.v1Port ?? '-'}, v2 ${fake.v2Port ?? '-'}`,
  );
  const shutdown = () => {
    control.close();
    fake.stop().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
