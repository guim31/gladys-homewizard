// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// Switching an Energy Socket is also possible on its Gladys switch feature;
// these actions say it in one card, report the state the socket answered, and
// explain a refusal (switch lock on). `identify_device` blinks the status
// light of a device, to find it among identical ones.
//
// The triggers (grid power crossing a step) are fired by the hub on the P1
// readings, never by these actions.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async turn_on_socket(hub, { fields }) {
    return { power_on: await hub.switchSocket(fields.device, true) };
  },

  async turn_off_socket(hub, { fields }) {
    return { power_on: await hub.switchSocket(fields.device, false) };
  },

  async identify_device(hub, { fields }) {
    return { identified: await hub.identify(fields.device) };
  },
};
