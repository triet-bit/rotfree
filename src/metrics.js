// Silent, local-only counters behind the Stats screen. One record per day.
import { state, save, dayKey } from './store.js';
import { settings } from './settings.js';

const EMPTY = () => ({ focusMs: 0, sessions: 0, quits: 0, switchNote: 0, switchTask: 0, switchView: 0 });

export function dayMetrics(key) {
  return { ...EMPTY(), ...(state.metrics[key] ?? {}) };
}

export const switches = (m) => m.switchNote + m.switchTask + m.switchView;

/** Add `amount` to a counter for today. No-op when stats are turned off. */
export function track(field, amount = 1) {
  if (!settings().statsEnabled) return;
  const key = dayKey();
  const m = (state.metrics[key] ??= EMPTY());
  m[field] = (m[field] || 0) + amount;
  save();
}
