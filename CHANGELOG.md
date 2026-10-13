# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- Quieter logs: a problem that repeats at every reading (a device certificate
  that is not HomeWizard, a discovery the Gladys core refuses, Gladys not
  accepting updates, a data folder that cannot be written) is now logged once,
  then once more when it is solved, instead of every 10 seconds or every 15
  minutes.

## [1.0.0] - 2026-10-13

### Added

- One Gladys device per HomeWizard Energy device on the local network: P1
  Meter, Energy Socket, kWh meters (HWE-KWH1, HWE-KWH3, SDM230, SDM630),
  Watermeter and Plug-In Battery. Found automatically through Gladys (mDNS) or
  by IP address; no account, no cloud.
- P1 Meter: imported and exported power, import and export indexes (total and
  per tariff), voltage and current per phase, gas and water meters, Wi-Fi
  signal. The import index feeds the energy tab of Gladys (consumption and
  cost).
- Energy Socket: on/off, power, energy index, voltage and current, switch
  lock and LED brightness, controllable from Gladys.
- kWh meters: power (per phase on three-phase meters), import index
  (consumption) and export index (production), voltage and current.
  Watermeter: flow and total. Plug-In Battery: level, charge and discharge
  power and energy, cycles.
- Local API v1 and v2: v2 devices are paired from the configuration screen by
  pressing their button; their certificate is checked before any token is
  sent.
- Refresh interval from 2 seconds to 1 minute (10 seconds by default); only
  the values that change are sent, indexes and voltages at most once a
  minute.
- "Live energy" dashboard widget: the grid exchange of a P1 Meter as a gauge,
  import and export live, and with a solar kWh meter, the production and the
  house consumption.
- Scene triggers "Home exports more than…" and "Home draws more than…"
  (thresholds from 100 W to 8 kW), scene actions to turn an Energy Socket on
  or off and to blink a device.
- English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-homewizard/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-homewizard/releases/tag/v1.0.0
