// -----------------------------------------------------------------------------
// The HomeWizard hub: finds the devices, reads them at the configured pace,
// publishes their devices and states to Gladys, runs the commands, pairs the
// v2 devices and fires the scene triggers.
//
// Polling only: the v2 API has a WebSocket, but a container on a Docker bridge
// gains little from it, and v1 devices have none. Gladys never polls these
// devices (should_poll: false); the hub reads each one every 10 s by default.
// One request at a time per device: these are small Wi-Fi devices.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  buildDevice,
  deviceIds,
  deviceName,
  deviceValues,
  featureKeys,
  isSlow,
  mergeKeys,
  stateChangeFor,
} from './devices.js';
import { SCAN_TIMEOUT_SECONDS, mapLimit, parseMdnsServices } from './discovery.js';
import {
  HomeWizardError,
  V1_PORT,
  V2_PORT,
  certificateName,
  getDeviceInfo,
  getMeasurement,
  getState,
  getSystem,
  hasV2Api,
  identify,
  requestPairing,
  setState,
} from './homewizard/client.js';
import {
  canIdentify,
  familyOf,
  normalizeMeasurement,
  normalizeSerial,
  rssiToPercent,
} from './homewizard/model.js';
import { CONNECTION_TEXT, localError } from './texts.js';
import { TRIGGERS, evaluatePower } from './triggers.js';

const logger = createLogger({ name: 'homewizard-hub' });

export const WIDGET_KEY = 'live_energy';

export const HUB_TIMINGS = {
  // New scan, to follow DHCP changes and find new devices.
  rediscoveryMs: 15 * 60_000,
  // Readings in a row without answer before a device is "unreachable".
  unreachableAfter: 3,
  // Slow features (indexes, voltages...) are published at most this often.
  slowPublishMs: 60_000,
  // An unchanged value is re-sent this often, so it stays recently dated.
  heartbeatMs: 30 * 60_000,
  // v2 Wi-Fi strength (/api/system) is read this often.
  systemReadMs: 5 * 60_000,
  // How long the "Pair" action waits for the button presses, and between tries.
  pairWindowMs: 75_000,
  pairRetryMs: 2_000,
  // The widget shows computed values (net power, house): nudge it at most this often.
  widgetNudgeMs: 10_000,
  // States a minute for all the devices, under the 300 Gladys accepts.
  stateBudget: 240,
  // A device whose local API v1 answered 403 is asked again this often.
  v1RetryMs: 5 * 60_000,
};

const PROBE_CONCURRENCY = 6;
const POLL_CONCURRENCY = 6;
// P1 features the widget computes from.
const WIDGET_KEYS = ['power-import', 'power-export', 'power'];

export class HomeWizardHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store persistence (src/store.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.network] test seams: `{ ca, ports: { v1, v2 } }`
   */
  constructor({ gladys, store, timers = true, timings, network = {} }) {
    this.gladys = gladys;
    this.store = store;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.network = network;
    this.config = null;
    /** @type {Map<string, object>} device records, by serial */
    this.records = new Map();
    /** @type {Map<string, object>} addresses answering without telling who they are */
    this.unidentified = new Map();
    this.pending = new Set();
    this.pollTimer = null;
    this.rediscoveryTimer = null;
    this.polling = null;
    this.discovering = null;
    this.pairing = null;
    this.lastScan = { status: 'not-run', found: 0 };
    this.lastWidgetNudge = 0;
    this.devicesDirty = false;
    // A failing mDNS scan, or timer work Gladys refuses: logged once, until it works again.
    this.scanFailing = false;
    this.backgroundFailing = false;
    // States sent in the last minute, for the budget: `[{ at, count }]`.
    this.spent = [];
    this.stopped = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    try {
      await this.restore();
      await this.discover();
      await this.publishDevices();
      await this.publishAllStates();
      await this.publishTransports();
      await this.publishConnectionStatus();
      this.requestWidgetRefresh(true);
    } finally {
      // Even after a failed publication: the readings and the next
      // reconnection (resync) put Gladys right.
      this.startTimers();
    }
  }

  /** Gladys came back (restart, network): it may have lost what was published. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates();
    for (const record of this.records.values()) {
      record.sent = {};
    }
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh(true);
    if (!this.pollTimer) {
      this.startTimers();
    }
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (!previous || previous.hosts.join(',') !== config.hosts.join(',')) {
      await this.discover();
    }
    if (previous && previous.pollSeconds !== config.pollSeconds) {
      this.startTimers();
    }
    // New devices, or names in another language for the Discovery list.
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh(true);
  }

  startTimers() {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    clearInterval(this.pollTimer);
    clearInterval(this.rediscoveryTimer);
    this.pollTimer = setInterval(
      () => this.track(this.timerTask(this.pollAll())),
      this.config.pollSeconds * 1000,
    );
    this.rediscoveryTimer = setInterval(
      () => this.track(this.timerTask(this.rediscover())),
      this.timings.rediscoveryMs,
    );
  }

  /**
   * Work of the timers (readings, rediscovery): a failure (Gladys away, a
   * publication refused) is logged once, then again when it works, not every
   * 10 s.
   */
  async timerTask(promise) {
    try {
      await promise;
    } catch (err) {
      if (this.backgroundFailing) {
        logger.debug(`Still failing: ${err.message}`);
      } else {
        this.backgroundFailing = true;
        logger.warn(`Cannot update Gladys: ${err.message} (retried at the next readings)`);
      }
      return;
    }
    if (this.backgroundFailing) {
      this.backgroundFailing = false;
      logger.info('Gladys is updated again');
    }
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.rediscoveryTimer);
    await this.idle();
    await this.store.flush();
  }

  /** Keep track of background work, so the tests (and stop) can wait for it. */
  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => logger.error('Background task failed', err))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  /** Resolves once no background work is left. */
  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  // --- Persistence -----------------------------------------------------------

  async restore() {
    const data = await this.store.load();
    for (const [key, saved] of Object.entries(data.devices ?? {})) {
      const serial = normalizeSerial(key);
      if (!serial || !saved || typeof saved.address !== 'string' || !familyOf(saved.productType)) {
        continue;
      }
      const record = this.createRecord(serial, saved.productType, saved.address);
      Object.assign(record, {
        firmware: typeof saved.firmware === 'string' ? saved.firmware : null,
        v1Port: Number.isInteger(saved.v1Port) ? saved.v1Port : null,
        v2Port: Number.isInteger(saved.v2Port) ? saved.v2Port : null,
        v1Enabled: typeof saved.v1Enabled === 'boolean' ? saved.v1Enabled : null,
        v2Capable: saved.v2Capable === true,
        token: typeof saved.token === 'string' ? saved.token : null,
        keys: Array.isArray(saved.keys)
          ? mergeKeys(familyOf(saved.productType), [], saved.keys)
          : [],
      });
      this.records.set(serial, record);
    }
  }

  save() {
    const devices = {};
    for (const record of this.records.values()) {
      devices[record.serial] = {
        address: record.address,
        productType: record.productType,
        firmware: record.firmware,
        v1Port: record.v1Port,
        v2Port: record.v2Port,
        v1Enabled: record.v1Enabled,
        v2Capable: record.v2Capable,
        token: record.token,
        keys: record.keys,
      };
    }
    return this.store.save({ devices });
  }

  // --- Records ---------------------------------------------------------------

  createRecord(serial, productType, address) {
    return {
      serial,
      productType,
      address,
      firmware: null,
      v1Port: null,
      v2Port: null,
      // null: not known yet. false: the local API v1 is off in the app.
      v1Enabled: null,
      v2Capable: false,
      token: null,
      keys: [],
      measurement: null,
      state: null,
      wifi: null,
      systemReadAt: 0,
      // null until the first reading or the first scan without one.
      reachable: null,
      failures: 0,
      // Why the device cannot be read: 'disabled' | 'pairing' | 'unauthorized' | 'tls' | null.
      problem: null,
      // Bumped on every command: a reading started before it is stale.
      commandSeq: 0,
      // Last value sent per feature key: `{ value, at }`.
      sent: {},
      // When a v1 API answering 403 may be asked again.
      v1RetryAt: 0,
      // Trigger steps fired and not re-armed, per direction (undefined: first reading).
      fired: { import: undefined, export: undefined },
      queue: Promise.resolve(),
    };
  }

  /** The API version to read a record with, or null when it cannot be read. */
  versionOf(record) {
    if (record.token) {
      return 2;
    }
    if (familyOf(record.productType) === 'battery') {
      return null;
    }
    // A device only announced on the v2 service may have no v1 API at all.
    if (record.v1Enabled === true || (record.v1Enabled === null && !record.v2Capable)) {
      return 1;
    }
    return null;
  }

  target(record, version = this.versionOf(record)) {
    return this.targetFor(record.address, version, {
      v1Port: record.v1Port,
      v2Port: record.v2Port,
      token: version === 2 ? record.token : undefined,
      identity: certificateName(record.productType, record.serial),
    });
  }

  targetFor(address, version, { v1Port, v2Port, token, identity } = {}) {
    const ports = this.network.ports ?? {};
    return {
      address,
      version,
      port: version === 2 ? (v2Port ?? ports.v2 ?? V2_PORT) : (v1Port ?? ports.v1 ?? V1_PORT),
      token,
      identity,
      ca: this.network.ca,
    };
  }

  /** Run `task` alone on its device: one request at a time. */
  exclusive(record, task) {
    const run = record.queue.then(task, task);
    record.queue = run.catch(() => {});
    return run;
  }

  // --- Discovery -------------------------------------------------------------

  /**
   * Scan through the Gladys core, then probe the typed addresses and read the
   * devices found. Resolves with the number of devices answering.
   */
  discover() {
    this.discovering ??= this.runDiscovery().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  async runDiscovery() {
    for (const found of await this.scan()) {
      this.adoptAnnouncement(found);
    }
    const known = new Set([...this.records.values()].map((record) => record.address));
    const typed = this.config.hosts.filter((host) => !known.has(host));
    this.unidentified.clear();
    await mapLimit(typed, PROBE_CONCURRENCY, async (host) => {
      try {
        await this.probeHost(host);
      } catch (err) {
        logger.debug(`No HomeWizard answer from ${host}: ${err.message}`);
        this.unidentified.set(host, { address: host, problem: null });
      }
    });
    const records = [...this.records.values()];
    await mapLimit(records, PROBE_CONCURRENCY, (record) => this.refresh(record));
    for (const record of records) {
      if (record.reachable === null) {
        // Known from /data or announced, silent since the start.
        record.reachable = false;
      }
    }
    await this.save();
    return records.filter((record) => record.reachable).length;
  }

  /** One mDNS browse through the Gladys core. */
  async scan() {
    try {
      const found = parseMdnsServices(
        await this.gladys.scanNetwork('mdns', { timeoutSeconds: SCAN_TIMEOUT_SECONDS }),
      );
      this.lastScan = { status: 'ok', found: found.length };
      if (this.scanFailing) {
        this.scanFailing = false;
        logger.info('HomeWizard discovery through Gladys works again');
      }
      return found;
    } catch (err) {
      // 403: a core without mediated discovery; 429 or 409: a scan ran less
      // than 10 s ago. The typed and known addresses still work.
      const status = err.status === 429 || err.status === 409 ? 'busy' : 'unavailable';
      if (status === 'busy' || this.scanFailing) {
        // Busy is harmless; a lasting failure was said once (every 15 min otherwise).
        logger.debug(`HomeWizard discovery through Gladys failed: ${err.message}`);
      } else {
        this.scanFailing = true;
        logger.warn(`HomeWizard discovery through Gladys failed: ${err.message}`);
      }
      this.lastScan = { status, found: 0 };
      return [];
    }
  }

  /** A device announced on mDNS: new, or known at another address. */
  adoptAnnouncement({ serial, productType, address, v1, v2 }) {
    let record = this.records.get(serial);
    if (!record) {
      record = this.createRecord(serial, productType, address);
      this.records.set(serial, record);
      logger.info(`HomeWizard ${productType} ${serial} found at ${address}`);
    } else if (record.address !== address) {
      logger.info(`HomeWizard ${serial} moved from ${record.address} to ${address}`);
      record.address = address;
    }
    if (v1) {
      record.v1Enabled = v1.enabled;
      record.v1Port = v1.port && v1.port !== V1_PORT ? v1.port : null;
    }
    if (v2) {
      record.v2Capable = true;
      record.v2Port = v2.port && v2.port !== V2_PORT ? v2.port : null;
    }
    return record;
  }

  /**
   * An address typed in the configuration: who is there? The v1 API tells
   * the model and serial without a secret; a v2-only device answers 401
   * until it is paired, so it stays "unidentified" until then.
   */
  async probeHost(address) {
    let info = null;
    let v1Enabled = null;
    try {
      info = await getDeviceInfo(this.targetFor(address, 1));
      v1Enabled = true;
    } catch (err) {
      if (err.kind === 'disabled') {
        v1Enabled = false;
      } else if (err.kind !== 'unreachable' && err.kind !== 'not-found') {
        throw err;
      }
    }
    const v2 = await hasV2Api(this.targetFor(address, 2));
    const serial = normalizeSerial(info?.serial);
    if (!serial || !familyOf(info?.product_type)) {
      if (v1Enabled === null && !v2) {
        throw new Error('no HomeWizard API');
      }
      this.unidentified.set(address, { address, problem: v2 ? 'pairing' : 'disabled' });
      return;
    }
    const record = this.adoptAnnouncement({
      serial,
      productType: info.product_type,
      address,
      v1: { enabled: v1Enabled !== false },
      v2: v2 ? {} : null,
    });
    record.firmware = info.firmware_version ?? record.firmware;
  }

  async rediscover() {
    await this.discover();
    // New devices, and new addresses (DHCP) for the params of the created devices.
    await this.publishDevices();
    await this.publishTransports();
    await this.publishConnectionStatus();
  }

  // --- Devices ---------------------------------------------------------------

  /** Records Gladys can show: read at least once, with features. */
  publishable() {
    return [...this.records.values()].filter((record) => record.keys.length > 0);
  }

  async publishDevices() {
    // Set again if this publication fails: the next readings retry it.
    this.devicesDirty = true;
    const devices = this.publishable().map((record) =>
      buildDevice(this.gladys, record, this.config.language),
    );
    await this.gladys.publishDiscoveredDevices(devices);
    this.devicesDirty = false;
  }

  /** The record behind a Gladys device external id, or null. */
  resolveDevice(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    for (const record of this.records.values()) {
      if (
        deviceIds(this.gladys, familyOf(record.productType), record.serial).device === externalId
      ) {
        return record;
      }
    }
    return null;
  }

  deviceExternalId(record) {
    return deviceIds(this.gladys, familyOf(record.productType), record.serial).device;
  }

  isCreated(record) {
    const id = this.deviceExternalId(record);
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  require(externalId) {
    const record = this.resolveDevice(externalId);
    if (!record) {
      throw localError('unknownDevice', this.config?.language);
    }
    return record;
  }

  // --- States ----------------------------------------------------------------

  /**
   * Publish what changed for one device, if the user created it. Gladys caps
   * an integration at 300 states a minute and re-evaluates the scenes on each
   * one: unchanged values wait for the heartbeat, slow features go at most
   * once a minute, and a budget shared by all the devices (STATE_BUDGET a
   * minute) holds back what does not fit, until the next reading. Resolves
   * with the keys sent.
   */
  async publishStates(record, { force = false } = {}) {
    if (!this.isCreated(record)) {
      return [];
    }
    const family = familyOf(record.productType);
    const ids = deviceIds(this.gladys, family, record.serial);
    const values = deviceValues(record);
    const now = Date.now();
    const slow = [];
    const fast = [];
    for (const key of record.keys) {
      const value = values[key];
      if (value === undefined) {
        continue;
      }
      const last = record.sent[key];
      if (!force && last) {
        if (last.value === value && now - last.at < this.timings.heartbeatMs) {
          continue;
        }
        if (isSlow(family, key) && now - last.at < this.timings.slowPublishMs) {
          continue;
        }
      }
      (isSlow(family, key) ? slow : fast).push(key);
    }
    // Slow values first: they are rare, and a fast one comes back at the next reading.
    const candidates = [...slow, ...fast];
    const keys = force ? candidates : candidates.slice(0, this.budgetLeft(now));
    if (keys.length < candidates.length) {
      logger.debug(
        `State budget reached: ${candidates.length - keys.length} value(s) of ${record.serial} wait`,
      );
    }
    if (keys.length === 0) {
      return [];
    }
    // The SDK keeps its own copy of what it sent (forgotten on a device creation).
    await this.gladys.publishChangedStates(
      keys.map((key) => ({ device_feature_external_id: ids.feature(key), state: values[key] })),
      { heartbeat: this.timings.heartbeatMs },
    );
    for (const key of keys) {
      record.sent[key] = { value: values[key], at: now };
    }
    this.spent.push({ at: now, count: keys.length });
    return keys;
  }

  /** States still allowed in the last minute. */
  budgetLeft(now) {
    this.spent = this.spent.filter((entry) => now - entry.at < 60_000);
    const used = this.spent.reduce((total, entry) => total + entry.count, 0);
    return Math.max(this.timings.stateBudget - used, 0);
  }

  async publishAllStates() {
    for (const record of this.records.values()) {
      try {
        await this.publishStates(record, { force: true });
      } catch (err) {
        logger.warn(`Cannot publish the states of ${record.serial}: ${err.message}`);
      }
    }
  }

  /**
   * The user added a device: the states sent before were dropped by Gladys,
   * and so was the transport badge. Send them again, nudge the widget.
   */
  async onDeviceCreated(device) {
    const record = this.resolveDevice(device?.external_id);
    if (!record) {
      return;
    }
    this.gladys.forgetPublishedStates(device.external_id);
    record.sent = {};
    await this.publishStates(record, { force: true });
    await this.publishTransports([record]);
    this.requestWidgetRefresh(true);
  }

  async publishTransports(records = [...this.records.values()]) {
    const entries = records
      .filter((record) => this.isCreated(record))
      .map((record) => ({
        external_id: this.deviceExternalId(record),
        transport: record.reachable === true ? 'local' : 'unreachable',
      }));
    for (let at = 0; at < entries.length; at += 100) {
      await this.gladys.publishTransports(entries.slice(at, at + 100));
    }
  }

  async publishConnectionStatus() {
    const records = [...this.records.values()];
    if (records.length === 0 && this.unidentified.size === 0) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noDevice);
    } else if (records.some((record) => record.reachable === true)) {
      await this.gladys.setConnectionStatus(true);
    } else if (
      [...this.unidentified.values()].some((entry) => entry.problem) ||
      records.some((record) => record.problem)
    ) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.needsAction);
    } else {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noAnswer);
    }
  }

  /** Nudge the widget; `now` skips the pacing (structure or reachability changed). */
  requestWidgetRefresh(now = false) {
    const at = Date.now();
    if (!now && at - this.lastWidgetNudge < this.timings.widgetNudgeMs) {
      return;
    }
    this.lastWidgetNudge = at;
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Polling -----------------------------------------------------------------

  /** Read every device once (the timer's job). */
  pollAll() {
    this.polling ??= mapLimit([...this.records.values()], POLL_CONCURRENCY, (record) =>
      this.refresh(record),
    )
      .then(async (results) => {
        for (const { error } of results) {
          if (error) {
            // A state Gladys refused: sent again at the next readings.
            logger.debug(`Reading not fully published: ${error.message}`);
          }
        }
        if (this.devicesDirty) {
          // A new structure Gladys did not get (a failed publication).
          await this.publishDevices();
        }
      })
      .finally(() => {
        this.polling = null;
      });
    return this.polling;
  }

  /** Read one device and publish what changed. */
  refresh(record) {
    return this.exclusive(record, () => this.read(record));
  }

  async read(record) {
    let version = this.versionOf(record);
    if (version === null && (await this.v1TurnedBackOn(record))) {
      version = 1;
    }
    if (version === null) {
      await this.setProblem(record, record.v2Capable ? 'pairing' : 'disabled');
      return;
    }
    const seq = record.commandSeq;
    const target = this.target(record, version);
    const family = familyOf(record.productType);
    let raw;
    let state = null;
    let wifi = record.wifi;
    try {
      if (!record.firmware) {
        // Once: the firmware version, for the device params (diagnostics).
        record.firmware = (await getDeviceInfo(target))?.firmware_version ?? null;
      }
      raw = await getMeasurement(target);
      if (family === 'socket' && version === 1) {
        state = await getState(target);
      }
      if (version === 2 && Date.now() - record.systemReadAt >= this.timings.systemReadMs) {
        record.systemReadAt = Date.now();
        try {
          wifi = rssiToPercent((await getSystem(target)).wifi_rssi_db);
        } catch (err) {
          logger.debug(`No system answer from ${record.address}: ${err.message}`);
        }
      }
    } catch (err) {
      await this.readFailed(record, version, err);
      return;
    }
    if (version === 1) {
      wifi = typeof raw?.wifi_strength === 'number' ? raw.wifi_strength : null;
    }
    if (seq !== record.commandSeq) {
      // A Gladys command ran meanwhile: this reading may predate it.
      return;
    }
    await this.applyReading(record, { raw, state, wifi, version });
  }

  /**
   * A v1 API seen off (403) is asked again every few minutes: the user may
   * have turned it back on in the app, and nothing else would tell (a typed
   * address gets no mDNS announcement).
   */
  async v1TurnedBackOn(record) {
    if (record.v1Enabled !== false || familyOf(record.productType) === 'battery') {
      return false;
    }
    if (Date.now() < record.v1RetryAt) {
      return false;
    }
    record.v1RetryAt = Date.now() + this.timings.v1RetryMs;
    try {
      await getDeviceInfo(this.target(record, 1));
    } catch {
      return false;
    }
    record.v1Enabled = true;
    this.track(this.save());
    return true;
  }

  async readFailed(record, version, err) {
    switch (err.kind) {
      case 'disabled':
        record.v1Enabled = false;
        record.v1RetryAt = Date.now() + this.timings.v1RetryMs;
        await this.setProblem(record, record.v2Capable ? 'pairing' : 'disabled');
        this.track(this.save());
        return;
      case 'unauthorized':
        // The token was revoked (the user removed it, or the device was reset).
        logger.warn(`HomeWizard ${record.serial} refused its token: pair it again`);
        record.token = null;
        await this.setProblem(record, 'unauthorized');
        this.track(this.save());
        return;
      case 'tls':
        // Said once: the device stays in error until a reading works again.
        if (record.problem === 'tls') {
          logger.debug(`HomeWizard ${record.serial}: ${err.message}`);
        } else {
          logger.warn(`HomeWizard ${record.serial}: ${err.message}`);
        }
        await this.setProblem(record, 'tls');
        return;
      default:
        logger.debug(`Cannot read ${record.address} (v${version}): ${err.message}`);
        await this.failed(record);
    }
  }

  /** A device that answers but cannot be read: show why, once. */
  async setProblem(record, problem) {
    if (record.problem === problem && record.reachable === false) {
      return;
    }
    record.problem = problem;
    // Its power is unknown meanwhile: no crossing from a stale value later.
    record.fired = { import: undefined, export: undefined };
    const wasReachable = record.reachable;
    record.reachable = false;
    if (wasReachable !== false) {
      await this.publishTransports([record]);
      await this.publishConnectionStatus();
      this.requestWidgetRefresh(true);
    }
  }

  /** A fresh reading: publish what changed, follow the reachability, fire the triggers. */
  async applyReading(record, { raw, state, wifi, version }, { own = false } = {}) {
    if (raw !== undefined) {
      record.measurement = normalizeMeasurement(raw);
    }
    if (state) {
      record.state = { ...record.state, ...state };
    }
    record.wifi = typeof wifi === 'number' ? wifi : null;
    record.failures = 0;
    record.problem = null;
    const family = familyOf(record.productType);
    const keys = mergeKeys(
      family,
      record.keys,
      featureKeys(family, record.measurement ?? {}, { state: record.state, wifi: record.wifi }),
    );
    const structureChanged = keys.join(',') !== record.keys.join(',');
    if (structureChanged) {
      record.keys = keys;
      this.track(this.save());
      // New features (a gas meter answering, the first reading): the
      // Discovery tab offers to add the device or to update it.
      await this.publishDevices();
    }
    if (record.reachable !== true) {
      record.reachable = true;
      logger.info(`HomeWizard ${record.serial} read at ${record.address} (API v${version})`);
      await this.publishTransports([record]);
      await this.publishConnectionStatus();
      this.requestWidgetRefresh(true);
    }
    if (family === 'p1' && !own) {
      this.checkTriggers(record);
    }
    const sent = await this.publishStates(record);
    if (sent.some((key) => WIDGET_KEYS.includes(key))) {
      this.requestWidgetRefresh();
    }
  }

  /**
   * A reading without answer. After a few in a row the device is
   * unreachable: badge, connection status, widget. Its values stay.
   */
  async failed(record) {
    if (this.stopped) {
      return;
    }
    record.failures += 1;
    if (record.failures < this.timings.unreachableAfter && record.reachable !== null) {
      return;
    }
    if (record.reachable === false) {
      return;
    }
    record.reachable = false;
    logger.info(`HomeWizard ${record.serial} no longer answers at ${record.address}`);
    // Its power is unknown now: the next reading must not see a crossing
    // from a stale value.
    record.fired = { import: undefined, export: undefined };
    await this.publishTransports([record]);
    await this.publishConnectionStatus();
    this.requestWidgetRefresh(true);
  }

  checkTriggers(record) {
    const power = record.measurement?.power_w;
    if (typeof power !== 'number') {
      return;
    }
    const created = this.isCreated(record);
    const device = this.deviceExternalId(record);
    for (const [direction, key, value] of [
      ['import', TRIGGERS.IMPORT_ABOVE, Math.max(power, 0)],
      ['export', TRIGGERS.EXPORT_ABOVE, Math.max(-power, 0)],
    ]) {
      const { fired, crossed } = evaluatePower(value, record.fired[direction]);
      record.fired[direction] = fired;
      if (!created) {
        continue;
      }
      for (const threshold of crossed) {
        this.track(
          this.gladys.publishSceneEvent(key, { device, threshold, power: Math.round(value) }),
        );
      }
    }
  }

  // --- Commands ----------------------------------------------------------------

  /** A Gladys command on a feature of one of the devices (Energy Socket). */
  async setValue(device, feature, value) {
    const record = this.require(device?.external_id);
    const prefix = `${device.external_id}:`;
    const key = feature?.external_id?.startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : null;
    const change = familyOf(record.productType) === 'socket' ? stateChangeFor(key, value) : null;
    if (!change) {
      throw localError('readOnly', this.config.language);
    }
    await this.changeState(record, change);
  }

  /** PUT a state change on an Energy Socket, then publish the state it answers. */
  changeState(record, change) {
    return this.exclusive(record, async () => {
      if (this.versionOf(record) !== 1) {
        throw localError('unreadable', this.config.language);
      }
      if ('power_on' in change && record.state?.switch_lock === true) {
        // The socket would refuse it: say why.
        throw localError('locked', this.config.language);
      }
      record.commandSeq += 1;
      let answer;
      try {
        answer = await setState(this.target(record, 1), change);
      } catch (err) {
        if (err.kind === 'unreachable') {
          await this.failed(record);
          throw localError('unreachable', this.config.language, err);
        }
        throw err;
      }
      const state = answer && typeof answer === 'object' ? answer : change;
      await this.applyReading(record, { state, wifi: record.wifi, version: 1 }, { own: true });
      return { ...record.state };
    });
  }

  /** Turn an Energy Socket on or off (scene actions). */
  async switchSocket(deviceExternalId, on) {
    const record = this.require(deviceExternalId);
    if (familyOf(record.productType) !== 'socket') {
      throw localError('notSocket', this.config.language);
    }
    const state = await this.changeState(record, { power_on: on });
    return state.power_on === true;
  }

  /** Blink the status light of a device. Resolves false when it cannot. */
  async identify(deviceExternalId) {
    const record = this.require(deviceExternalId);
    const version = this.versionOf(record);
    if (version === null) {
      throw localError('unreadable', this.config.language);
    }
    if (!canIdentify(record.productType, version)) {
      return false;
    }
    await this.exclusive(record, async () => {
      try {
        await identify(this.target(record, version));
      } catch (err) {
        if (err.kind === 'unreachable') {
          throw localError('unreachable', this.config.language, err);
        }
        throw err;
      }
    });
    return true;
  }

  // --- Pairing (local API v2) --------------------------------------------------

  /**
   * Ask a token of every v2 device without one, again and again during the
   * pairing window: the user presses the button of each device meanwhile.
   * Resolves with the names of the devices paired and of the ones missed.
   */
  pair() {
    this.pairing ??= this.runPairing().finally(() => {
      this.pairing = null;
    });
    return this.pairing;
  }

  async runPairing() {
    const waiting = [
      ...[...this.records.values()]
        .filter((record) => record.v2Capable && !record.token)
        .map((record) => ({ address: record.address, record })),
      ...[...this.unidentified.values()]
        .filter((entry) => entry.problem === 'pairing')
        .map((entry) => ({ address: entry.address, record: null })),
    ];
    const paired = [];
    if (waiting.length === 0) {
      return { paired, missed: [] };
    }
    const deadline = Date.now() + this.timings.pairWindowMs;
    let left = waiting;
    while (left.length > 0 && !this.stopped) {
      const results = await mapLimit(left, PROBE_CONCURRENCY, (entry) => this.tryPair(entry));
      left = left.filter((_entry, index) => {
        const result = results[index];
        if (result.value) {
          paired.push(result.value);
          return false;
        }
        if (result.error && result.error.kind !== 'not-paired') {
          logger.debug(`Pairing ${_entry.address}: ${result.error.message}`);
        }
        return true;
      });
      if (left.length === 0 || Date.now() + this.timings.pairRetryMs > deadline) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, this.timings.pairRetryMs));
    }
    if (paired.length > 0) {
      await this.save();
      await this.publishDevices();
      await this.publishTransports();
      await this.publishConnectionStatus();
      this.requestWidgetRefresh(true);
    }
    return {
      paired,
      missed: left.map(({ address, record }) => (record ? deviceName(record) : address)),
    };
  }

  /** One token request; resolves with the device name once paired, throws before. */
  async tryPair({ address, record }) {
    const expected = record ? certificateName(record.productType, record.serial) : undefined;
    const target = this.targetFor(address, 2, { v2Port: record?.v2Port, identity: expected });
    const pairing = await requestPairing(target);
    const { token } = pairing;
    const identity = pairing.identity?.toLowerCase();
    let paired = record;
    if (!paired) {
      // A typed address: the certificate says which device gave the token
      // (checked against the HomeWizard CA); the identification must be that
      // same device, over a connection held to the same name.
      if (!/^appliance\/[a-z0-9]+\/[0-9a-f]{12}$/.test(identity ?? '')) {
        throw new HomeWizardError(`${address}: certificate without a device name`, { kind: 'tls' });
      }
      const info = await getDeviceInfo({ ...target, token, identity });
      const serial = normalizeSerial(info?.serial);
      if (
        !serial ||
        !familyOf(info?.product_type) ||
        certificateName(info.product_type, serial) !== identity
      ) {
        throw new HomeWizardError(`${address} is not the HomeWizard device its certificate names`, {
          kind: 'invalid',
        });
      }
      paired = this.adoptAnnouncement({
        serial,
        productType: info.product_type,
        address,
        v1: null,
        v2: {},
      });
      paired.firmware = info.firmware_version ?? paired.firmware;
      this.unidentified.delete(address);
    }
    paired.token = token;
    paired.v2Capable = true;
    paired.problem = null;
    // Kept at once: the token is good whatever happens next.
    this.track(this.save());
    logger.info(`HomeWizard ${paired.serial} paired (local API v2)`);
    try {
      await this.refresh(paired);
    } catch (err) {
      logger.warn(`First v2 reading of ${paired.serial} failed: ${err.message}`);
    }
    return deviceName(paired);
  }

  // --- Reports -------------------------------------------------------------------

  /** What the Configuration screen's "Search" action reports. */
  summary() {
    return {
      scan: this.lastScan.status,
      invalidHosts: this.config.invalidHosts,
      devices: [...this.records.values()].map((record) => {
        const version = this.versionOf(record);
        return {
          name: deviceName(record),
          address: record.address,
          api: version ? `API v${version}` : null,
          reachable: record.reachable === true,
          problem: record.problem,
        };
      }),
      unidentified: [...this.unidentified.values()],
    };
  }

  /** P1 Meters and kWh meters known, for the widget. */
  recordsOf(...families) {
    return [...this.records.values()].filter((record) =>
      families.includes(familyOf(record.productType)),
    );
  }
}
