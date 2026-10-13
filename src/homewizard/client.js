// -----------------------------------------------------------------------------
// HTTP client of the HomeWizard local API.
//
//   - v1: plain HTTP on port 80, no authentication, to be enabled per device in
//     the HomeWizard Energy app ("Local API"). A disabled API answers 403.
//   - v2: HTTPS on port 443, a bearer token per client, obtained by pressing the
//     button of the device (POST /api/user, see `requestToken`). The device
//     certificate is signed by the HomeWizard CA (src/homewizard/cacert.js) and
//     names the device as `appliance/<type>/<serial>` in its common name: the
//     token is only ever sent to a device proving it is the expected one.
//
// One request at a time per device is the hub's job; this module only makes
// requests, with a timeout and a bounded answer size. It never logs a token.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { HOMEWIZARD_CA } from './cacert.js';

export const V1_PORT = 80;
export const V2_PORT = 443;

export const CLIENT_TIMINGS = {
  timeoutMs: 5000,
};

// The answers are a few kilobytes: anything much larger is not a HomeWizard.
const MAX_ANSWER_BYTES = 256 * 1024;

// Name of the HTTPS client of the device (`local/<name>`, 1 to 40 characters
// of [a-zA-Z0-9-_/\# ]). Asking again with the same name replaces the token.
export const TOKEN_USER_NAME = 'local/gladys';

/** Error of a HomeWizard request; `kind` says what to do about it. */
export class HomeWizardError extends Error {
  /**
   * @param {string} message
   * @param {object} details
   * @param {'unreachable'|'disabled'|'unauthorized'|'not-paired'|'not-found'|'http'|'invalid'|'tls'} details.kind
   * @param {number} [details.status] HTTP status
   * @param {Error} [details.cause]
   */
  constructor(message, { kind, status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'HomeWizardError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * The identity a device certificate must carry (local API v2):
 * `appliance/<id>/<serial>`, `<id>` being the certificate name of the product
 * type (it differs from the product type for historical reasons).
 */
const CERTIFICATE_IDS = {
  'HWE-P1': 'p1dongle',
  'HWE-SKT': 'energysocket',
  'HWE-WTR': 'watermeter',
  'HWE-DSP': 'display',
  'HWE-KWH1': 'energymeter',
  'HWE-KWH3': 'energymeter',
  'SDM230-wifi': 'energymeter',
  'SDM630-wifi': 'energymeter',
  'HWE-BAT': 'battery',
};

export function certificateName(productType, serial) {
  const id = CERTIFICATE_IDS[productType];
  return id && serial ? `appliance/${id}/${String(serial).toLowerCase()}` : null;
}

/**
 * One request to a device.
 * @param {object} target
 * @param {string} target.address IP address or host name
 * @param {number} [target.port]
 * @param {1|2} target.version API version (HTTP or HTTPS)
 * @param {string} [target.token] v2 bearer token
 * @param {string} [target.identity] expected certificate name (v2), see certificateName
 * @param {string} [target.ca] trusted CA (tests); the HomeWizard CA otherwise
 * @param {boolean} [target.insecure] v2 without verification: only for the
 *   unauthenticated probe, which sends no secret
 * @param {object} request
 * @param {string} request.path
 * @param {string} [request.method]
 * @param {object} [request.body] JSON body
 * @param {number} [request.timeoutMs]
 * @returns {Promise<{ status: number, body: any }>}
 */
export function homewizardRequest(target, { path, method = 'GET', body, timeoutMs } = {}) {
  const v2 = target.version === 2;
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { Accept: 'application/json' };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = payload.length;
  }
  if (v2) {
    headers['X-Api-Version'] = '2';
    if (target.token) {
      headers.Authorization = `Bearer ${target.token}`;
    }
  }
  const options = {
    host: target.address,
    port: target.port ?? (v2 ? V2_PORT : V1_PORT),
    path,
    method,
    headers,
    agent: false,
  };
  if (v2) {
    if (target.insecure) {
      options.rejectUnauthorized = false;
    } else {
      options.ca = target.ca ?? HOMEWIZARD_CA;
      options.rejectUnauthorized = true;
      // The certificate names the device, not its address: check the name the
      // device must have, once the chain is proven to come from HomeWizard.
      options.checkServerIdentity = (_host, certificate) => {
        const name = certificate?.subject?.CN;
        if (target.identity && String(name).toLowerCase() !== target.identity.toLowerCase()) {
          return new Error(`certificate of ${name ?? 'an unknown device'}, not ${target.identity}`);
        }
        return undefined;
      };
    }
  }
  const timeout = timeoutMs ?? CLIENT_TIMINGS.timeoutMs;
  const where = `${target.address}${path}`;

  return new Promise((resolve, reject) => {
    const req = (v2 ? https : http).request(options, (res) => {
      // The name in the certificate (v2), read while the socket is open.
      const peer = v2 ? res.socket?.getPeerCertificate?.()?.subject?.CN : undefined;
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_ANSWER_BYTES) {
          req.destroy(new HomeWizardError(`${where}: answer too large`, { kind: 'invalid' }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', (err) => reject(asError(err, where)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        if (text.trim() !== '') {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = undefined;
          }
        }
        const status = res.statusCode;
        if (status >= 200 && status < 300) {
          if (parsed === undefined) {
            reject(new HomeWizardError(`${where}: not a JSON answer`, { kind: 'invalid', status }));
          } else {
            resolve({ status, body: parsed, peer: typeof peer === 'string' ? peer : undefined });
          }
          return;
        }
        reject(statusError(status, parsed, where, v2));
      });
    });
    req.setTimeout(timeout, () => {
      req.destroy(
        new HomeWizardError(`${where}: no answer within ${timeout} ms`, { kind: 'unreachable' }),
      );
    });
    req.on('error', (err) => reject(asError(err, where)));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function statusError(status, body, where, v2) {
  const code = typeof body?.error === 'string' ? body.error : body?.error?.description;
  const detail = code ? ` (${String(code).slice(0, 80)})` : '';
  if (status === 401) {
    return new HomeWizardError(`${where}: token refused${detail}`, {
      kind: 'unauthorized',
      status,
    });
  }
  if (status === 403) {
    // v1: the local API is off in the app. v2 /api/user: the button was not
    // pressed (user:creation-not-enabled).
    return new HomeWizardError(`${where}: forbidden${detail}`, {
      kind: v2 ? 'not-paired' : 'disabled',
      status,
    });
  }
  if (status === 404) {
    return new HomeWizardError(`${where}: not found`, { kind: 'not-found', status });
  }
  return new HomeWizardError(`${where}: HTTP ${status}${detail}`, { kind: 'http', status });
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_SIGNATURE_FAILURE',
]);

function asError(err, where) {
  if (err instanceof HomeWizardError) {
    return err;
  }
  if (TLS_CODES.has(err?.code) || /certificate/i.test(err?.message ?? '')) {
    return new HomeWizardError(`${where}: certificate refused (${err.code ?? err.message})`, {
      kind: 'tls',
      cause: err,
    });
  }
  return new HomeWizardError(`${where}: ${err?.code ?? err?.message ?? 'network error'}`, {
    kind: 'unreachable',
    cause: err,
  });
}

// --- The API, one function per endpoint ------------------------------------

/** GET /api: `{ product_type, product_name, serial, firmware_version, api_version }`. */
export async function getDeviceInfo(target) {
  return (await homewizardRequest(target, { path: '/api' })).body;
}

/**
 * Does the address answer the v2 API? An HTTPS `/api` without a token answers
 * 401 on a v2 device; anything else means no (or not now). Sends no secret.
 */
export async function hasV2Api(target) {
  try {
    await homewizardRequest(
      { ...target, version: 2, token: undefined, insecure: true },
      { path: '/api' },
    );
    // Some firmware may answer the identification without a token.
    return true;
  } catch (err) {
    return err.kind === 'unauthorized';
  }
}

/** The latest measurement, raw (v1 `/api/v1/data` or v2 `/api/measurement`). */
export async function getMeasurement(target) {
  const path = target.version === 2 ? '/api/measurement' : '/api/v1/data';
  return (await homewizardRequest(target, { path })).body;
}

/** v1 Energy Socket: `{ power_on, switch_lock, brightness }`. */
export async function getState(target) {
  return (await homewizardRequest(target, { path: '/api/v1/state' })).body;
}

/** v1 Energy Socket: change part of the state; resolves with the new state. */
export async function setState(target, changes) {
  return (await homewizardRequest(target, { path: '/api/v1/state', method: 'PUT', body: changes }))
    .body;
}

/** v2 `/api/system`: Wi-Fi strength, LED brightness, cloud. */
export async function getSystem(target) {
  return (await homewizardRequest(target, { path: '/api/system' })).body;
}

/** Make the device blink its status light for a few seconds. */
export async function identify(target) {
  const path = target.version === 2 ? '/api/system/identify' : '/api/v1/identify';
  await homewizardRequest(target, { path, method: 'PUT' });
}

/**
 * v2: ask for a token. Before the button of the device is pressed the device
 * answers 403 (`not-paired` error); within 30 s after, it answers the token.
 * @returns {Promise<string>} the token (32 hexadecimal characters)
 */
export async function requestToken(target) {
  return (await requestPairing(target)).token;
}

/**
 * v2: ask for a token, and say which device gave it: `{ token, identity }`,
 * `identity` being the certificate name of the device that answered
 * (`appliance/<id>/<serial>`), checked against the HomeWizard CA.
 */
export async function requestPairing(target) {
  const { body, peer } = await homewizardRequest(
    { ...target, version: 2, token: undefined },
    { path: '/api/user', method: 'POST', body: { name: TOKEN_USER_NAME } },
  );
  const token = body?.token;
  if (typeof token !== 'string' || !/^[A-Fa-f0-9]{16,64}$/.test(token)) {
    throw new HomeWizardError(`${target.address}: no token in the answer`, { kind: 'invalid' });
  }
  return { token, identity: peer };
}
