// -----------------------------------------------------------------------------
// From a HomeWizard device to a Gladys device: the features of each model,
// their names in four languages, the values of a measurement, and the state
// change of each command.
//
// One Gladys device per HomeWizard device, keyed on its serial number (its MAC
// address). The features follow the energy categories of Gladys 5.2:
//   - what the core turns into consumption and cost (energy tab, contracts):
//     the import index of a P1 Meter or a kWh meter (`energy-sensor/index`),
//     the energy of an Energy Socket (`switch/energy`); the export index of a
//     kWh meter is a production index (`energy-production-sensor/index`, a kWh
//     meter on a solar inverter);
//   - the grid exchange of a P1 Meter: export power and indexes, import and
//     export per tariff (`grid-sensor`), which the core shows but never adds
//     up a second time;
//   - the imported power of a P1 Meter is its `energy-sensor/power`: the core
//     reads the peaks of a meter's historized power for the capacity tariffs.
//
// Feature keys are part of the external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import {
  PRODUCT_NAMES,
  TARIFFS,
  externalValue,
  familyOf,
  phasesOf,
  round,
} from './homewizard/model.js';

export const DEVICE_TYPES = {
  p1: 'p1',
  socket: 'socket',
  kwh: 'kwh',
  kwh3: 'kwh',
  water: 'water',
  battery: 'battery',
};

const PHASES = ['l1', 'l2', 'l3'];

// Feature names: frozen in Gladys when the user creates the device, written in
// the language chosen in the configuration at that moment. `{n}` is a phase or
// tariff number.
export const NAMES = {
  en: {
    'power-import': 'Imported power',
    'power-export': 'Exported power',
    'energy-import': 'Import index',
    'energy-export': 'Export index',
    'energy-import-t': 'Import index T{n}',
    'energy-export-t': 'Export index T{n}',
    power: 'Power',
    'power-l': 'Power L{n}',
    voltage: 'Voltage',
    'voltage-l': 'Voltage L{n}',
    current: 'Current',
    'current-l': 'Current L{n}',
    energy: 'Energy index',
    gas: 'Gas',
    water: 'Water',
    wifi: 'Wi-Fi signal',
    switch: 'On/Off',
    lock: 'Switch lock',
    led: 'LED brightness',
    flow: 'Water flow',
    total: 'Water total',
    level: 'Battery level',
    'charge-power': 'Charge power',
    'discharge-power': 'Discharge power',
    'charge-index': 'Charged energy',
    'discharge-index': 'Discharged energy',
    cycles: 'Cycles',
  },
  fr: {
    'power-import': 'Puissance importée',
    'power-export': 'Puissance exportée',
    'energy-import': 'Index import',
    'energy-export': 'Index export',
    'energy-import-t': 'Index import T{n}',
    'energy-export-t': 'Index export T{n}',
    power: 'Puissance',
    'power-l': 'Puissance L{n}',
    voltage: 'Tension',
    'voltage-l': 'Tension L{n}',
    current: 'Courant',
    'current-l': 'Courant L{n}',
    energy: "Index d'énergie",
    gas: 'Gaz',
    water: 'Eau',
    wifi: 'Signal Wi-Fi',
    switch: 'Marche/Arrêt',
    lock: 'Verrouillage du bouton',
    led: 'Luminosité de la LED',
    flow: "Débit d'eau",
    total: "Total d'eau",
    level: 'Niveau de batterie',
    'charge-power': 'Puissance de charge',
    'discharge-power': 'Puissance de décharge',
    'charge-index': 'Énergie chargée',
    'discharge-index': 'Énergie déchargée',
    cycles: 'Cycles',
  },
  de: {
    'power-import': 'Bezogene Leistung',
    'power-export': 'Eingespeiste Leistung',
    'energy-import': 'Zählerstand Bezug',
    'energy-export': 'Zählerstand Einspeisung',
    'energy-import-t': 'Zählerstand Bezug T{n}',
    'energy-export-t': 'Zählerstand Einspeisung T{n}',
    power: 'Leistung',
    'power-l': 'Leistung L{n}',
    voltage: 'Spannung',
    'voltage-l': 'Spannung L{n}',
    current: 'Strom',
    'current-l': 'Strom L{n}',
    energy: 'Energiezähler',
    gas: 'Gas',
    water: 'Wasser',
    wifi: 'WLAN-Signal',
    switch: 'Ein/Aus',
    lock: 'Tastensperre',
    led: 'LED-Helligkeit',
    flow: 'Wasserdurchfluss',
    total: 'Wasserzählerstand',
    level: 'Ladestand',
    'charge-power': 'Ladeleistung',
    'discharge-power': 'Entladeleistung',
    'charge-index': 'Geladene Energie',
    'discharge-index': 'Entladene Energie',
    cycles: 'Ladezyklen',
  },
  es: {
    'power-import': 'Potencia importada',
    'power-export': 'Potencia exportada',
    'energy-import': 'Índice de importación',
    'energy-export': 'Índice de exportación',
    'energy-import-t': 'Índice de importación T{n}',
    'energy-export-t': 'Índice de exportación T{n}',
    power: 'Potencia',
    'power-l': 'Potencia L{n}',
    voltage: 'Tensión',
    'voltage-l': 'Tensión L{n}',
    current: 'Corriente',
    'current-l': 'Corriente L{n}',
    energy: 'Índice de energía',
    gas: 'Gas',
    water: 'Agua',
    wifi: 'Señal Wi-Fi',
    switch: 'Encendido/Apagado',
    lock: 'Bloqueo del botón',
    led: 'Brillo del LED',
    flow: 'Caudal de agua',
    total: 'Total de agua',
    level: 'Nivel de batería',
    'charge-power': 'Potencia de carga',
    'discharge-power': 'Potencia de descarga',
    'charge-index': 'Energía cargada',
    'discharge-index': 'Energía descargada',
    cycles: 'Ciclos',
  },
};

const INDEX_MAX = 1_000_000_000;

// Shapes, by name pattern. `slow`: published at most once a minute (indexes,
// voltages...): they move at every reading and nothing needs them faster,
// while Gladys caps an integration at 300 states a minute.
const W = (min, max) => ({ unit: UNITS.WATT, min, max, decimals: 1 });
const KWH = { unit: UNITS.KILOWATT_HOUR, min: 0, max: INDEX_MAX, decimals: 3, slow: true };
const VOLTS = { unit: UNITS.VOLT, min: 0, max: 400, decimals: 1, slow: true };
const AMPS = (max) => ({ unit: UNITS.AMPERE, min: 0, max, decimals: 2, slow: true });
const WIFI = {
  category: CATEGORIES.SIGNAL,
  type: 'integer',
  min: 0,
  max: 100,
  decimals: 0,
  slow: true,
  history: false,
};

function specOf(family, key) {
  const base = key.replace(/-(l|t)\d$/, (match, letter) => `-${letter}`);
  switch (family) {
    case 'p1':
      return {
        'power-import': {
          category: CATEGORIES.ENERGY_SENSOR,
          type: TYPES.ENERGY_SENSOR.POWER,
          ...W(0, 25000),
        },
        'power-export': {
          category: CATEGORIES.GRID_SENSOR,
          type: TYPES.GRID_SENSOR.OUTPUT_POWER,
          ...W(0, 25000),
        },
        'energy-import': {
          category: CATEGORIES.ENERGY_SENSOR,
          type: TYPES.ENERGY_SENSOR.INDEX,
          ...KWH,
        },
        'energy-export': {
          category: CATEGORIES.GRID_SENSOR,
          type: TYPES.GRID_SENSOR.OUTPUT_INDEX,
          ...KWH,
        },
        'energy-import-t': {
          category: CATEGORIES.GRID_SENSOR,
          type: TYPES.GRID_SENSOR.INPUT_INDEX,
          ...KWH,
        },
        'energy-export-t': {
          category: CATEGORIES.GRID_SENSOR,
          type: TYPES.GRID_SENSOR.OUTPUT_INDEX,
          ...KWH,
        },
        'voltage-l': {
          category: CATEGORIES.ENERGY_SENSOR,
          type: TYPES.ENERGY_SENSOR.VOLTAGE,
          ...VOLTS,
        },
        'current-l': {
          category: CATEGORIES.ENERGY_SENSOR,
          type: TYPES.ENERGY_SENSOR.CURRENT,
          ...AMPS(100),
        },
        gas: volume(),
        water: volume(),
        wifi: WIFI,
      }[base];
    case 'socket':
      return {
        switch: {
          category: CATEGORIES.SWITCH,
          type: TYPES.SWITCH.BINARY,
          min: 0,
          max: 1,
          writable: true,
          decimals: 0,
        },
        power: { category: CATEGORIES.SWITCH, type: TYPES.SWITCH.POWER, ...W(0, 3680) },
        energy: { category: CATEGORIES.SWITCH, type: TYPES.SWITCH.ENERGY, ...KWH },
        voltage: { category: CATEGORIES.SWITCH, type: TYPES.SWITCH.VOLTAGE, ...VOLTS },
        current: { category: CATEGORIES.SWITCH, type: TYPES.SWITCH.CURRENT, ...AMPS(16) },
        lock: {
          category: CATEGORIES.CHILD_LOCK,
          type: TYPES.CHILD_LOCK.BINARY,
          min: 0,
          max: 1,
          writable: true,
          decimals: 0,
          history: false,
        },
        led: {
          category: CATEGORIES.SWITCH,
          type: TYPES.SWITCH.DIMMER,
          min: 0,
          max: 100,
          writable: true,
          decimals: 0,
          history: false,
        },
        wifi: WIFI,
      }[base];
    case 'kwh':
    case 'kwh3': {
      // A kWh meter may measure a solar inverter: signed power, symmetric
      // bounds (the gauge places its needle between them).
      const total = family === 'kwh' ? 12000 : 70000;
      return {
        power: {
          category: CATEGORIES.ENERGY_SENSOR,
          type: TYPES.ENERGY_SENSOR.POWER,
          ...W(-total, total),
        },
        'power-l': {
          category: CATEGORIES.ENERGY_SENSOR,
          type: TYPES.ENERGY_SENSOR.POWER,
          ...W(-25000, 25000),
        },
        'energy-import': {
          category: CATEGORIES.ENERGY_SENSOR,
          type: TYPES.ENERGY_SENSOR.INDEX,
          ...KWH,
        },
        'energy-export': {
          category: CATEGORIES.ENERGY_PRODUCTION_SENSOR,
          type: TYPES.ENERGY_PRODUCTION_SENSOR.INDEX,
          ...KWH,
        },
        voltage: {
          category: CATEGORIES.ENERGY_SENSOR,
          type: TYPES.ENERGY_SENSOR.VOLTAGE,
          ...VOLTS,
        },
        'voltage-l': {
          category: CATEGORIES.ENERGY_SENSOR,
          type: TYPES.ENERGY_SENSOR.VOLTAGE,
          ...VOLTS,
        },
        current: {
          category: CATEGORIES.ENERGY_SENSOR,
          type: TYPES.ENERGY_SENSOR.CURRENT,
          ...AMPS(100),
        },
        'current-l': {
          category: CATEGORIES.ENERGY_SENSOR,
          type: TYPES.ENERGY_SENSOR.CURRENT,
          ...AMPS(100),
        },
        wifi: WIFI,
      }[base];
    }
    case 'water':
      return {
        flow: {
          category: CATEGORIES.WATER_VALVE,
          type: TYPES.WATER_VALVE.FLOW,
          unit: UNITS.CUBIC_METER_PER_HOUR,
          min: 0,
          max: 10,
          decimals: 3,
        },
        total: volume(),
        wifi: WIFI,
      }[base];
    case 'battery':
      return {
        level: {
          category: CATEGORIES.BATTERY_STORAGE,
          type: TYPES.BATTERY_STORAGE.BATTERY_LEVEL,
          unit: UNITS.PERCENT,
          min: 0,
          max: 100,
          decimals: 0,
        },
        'charge-power': {
          category: CATEGORIES.BATTERY_STORAGE,
          type: TYPES.BATTERY_STORAGE.CHARGE_POWER,
          ...W(0, 3000),
        },
        'discharge-power': {
          category: CATEGORIES.BATTERY_STORAGE,
          type: TYPES.BATTERY_STORAGE.DISCHARGE_POWER,
          ...W(0, 3000),
        },
        'charge-index': {
          category: CATEGORIES.BATTERY_STORAGE,
          type: TYPES.BATTERY_STORAGE.CHARGE_INDEX,
          ...KWH,
        },
        'discharge-index': {
          category: CATEGORIES.BATTERY_STORAGE,
          type: TYPES.BATTERY_STORAGE.DISCHARGE_INDEX,
          ...KWH,
        },
        cycles: {
          category: CATEGORIES.COUNTER_SENSOR,
          type: 'integer',
          min: 0,
          max: 100000,
          decimals: 0,
          slow: true,
        },
        wifi: WIFI,
      }[base];
    default:
      return undefined;
  }
}

function volume() {
  return {
    category: CATEGORIES.VOLUME_SENSOR,
    type: TYPES.VOLUME_SENSOR.DECIMAL,
    unit: UNITS.CUBIC_METER,
    min: 0,
    max: INDEX_MAX,
    decimals: 3,
    slow: true,
  };
}

/** Name of a feature key in a language (`voltage-l2` -> "Tension L2"). */
export function featureName(key, language) {
  const names = NAMES[language] ?? NAMES.en;
  const match = key.match(/^(.*-(?:l|t))(\d)$/);
  if (match) {
    return names[match[1]].replace('{n}', match[2]);
  }
  return names[key];
}

/**
 * The feature keys a measurement shows, in display order. A key appears when
 * the device reports its value; the hub keeps every key seen once (a gas meter
 * read every hour, a value missing from one answer), so the structure of a
 * device does not flicker.
 * @param {string} family
 * @param {object} m normalized measurement (src/homewizard/model.js)
 * @param {object} [extra] `{ state, wifi }` read besides the measurement
 */
export function featureKeys(family, m, extra = {}) {
  const keys = [];
  const has = (name) => m[name] !== null && m[name] !== undefined;
  const wifi = extra.wifi !== null && extra.wifi !== undefined;
  switch (family) {
    case 'p1': {
      if (has('power_w')) {
        keys.push('power-import', 'power-export');
      }
      if (has('energy_import_kwh')) {
        keys.push('energy-import');
      }
      if (has('energy_export_kwh')) {
        keys.push('energy-export');
      }
      // The tariffs only mean something on a meter with several of them.
      if (has('energy_import_t2_kwh') || has('energy_export_t2_kwh')) {
        for (const t of TARIFFS) {
          if (has(`energy_import_t${t}_kwh`)) {
            keys.push(`energy-import-t${t}`);
          }
        }
        for (const t of TARIFFS) {
          if (has(`energy_export_t${t}_kwh`)) {
            keys.push(`energy-export-t${t}`);
          }
        }
      }
      phasesOf(m, 'voltage', 'v').forEach((phase) => keys.push(`voltage-${phase}`));
      phasesOf(m, 'current', 'a').forEach((phase) => keys.push(`current-${phase}`));
      if (externalValue(m, 'gas_meter') !== null) {
        keys.push('gas');
      }
      if (externalValue(m, 'water_meter') !== null) {
        keys.push('water');
      }
      break;
    }
    case 'socket':
      if (typeof extra.state?.power_on === 'boolean') {
        keys.push('switch');
      }
      if (has('power_w')) {
        keys.push('power');
      }
      if (has('energy_import_kwh')) {
        keys.push('energy');
      }
      if (has('voltage_v')) {
        keys.push('voltage');
      }
      if (has('current_a')) {
        keys.push('current');
      }
      if (typeof extra.state?.switch_lock === 'boolean') {
        keys.push('lock');
      }
      if (typeof extra.state?.brightness === 'number') {
        keys.push('led');
      }
      break;
    case 'kwh':
    case 'kwh3': {
      if (has('power_w')) {
        keys.push('power');
      }
      if (family === 'kwh3') {
        phasesOf(m, 'power', 'w').forEach((phase) => keys.push(`power-${phase}`));
      }
      if (has('energy_import_kwh')) {
        keys.push('energy-import');
      }
      if (has('energy_export_kwh')) {
        keys.push('energy-export');
      }
      if (family === 'kwh3') {
        phasesOf(m, 'voltage', 'v').forEach((phase) => keys.push(`voltage-${phase}`));
        phasesOf(m, 'current', 'a').forEach((phase) => keys.push(`current-${phase}`));
      } else {
        if (has('voltage_v')) {
          keys.push('voltage');
        }
        if (has('current_a')) {
          keys.push('current');
        }
      }
      break;
    }
    case 'water':
      if (has('active_liter_lpm')) {
        keys.push('flow');
      }
      if (has('total_liter_m3')) {
        keys.push('total');
      }
      break;
    case 'battery':
      if (has('state_of_charge_pct')) {
        keys.push('level');
      }
      if (has('power_w')) {
        keys.push('charge-power', 'discharge-power');
      }
      if (has('energy_import_kwh')) {
        keys.push('charge-index');
      }
      if (has('energy_export_kwh')) {
        keys.push('discharge-index');
      }
      if (has('cycles')) {
        keys.push('cycles');
      }
      break;
    default:
      break;
  }
  if (wifi) {
    keys.push('wifi');
  }
  return keys;
}

/** Merge newly seen keys into the known ones, keeping the display order. */
export function mergeKeys(family, known, seen) {
  const all = new Set([...(known ?? []), ...seen]);
  return orderOf(family).filter((key) => all.has(key));
}

function orderOf(family) {
  const tariffs = (direction) => TARIFFS.map((t) => `energy-${direction}-t${t}`);
  const phased = (name) => PHASES.map((phase) => `${name}-${phase}`);
  switch (family) {
    case 'p1':
      return [
        'power-import',
        'power-export',
        'energy-import',
        'energy-export',
        ...tariffs('import'),
        ...tariffs('export'),
        ...phased('voltage'),
        ...phased('current'),
        'gas',
        'water',
        'wifi',
      ];
    case 'socket':
      return ['switch', 'power', 'energy', 'voltage', 'current', 'lock', 'led', 'wifi'];
    case 'kwh':
    case 'kwh3':
      return [
        'power',
        ...phased('power'),
        'energy-import',
        'energy-export',
        'voltage',
        ...phased('voltage'),
        'current',
        ...phased('current'),
        'wifi',
      ];
    case 'water':
      return ['flow', 'total', 'wifi'];
    case 'battery':
      return [
        'level',
        'charge-power',
        'discharge-power',
        'charge-index',
        'discharge-index',
        'cycles',
        'wifi',
      ];
    default:
      return [];
  }
}

/** Full spec of a feature: shape, name, behaviour. */
export function featureSpec(family, key, language) {
  const spec = specOf(family, key);
  if (!spec) {
    return null;
  }
  return {
    key,
    name: featureName(key, language),
    history: spec.history !== false,
    ...spec,
  };
}

export function deviceIds(gladys, family, serial) {
  return gladys.externalIds(DEVICE_TYPES[family], serial);
}

/** "HomeWizard P1 Meter aabbcc": the brand, the product, the end of the serial. */
export function deviceName(record) {
  const product = PRODUCT_NAMES[record.productType] ?? record.productType;
  return `HomeWizard ${product} ${record.serial.slice(-6)}`;
}

/**
 * The Gladys device of a record (discovery payload).
 * @param {object} gladys
 * @param {object} record hub record: serial, productType, address, version, keys...
 * @param {string} language
 */
export function buildDevice(gladys, record, language) {
  const family = familyOf(record.productType);
  const ids = deviceIds(gladys, family, record.serial);
  const params = [
    { name: 'IP_ADDRESS', value: record.address },
    { name: 'SERIAL_NUMBER', value: record.serial },
    { name: 'LOCAL_API', value: record.token ? 'v2' : 'v1' },
  ];
  if (record.firmware) {
    params.push({ name: 'FIRMWARE', value: String(record.firmware).slice(0, 32) });
  }
  return {
    name: deviceName(record),
    external_id: ids.device,
    model: record.productType,
    // The container reads every device at the pace chosen in the
    // configuration: the Gladys scheduler polls a minute at most.
    should_poll: false,
    params,
    features: (record.keys ?? [])
      .map((key) => featureSpec(family, key, language))
      .filter(Boolean)
      .map((spec) => {
        const feature = {
          name: spec.name,
          external_id: ids.feature(spec.key),
          category: spec.category,
          type: spec.type,
          min: spec.min,
          max: spec.max,
          read_only: spec.writable !== true,
          has_feedback: spec.writable === true,
          keep_history: spec.history,
        };
        if (spec.unit) {
          feature.unit = spec.unit;
        }
        return feature;
      }),
  };
}

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * The value of every feature key, from the last measurement and state.
 * @returns {Record<string, number>} only the keys with a value
 */
export function deviceValues(record) {
  const family = familyOf(record.productType);
  const m = record.measurement ?? {};
  const state = record.state ?? {};
  const values = {};
  const set = (key, value) => {
    const spec = specOf(family, key);
    if (spec && num(value) !== null) {
      values[key] = round(value, spec.decimals ?? 3);
    }
  };
  const power = num(m.power_w);
  switch (family) {
    case 'p1':
      if (power !== null) {
        set('power-import', Math.max(power, 0));
        set('power-export', Math.max(-power, 0));
      }
      set('energy-import', m.energy_import_kwh);
      set('energy-export', m.energy_export_kwh);
      for (const t of TARIFFS) {
        set(`energy-import-t${t}`, m[`energy_import_t${t}_kwh`]);
        set(`energy-export-t${t}`, m[`energy_export_t${t}_kwh`]);
      }
      for (const phase of PHASES) {
        set(`voltage-${phase}`, m[`voltage_${phase}_v`]);
        // The P1 Meter signs the current with the direction; the size of the
        // current is what matters on a phase (the power says the direction).
        const current = num(m[`current_${phase}_a`]);
        set(`current-${phase}`, current === null ? null : Math.abs(current));
      }
      set('gas', externalValue(m, 'gas_meter'));
      set('water', externalValue(m, 'water_meter'));
      break;
    case 'socket':
      if (typeof state.power_on === 'boolean') {
        values.switch = state.power_on ? 1 : 0;
      }
      if (typeof state.switch_lock === 'boolean') {
        values.lock = state.switch_lock ? 1 : 0;
      }
      if (num(state.brightness) !== null) {
        set('led', (state.brightness / 255) * 100);
      }
      set('power', power);
      set('energy', m.energy_import_kwh);
      set('voltage', m.voltage_v);
      set('current', num(m.current_a) === null ? null : Math.abs(m.current_a));
      break;
    case 'kwh':
    case 'kwh3':
      set('power', power);
      set('energy-import', m.energy_import_kwh);
      set('energy-export', m.energy_export_kwh);
      set('voltage', m.voltage_v);
      set('current', num(m.current_a) === null ? null : Math.abs(m.current_a));
      for (const phase of PHASES) {
        set(`power-${phase}`, m[`power_${phase}_w`]);
        set(`voltage-${phase}`, m[`voltage_${phase}_v`]);
        const current = num(m[`current_${phase}_a`]);
        set(`current-${phase}`, current === null ? null : Math.abs(current));
      }
      break;
    case 'water':
      // Litres per minute -> m³/h, the flow unit Gladys knows.
      set('flow', num(m.active_liter_lpm) === null ? null : m.active_liter_lpm * 0.06);
      set('total', m.total_liter_m3);
      break;
    case 'battery':
      set('level', m.state_of_charge_pct);
      // Seen from the battery's own meter: importing is charging.
      if (power !== null) {
        set('charge-power', Math.max(power, 0));
        set('discharge-power', Math.max(-power, 0));
      }
      set('charge-index', m.energy_import_kwh);
      set('discharge-index', m.energy_export_kwh);
      set('cycles', m.cycles);
      break;
    default:
      break;
  }
  set('wifi', record.wifi);
  return values;
}

/** True when a feature key is published at most once a minute. */
export function isSlow(family, key) {
  return specOf(family, key)?.slow === true;
}

/**
 * The v1 state change of a command on an Energy Socket feature, or null when
 * the feature takes no command.
 * @returns {object|null} body of PUT /api/v1/state
 */
export function stateChangeFor(key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid value ${value}`);
  }
  switch (key) {
    case 'switch':
      return { power_on: number >= 1 };
    case 'lock':
      return { switch_lock: number >= 1 };
    case 'led':
      return { brightness: Math.round((Math.min(Math.max(number, 0), 100) / 100) * 255) };
    default:
      return null;
  }
}
