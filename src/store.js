// App state + debounced persistence. Electron exposes window.api; in a plain browser
// (handy for UI work) we fall back to localStorage so the renderer still runs.

const LS_KEY = 'floating-workspace';

export const api = window.api ?? {
  load: async () => ({ data: JSON.parse(localStorage.getItem(LS_KEY) || 'null'), mode: 'split', alwaysOnTop: false, hotkey: 'Ctrl+Alt+N' }),
  save: async (json) => localStorage.setItem(LS_KEY, json),
  saveImage: async (bytes, ext) => {
    const blob = new Blob([bytes], { type: `image/${ext === 'svg' ? 'svg+xml' : ext}` });
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
  },
  setMode: async (m) => m,
  toggleOnTop: async () => false,
  setFocus: async () => {},
  setLaunchAtLogin: async (on) => on,
  notify: (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
  },
  show: () => {},
  hide: () => {},
  minimize: () => {},
  openExternal: (url) => window.open(url, '_blank'),
  onOnTop: () => {},
  onFlush: () => {},
};

export const state = {
  version: 1,
  days: {}, // 'YYYY-MM-DD' -> Task[]
  notes: [], // Note[]
  recentEmoji: [],
  settings: null, // see settings.js
  recalls: {}, // 'YYYY-MM-DD' -> { text, at }
  recallState: { day: '', snoozeUntil: 0 },
  cards: {}, // callout id -> spaced-repetition card (see review.js)
  metrics: {}, // 'YYYY-MM-DD' -> counters (see metrics.js)
};

const beforeSave = new Set();
const statusListeners = new Set();
let timer = null;
let inFlight = null;
let pending = false;

/** Register a hook that copies live data (e.g. editor JSON) into `state` right before writing. */
export function onBeforeSave(fn) {
  beforeSave.add(fn);
}

export function onSaveStatus(fn) {
  statusListeners.add(fn);
}

function setStatus(s) {
  statusListeners.forEach((fn) => fn(s));
}

export function save() {
  setStatus('saving');
  clearTimeout(timer);
  timer = setTimeout(flush, 450);
}

export async function flush() {
  clearTimeout(timer);
  if (inFlight) {
    pending = true;
    return inFlight;
  }
  beforeSave.forEach((fn) => fn());
  inFlight = api.save(JSON.stringify(state)).then(
    () => setStatus('saved'),
    (err) => {
      console.error('save failed', err);
      setStatus('error');
    },
  );
  await inFlight;
  inFlight = null;
  if (pending) {
    pending = false;
    return flush();
  }
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
