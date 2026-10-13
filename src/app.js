// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake) and
// returns the hub, so index.js stays a few lines and the tests drive the very
// same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { HomeWizardHub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { ACTION_TEXT, INIT_FAILED, pairMessage, searchMessage } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'homewizard-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, timers, timings, network
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new HomeWizardHub({
    gladys,
    store: options.store ?? new Store(),
    timers: options.timers ?? true,
    timings: options.timings,
    network: options.network,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first scan is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): re-sync what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The devices are published with should_poll: false (read by the hub's own
  // timer); this only serves a Gladys that would poll anyway.
  gladys.onPoll(
    whenReady(async (device) => {
      const record = hub.resolveDevice(device?.external_id);
      if (record) {
        await hub.refresh(record);
      }
    }),
  );

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'search',
    whenReady(async () => {
      await hub.rediscover();
      return searchMessage(hub.summary());
    }),
  );

  gladys.onAction(
    'pair',
    whenReady(async () => pairMessage(await hub.pair())),
  );

  gladys.onAction(
    'identify',
    whenReady(async (fields = {}) => {
      if (!(await hub.identify(fields.device))) {
        return ACTION_TEXT.cannotIdentify;
      }
      return ACTION_TEXT.identified;
    }),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields: fields ?? {} })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
