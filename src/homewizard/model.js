// -----------------------------------------------------------------------------
// HomeWizard products and their measurements.
//
// The v1 and v2 APIs name the same values differently (`total_power_import_kwh`
// / `energy_import_kwh`, `active_power_w` / `power_w`...): `normalizeMeasurement`
// brings both to the v2 names, following python-homewizard-energy
// (Apache-2.0), whose test fixtures are real answers of every model.
// -----------------------------------------------------------------------------

/** Product type -> family (one Gladys device shape per family). */
export const FAMILIES = {
  'HWE-P1': 'p1',
  'HWE-SKT': 'socket',
  'HWE-KWH1': 'kwh',
  'SDM230-wifi': 'kwh',
  'HWE-KWH3': 'kwh3',
  'SDM630-wifi': 'kwh3',
  'HWE-WTR': 'water',
  'HWE-BAT': 'battery',
};

/** English product names (brand names, not translated). */
export const PRODUCT_NAMES = {
  'HWE-P1': 'P1 Meter',
  'HWE-SKT': 'Energy Socket',
  'HWE-KWH1': 'kWh Meter',
  'SDM230-wifi': 'kWh Meter',
  'HWE-KWH3': 'kWh Meter 3-phase',
  'SDM630-wifi': 'kWh Meter 3-phase',
  'HWE-WTR': 'Watermeter',
  'HWE-BAT': 'Plug-In Battery',
};

export const familyOf = (productType) => FAMILIES[productType] ?? null;

/** The kWh meters and the plug-in battery have no status light to blink in v1. */
export function canIdentify(productType, version) {
  const family = familyOf(productType);
  if (family === 'kwh' || family === 'kwh3') {
    return version === 2;
  }
  return family !== null;
}

/** Serial (also the MAC address): 12 hexadecimal characters, lower case. */
export function normalizeSerial(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const serial = value.trim().toLowerCase().replace(/[:-]/g, '');
  return /^[0-9a-f]{12}$/.test(serial) ? serial : null;
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// v1 name -> v2 name, for the values the integration reads.
const V1_NAMES = {
  active_tariff: 'tariff',
  total_power_import_kwh: 'energy_import_kwh',
  total_power_import_t1_kwh: 'energy_import_t1_kwh',
  total_power_import_t2_kwh: 'energy_import_t2_kwh',
  total_power_import_t3_kwh: 'energy_import_t3_kwh',
  total_power_import_t4_kwh: 'energy_import_t4_kwh',
  total_power_export_kwh: 'energy_export_kwh',
  total_power_export_t1_kwh: 'energy_export_t1_kwh',
  total_power_export_t2_kwh: 'energy_export_t2_kwh',
  total_power_export_t3_kwh: 'energy_export_t3_kwh',
  total_power_export_t4_kwh: 'energy_export_t4_kwh',
  active_power_w: 'power_w',
  active_power_l1_w: 'power_l1_w',
  active_power_l2_w: 'power_l2_w',
  active_power_l3_w: 'power_l3_w',
  active_voltage_v: 'voltage_v',
  active_voltage_l1_v: 'voltage_l1_v',
  active_voltage_l2_v: 'voltage_l2_v',
  active_voltage_l3_v: 'voltage_l3_v',
  active_current_a: 'current_a',
  active_current_l1_a: 'current_l1_a',
  active_current_l2_a: 'current_l2_a',
  active_current_l3_a: 'current_l3_a',
  active_liter_lpm: 'active_liter_lpm',
  total_liter_m3: 'total_liter_m3',
  state_of_charge_pct: 'state_of_charge_pct',
  cycles: 'cycles',
  wifi_strength: 'wifi_strength',
};

const V2_NAMES = Object.values(V1_NAMES);

export const TARIFFS = [1, 2, 3, 4];

/**
 * A measurement in the v2 names, numbers only (null when absent), plus the
 * external meters of a P1 Meter (`external`: gas, water... read on the smart
 * meter's M-Bus) and the legacy gas reading of older P1 firmware.
 * @param {object} raw answer of /api/v1/data or /api/measurement
 */
export function normalizeMeasurement(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const isV1 = 'wifi_ssid' in source || 'total_power_import_t1_kwh' in source;
  const out = {};
  if (isV1) {
    for (const [v1, v2] of Object.entries(V1_NAMES)) {
      out[v2] = finite(source[v1]);
    }
  } else {
    for (const name of V2_NAMES) {
      out[name] = finite(source[name]);
    }
  }
  // Older P1 firmware gives the tariffs without their total.
  for (const direction of ['import', 'export']) {
    const total = `energy_${direction}_kwh`;
    if (out[total] === null) {
      const parts = TARIFFS.map((t) => out[`energy_${direction}_t${t}_kwh`]).filter(
        (value) => value !== null,
      );
      out[total] =
        parts.length > 0
          ? round(
              parts.reduce((a, b) => a + b, 0),
              3,
            )
          : null;
    }
  }
  if (!TARIFFS.includes(out.tariff)) {
    out.tariff = null;
  }
  out.external = parseExternal(source.external);
  // P1 firmware before the `external` list: one gas meter, `total_gas_m3`.
  if (
    !out.external.some((meter) => meter.type === 'gas_meter') &&
    finite(source.total_gas_m3) !== null
  ) {
    out.external.push({ type: 'gas_meter', unit: 'm3', value: source.total_gas_m3 });
  }
  return out;
}

function parseExternal(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .filter((meter) => meter && typeof meter.type === 'string' && finite(meter.value) !== null)
    .map((meter) => ({
      type: meter.type,
      unit: typeof meter.unit === 'string' ? meter.unit : null,
      value: meter.value,
    }));
}

/** The first external meter of a type measured in m³, or null. */
export function externalValue(measurement, type) {
  const meter = measurement.external?.find(
    (entry) => entry.type === type && (entry.unit === null || entry.unit.toLowerCase() === 'm3'),
  );
  return meter ? meter.value : null;
}

/** The phases a measurement reports (`l1`, `l2`, `l3` with a value). */
export function phasesOf(measurement, prefix, suffix) {
  return ['l1', 'l2', 'l3'].filter((phase) => measurement[`${prefix}_${phase}_${suffix}`] !== null);
}

/** Wi-Fi strength in percent from a v2 RSSI (dBm), the usual linear scale. */
export function rssiToPercent(rssi) {
  if (finite(rssi) === null) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(2 * (rssi + 100))));
}

export function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
