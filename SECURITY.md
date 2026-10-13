# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the tokens of the HomeWizard local API v2, one per paired
  device, obtained by pressing the button of the device. They give read access
  to the device's measurements and control of an Energy Socket. They are
  never logged, never sent to Gladys, and only sent to a device whose HTTPS
  certificate chains to the HomeWizard CA and names that very device. The
  local API v1 has no secret.
- **Stored in `/data`**: `homewizard-state.json` (mode 600), the devices seen
  so far: serial number (the MAC address), model, IP address and ports,
  firmware version, API state, the v2 token, and the list of features shown.
- **Network**: HTTP (port 80, API v1) and HTTPS (port 443, API v2) requests,
  only to the HomeWizard devices of the local network (the addresses found by
  the discovery or typed in the configuration). The mDNS browse is done by the
  Gladys core on the integration's behalf, for the two HomeWizard services
  only (manifest `network_discovery`). The integration opens no listening
  port and calls no cloud service.

Anyone on the local network can read a HomeWizard device whose local API v1
is on, and switch an Energy Socket: this is how the API v1 works, not
something the integration adds. The API v2 needs a token.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the HomeWizard devices, app and cloud, and the other devices of your network.
