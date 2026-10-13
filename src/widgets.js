// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `live_energy`.
//
// What the Gladys device boxes do not show: the grid exchange of a P1 Meter as
// one signed gauge (import to the right, export to the left), and, when a kWh
// meter measures the solar inverter, the solar production and the house
// consumption deduced from the two meters:
//     house = import - export + production
//
// Budget (8 components, 2 texts, 1 status, 6 tiles): a gauge, up to four live
// tiles, a status list, a caption. The import and export tiles are bound to the
// P1 features, so they follow the states live; the gauge and the computed
// tiles are refreshed by the hub (at most every 10 s) and by the TTL.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceIds, deviceValues } from './devices.js';
import { familyOf } from './homewizard/model.js';
import { WIDGET_KEY } from './hub.js';

const SOLAR_FAMILIES = ['kwh', 'kwh3', 'socket'];
const GAUGE_MIN_RANGE_W = 5000;

export const TEXT = {
  noMeter: {
    en: 'No HomeWizard P1 Meter yet: add one from the Discovery tab of the integration.',
    fr: "Aucun compteur P1 HomeWizard pour l'instant : ajoutez-en un depuis l'onglet Découverte de l'intégration.",
    de: 'Noch kein HomeWizard P1 Meter: Füge eines über den Tab „Entdecken“ der Integration hinzu.',
    es: 'Todavía no hay ningún medidor P1 HomeWizard: añada uno desde la pestaña Descubrir de la integración.',
  },
  notMeter: {
    en: 'The device chosen in the settings is not a P1 Meter.',
    fr: "L'appareil choisi dans les réglages n'est pas un compteur P1.",
    de: 'Das in den Einstellungen gewählte Gerät ist kein P1 Meter.',
    es: 'El dispositivo elegido en la configuración no es un medidor P1.',
  },
  addSolar: {
    en: 'Solar: choose a kWh meter in the settings.',
    fr: 'Solaire : choisissez un compteur kWh dans les réglages.',
    de: 'Solar: Wähle in den Einstellungen einen kWh-Zähler.',
    es: 'Solar: elija un medidor kWh en la configuración.',
  },
  grid: { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' },
  imported: { en: 'Import', fr: 'Import', de: 'Bezug', es: 'Importación' },
  exported: { en: 'Export', fr: 'Export', de: 'Einspeisung', es: 'Exportación' },
  solar: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  house: { en: 'House', fr: 'Maison', de: 'Haus', es: 'Casa' },
  tariff: { en: 'Tariff', fr: 'Tarif', de: 'Tarif', es: 'Tarifa' },
  gas: { en: 'Gas', fr: 'Gaz', de: 'Gas', es: 'Gas' },
  meter: { en: 'P1 Meter', fr: 'Compteur P1', de: 'P1 Meter', es: 'Medidor P1' },
  solarMeter: {
    en: 'Solar meter',
    fr: 'Compteur solaire',
    de: 'Solarzähler',
    es: 'Medidor solar',
  },
  reading: { en: 'read', fr: 'lu', de: 'gelesen', es: 'leído' },
  unreachable: {
    en: 'not answering',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
};

const t = (text, language) => text[language] ?? text.en;

/** The P1 Meter of the widget: the one chosen, else the only/first one. */
function meterOf(hub, settings) {
  if (settings?.meter) {
    return hub.resolveDevice(settings.meter);
  }
  return hub.recordsOf('p1')[0] ?? null;
}

function solarOf(hub, settings) {
  if (!settings?.solar) {
    return null;
  }
  const record = hub.resolveDevice(settings.solar);
  return record && SOLAR_FAMILIES.includes(familyOf(record.productType)) ? record : null;
}

/**
 * The widget content.
 * @param {object} hub
 * @param {object} request `{ settings, language }`
 */
export function liveEnergy(hub, { settings, language = 'en' } = {}) {
  const meter = meterOf(hub, settings);
  if (!meter) {
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'body', text: t(TEXT.noMeter, language) }],
    };
  }
  if (familyOf(meter.productType) !== 'p1') {
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'body', text: t(TEXT.notMeter, language) }],
    };
  }
  const values = deviceValues(meter);
  const imported = values['power-import'] ?? null;
  const exported = values['power-export'] ?? null;
  const ids = deviceIds(hub.gladys, 'p1', meter.serial);
  const created = hub.isCreated(meter);
  const components = [];

  if (imported !== null && exported !== null) {
    const net = Math.round(imported - exported);
    const range = Math.max(GAUGE_MIN_RANGE_W, Math.ceil(Math.abs(net) / 1000) * 1000);
    components.push({
      type: 'gauge',
      label: t(TEXT.grid, language),
      value: net,
      // Signed: symmetric bounds, the needle stands up at 0 W.
      min: -range,
      max: range,
      unit: 'W',
      color: net < 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    });
  }
  components.push(
    powerTile(
      TEXT.imported,
      'download',
      imported,
      created && ids.feature('power-import'),
      language,
    ),
    powerTile(TEXT.exported, 'upload', exported, created && ids.feature('power-export'), language),
  );

  const solar = solarOf(hub, settings);
  if (solar) {
    const solarPower = deviceValues(solar).power;
    // A kWh meter on an inverter reads the production as a negative power
    // (or positive, wired the other way): its size is the production.
    const production = typeof solarPower === 'number' ? Math.round(Math.abs(solarPower)) : null;
    components.push({
      type: 'value',
      label: t(TEXT.solar, language),
      icon: 'sun',
      value: solar.reachable && production !== null ? production : '-',
      unit: 'W',
      color: WIDGET_COLORS.SUCCESS,
    });
    const house =
      imported !== null && exported !== null && production !== null && solar.reachable
        ? Math.max(Math.round(imported - exported + production), 0)
        : null;
    components.push({
      type: 'value',
      label: t(TEXT.house, language),
      icon: 'home',
      value: house ?? '-',
      unit: 'W',
    });
  }

  const items = [];
  const tariff = meter.measurement?.tariff;
  if (tariff) {
    items.push({ label: t(TEXT.tariff, language), value: `T${tariff}`, icon: 'clock' });
  }
  if (typeof values.gas === 'number') {
    items.push({ label: t(TEXT.gas, language), value: `${values.gas} m³`, icon: 'wind' });
  }
  items.push(reachability(TEXT.meter, meter, language));
  if (solar) {
    items.push(reachability(TEXT.solarMeter, solar, language));
  }
  components.push({ type: 'status', items });

  if (!solar) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.addSolar, language) });
  }
  return { ttl_seconds: 15, components };
}

function powerTile(label, icon, value, featureId, language) {
  // Bound to the feature once the device exists in Gladys: live.
  if (featureId) {
    return { type: 'value', label: t(label, language), icon, device_feature: featureId };
  }
  return { type: 'value', label: t(label, language), icon, value: value ?? '-', unit: 'W' };
}

function reachability(label, record, language) {
  return {
    label: t(label, language),
    value: t(record.reachable ? TEXT.reading : TEXT.unreachable, language),
    color: record.reachable ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
  };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get: (hub, request) => liveEnergy(hub, request),
  },
};
