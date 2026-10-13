# HomeWizard Energy for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for the
[HomeWizard Energy](https://www.homewizard.com) devices, read over the local
network through the official HomeWizard local API (v1 and v2): the **P1
Meter** (DSMR smart meters of the Netherlands, Belgium, Luxembourg…), the
**Energy Socket**, the **kWh meters** (HWE-KWH1, HWE-KWH3, Eastron SDM230 and
SDM630), the **Watermeter** and the **Plug-In Battery**. No account, no cloud.

> **Developed without the hardware: feedback welcome.** Built and tested
> against the real device answers recorded by python-homewizard-energy and
> Home Assistant, and against simulated devices; not against a real meter.
> Please report what works and what does not on the
> [Gladys forum](https://community.gladysassistant.com) or in the
> [issues](https://github.com/guim31/gladys-homewizard/issues).

## Features

- One Gladys device per HomeWizard device, found automatically on the local
  network through Gladys (mDNS `_hwenergy._tcp` and `_homewizard._tcp`), or by
  IP address, keyed on its serial number (its MAC address).
- **P1 Meter**: imported and exported power, import and export indexes
  (total and per tariff), voltage and current per phase, gas and water meters
  connected to the smart meter, Wi-Fi signal.
- **Energy Socket**: on/off, power, energy index, voltage and current, switch
  lock, LED brightness.
- **kWh meters**: power (signed, per phase on three-phase meters), import and
  export indexes, voltage and current.
- **Watermeter**: flow and total. **Plug-In Battery**: level, charge and
  discharge power and energy, cycles.
- Ready for the **energy tab of Gladys**: the import index of a P1 Meter or a
  kWh meter and the energy of a socket are the indexes Gladys turns into
  consumption and cost; the export index of a kWh meter counts as production;
  the grid exchange of a P1 Meter uses the `grid-sensor` category.
- **API v1 and v2**: v1 (HTTP, turned on in the HomeWizard Energy app) works
  at once; v2 (HTTPS) is paired from the configuration screen by pressing the
  button of the device, its certificate is checked against the HomeWizard CA
  and the device name before any token is sent.
- **"Live energy" dashboard widget**: the grid exchange as a signed gauge,
  import and export live, and with a solar kWh meter, the production and the
  house consumption.
- **Scene triggers**: "Home exports more than…" and "Home draws more than…",
  thresholds from 100 W to 8 kW, fired once per crossing.
- **Scene actions**: turn an Energy Socket on or off, blink a device.
- Four languages (English, French, German, Spanish).

## Requirements

- Gladys Assistant 5.1.0 or later.
- HomeWizard devices on the same network as Gladys, with the **local API**
  turned on in the HomeWizard Energy app (API v1), or paired with their button
  (API v2: P1 Meter, kWh meters and Plug-In Battery with a recent firmware).

## Installation

In Gladys: **Integrations** → **Install from GitHub**, with the address of
this repository: `https://github.com/guim31/gladys-homewizard`. Then open the
**Discovery** tab of the integration. The [documentation](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)) explains
the setup, the pairing, the features, the widget and the scenes.

## How it works

- **API v1**: `GET /api` (model, serial, firmware), `GET /api/v1/data` (the
  measurement), `GET`/`PUT /api/v1/state` (Energy Socket), `PUT
/api/v1/identify`. Plain HTTP on port 80, no authentication: the user turns
  it on per device in the app; a disabled API answers 403.
- **API v2**: HTTPS on port 443, `Authorization: Bearer` and `X-Api-Version:
2`. `POST /api/user` answers 403 until the button of the device is pressed,
  then a token for 30 seconds; the integration asks every 2 seconds during a
  75-second window. `GET /api/measurement`, `GET /api/system` (Wi-Fi), `PUT
/api/system/identify`. The certificate must chain to the HomeWizard CA
  (shipped in `src/homewizard/cacert.js`) and name the expected device
  (`appliance/<type>/<serial>`); otherwise the token is not sent.
- The integration runs in an isolated container on a Docker bridge, where mDNS
  never arrives: the **mDNS browse** is done by the Gladys core (mediated
  discovery, both services declared in the manifest), the integration reads
  the records it relays. The devices are then reached in unicast.
- **Polling**: each device is read at the configured interval (10 s by
  default, `should_poll: false` for Gladys), one request at a time per
  device. Only the values that changed are sent; indexes, voltages, currents,
  gas and water at most once a minute, an unchanged value every 30 minutes.
- A device that misses three readings in a row is _unreachable_ (badge,
  connection status, widget); its values stay.
- The devices seen, their v2 tokens and their features are kept in
  `/data/homewizard-state.json` (mode 600), so they are known at once after a
  restart.

## Checked, and what was not

Checked:

- every model of the fixtures (P1 Meter v1 three-phase with gas and water,
  single-phase, four tariffs, v2; Energy Socket old and new; kWh meters 1 and
  3 phases v1 and v2, SDM230, SDM630; Watermeter; Plug-In Battery) against
  the rules of the Gladys core (feature couples, bounds, units, poll
  frequencies) in the four languages;
- the whole integration against the fake Gladys of the SDK and fake
  HomeWizard devices (real HTTP and HTTPS servers, v2 pairing, refused
  certificates, revoked token, unreachable device);
- the Docker image in the Gladys sandbox constraints (read-only root
  filesystem, no capabilities, 256 MB), against a simulated HomeWizard P1
  Meter (v1 and v2) in another container on a Docker bridge network.

Not checked, for want of hardware or of a Gladys instance:

- a real device: the certificate of a real v2 device against the HomeWizard
  CA, the pairing with a real button, a real Energy Socket switching;
- the mDNS browse through a real Gladys core on a real LAN;
- the rendering of the widget and of the scene cards in the Gladys interface,
  and the energy tab computing from these indexes.

## Limitations

- Polling only: powers are as fresh as the refresh interval (2 s to 1 min).
- Battery modes, cloud settings and the Energy Display are not supported.
- The Energy Socket and the Watermeter are read through the API v1 (their v2
  is still in development at HomeWizard). The Watermeter answers on USB
  power only.
- One gas meter and one water meter per P1 Meter; heat meters are not read.
- Host names ending in `.local` cannot be resolved from the container: use IP
  addresses.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

`tools/fake-homewizard.mjs` is a simulated HomeWizard device (API v1 over
HTTP, API v2 over HTTPS with a test certificate and a button to press), used
by the tests and to try the integration without the hardware (see
[CLAUDE.md](CLAUDE.md)). The certificates of `test/fixtures/tls` are test
certificates, trusted by the tests only.

## Credits

- [python-homewizard-energy](https://github.com/homewizard/python-homewizard-energy)
  (Apache License 2.0, © HomeWizard B.V. and contributors): the v1/v2 value
  mapping, the HomeWizard CA certificate, and the real device answers used as
  test fixtures.
- The [Home Assistant HomeWizard integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/homewizard)
  (Apache License 2.0): the discovery, pairing and polling choices, and test
  answers (P1 Meter with four tariffs, recent Energy Socket, SDM230).
- The [HomeWizard local API documentation](https://api-documentation.homewizard.com).
- Cover: the HomeWizard logo from [homewizard.com](https://www.homewizard.com) (wordmark in white),
  on the navy of the brand.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## Disclaimer

This project is not affiliated with, endorsed by or connected to HomeWizard
B.V. HomeWizard is a trademark of HomeWizard B.V.

## License

[Apache License 2.0](LICENSE).
