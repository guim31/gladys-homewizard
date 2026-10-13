# HomeWizard fixtures

Real answers of HomeWizard devices, as recorded by:

- [python-homewizard-energy](https://github.com/homewizard/python-homewizard-energy)
  (Apache License 2.0, © HomeWizard B.V. and contributors), `tests/v1/fixtures`
  and `tests/v2/fixtures`: every model except the three below;
- the [Home Assistant HomeWizard integration](https://github.com/home-assistant/core/tree/dev/tests/components/homewizard/fixtures)
  (Apache License 2.0): `v1/HWE-P1-four-tariffs` (HA `HWE-P1`), `v1/HWE-SKT-21`
  and `v1/SDM230-wifi` (`data.json`).

Copied as they are (re-indented). The serial numbers, SSIDs and meter ids in
them are already placeholders; the fake device (`tools/fake-homewizard.mjs`)
answers with the serial each test gives it.

`v1/<model>/`: `device.json` (`GET /api`), `data.json` (`GET /api/v1/data`),
`state.json` (`GET /api/v1/state`, Energy Socket). `v2/<model>/`:
`device.json`, `measurement.json` (`GET /api/measurement`), `system.json`
(`GET /api/system`).
