// User-tweakable options for the focus / anti-"brain rot" features. Lives in workspace.json
// (state.settings) so it syncs with the rest of the data; always-on-top and launch-at-login
// are owned by the main process and are handled in the Settings sheet via `api`.
import { state, save } from './store.js';

export const DEFAULTS = {
  focusEnabled: true,
  focusMinutes: 25,
  wipEnabled: true,
  wipLimit: 1,
  thinkEnabled: true,
  recallEnabled: true,
  recallTime: '21:00',
  srsEnabled: true,
  statsEnabled: true,
  pasteEnabled: true,
  pasteWords: 80,
};

const listeners = new Set();

export function initSettings() {
  state.settings = { ...DEFAULTS, ...(state.settings ?? {}) };
}

export const settings = () => state.settings;

export function setSetting(key, value) {
  if (state.settings[key] === value) return;
  state.settings[key] = value;
  save();
  listeners.forEach((fn) => fn(key, value));
}

/** Subscribe to changes: fn(key, value). */
export function onSetting(fn) {
  listeners.add(fn);
}
