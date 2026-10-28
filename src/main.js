import '@fontsource-variable/inter';
import './styles.css';
import { api, state, flush, onSaveStatus } from './store.js';
import { initSettings, settings, onSetting } from './settings.js';
import { track } from './metrics.js';
import { icons } from './ui.js';
import { initRecall } from './recall.js';
import { initReview } from './review.js';
import { initStats } from './stats.js';
import { initSettingsView } from './settings-view.js';
import { isFocusing } from './focus.js';
import { createStrip } from './strip.js';
import { initTasks } from './tasks.js';
import { initNotes } from './notes.js';
import { sampleData } from './sample.js';

const $ = (id) => document.getElementById(id);
const app = $('app');

// ---------- clock ----------

function tickClock() {
  const now = new Date();
  $('clock-time').textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  $('clock-date').textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  $('status-clock').textContent = `${$('clock-time').textContent} · ${$('clock-date').textContent}`;
}

// ---------- view mode ----------

const PANELS = { split: ['panel-tasks', 'panel-notes'], tasks: ['panel-tasks'], notes: ['panel-notes'] };
const seg = $('mode-switch');
const thumb = seg.querySelector('.segmented-thumb');

function placeThumb() {
  const active = seg.querySelector(`button[data-mode="${app.dataset.mode}"]`);
  thumb.style.setProperty('--x', `${active.offsetLeft}px`);
  thumb.style.setProperty('--w', `${active.offsetWidth}px`);
  seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b === active));
}

function setMode(mode, { persist = true } = {}) {
  const prev = app.dataset.mode;
  if (prev === mode && persist) return;
  if (isFocusing()) return;
  app.dataset.mode = mode;
  if (prev !== mode) track('switchView');
  placeThumb();
  // Animate whichever panel just appeared.
  const appear = PANELS[mode].filter((id) => !PANELS[prev]?.includes(id));
  for (const id of appear) {
    const p = $(id);
    p.classList.remove('entering');
    void p.offsetWidth;
    p.classList.add('entering');
  }
  if (persist) api.setMode(mode);
}

// ---------- save indicator ----------

function initSaveState() {
  const box = $('save-state');
  const label = box.querySelector('span');
  onSaveStatus((s) => {
    box.dataset.state = s;
    label.textContent = { saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[s];
  });
}

// ---------- boot ----------

async function boot() {
  const loaded = await api.load();
  Object.assign(state, loaded.data ?? sampleData());
  state.recentEmoji ??= [];
  state.days ??= {};
  state.notes ??= [];
  state.recalls ??= {};
  state.cards ??= {};
  state.metrics ??= {};
  initSettings();
  const applySettings = () => {
    document.body.classList.toggle('no-srs', !settings().srsEnabled);
    $('btn-stats').hidden = !settings().statsEnabled;
  };
  applySettings();
  onSetting(applySettings);

  tickClock();
  setInterval(tickClock, 1000);

  app.dataset.mode = loaded.mode || 'split';
  requestAnimationFrame(placeThumb);
  new ResizeObserver(placeThumb).observe(seg);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b) setMode(b.dataset.mode);
  });

  $('btn-close').addEventListener('click', async () => {
    await flush();
    api.hide();
  });
  $('btn-min').addEventListener('click', () => api.minimize());

  const onTop = $('btn-ontop');
  const showOnTop = (on) => {
    onTop.classList.toggle('on', on);
    onTop.setAttribute('aria-pressed', on);
  };
  showOnTop(!!loaded.alwaysOnTop);
  onTop.addEventListener('click', async () => showOnTop(await api.toggleOnTop()));
  api.onOnTop(showOnTop);

  initSaveState();

  let tasks;
  let notes;
  let recall;
  const taskStrip = createStrip($('task-strip'), $('task-dots'), {
    onIndexChange: () => tasks?.onIndexChange(),
    onSwitch: () => track('switchTask'),
  });
  tasks = initTasks(taskStrip, $('btn-today'), { openRecall: (day) => recall?.open(day) });

  const noteStrip = createStrip($('note-strip'), $('note-dots'), { onSwitch: () => track('switchNote') });

  // Review is created first so the cards synced while the notes load update its badge.
  $('btn-review').querySelector('.tool-icon').innerHTML = icons.cards;
  $('btn-stats').innerHTML = icons.chart;
  $('btn-settings').innerHTML = icons.gear;
  initReview({
    button: $('btn-review'),
    openNote: (noteId, cid) => {
      if (app.dataset.mode === 'tasks') setMode('notes');
      notes.openNote(noteId, cid);
    },
    setCue: (noteId, cid, cue) => notes.setCue(noteId, cid, cue),
  });
  notes = initNotes(noteStrip, $('btn-add-note'));

  recall = initRecall({ noteTitle: (n) => notes.noteTitle(n), refreshTasks: () => tasks.refresh() });
  initStats($('btn-stats'));
  initSettingsView($('btn-settings'), { alwaysOnTop: !!loaded.alwaysOnTop, launchAtLogin: !!loaded.launchAtLogin });

  if (!loaded.data) flush(); // persist the sample workspace on first run

  api.onFlush(flush);
  window.addEventListener('beforeunload', () => flush());
  document.addEventListener('keydown', (e) => {
    if (isFocusing()) return; // view-switching shortcuts are locked while focusing
    // Ctrl+1/2/3 switch views; Ctrl+N new note.
    if (e.ctrlKey && !e.shiftKey && !e.altKey && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      setMode(['split', 'tasks', 'notes'][Number(e.key) - 1]);
    }
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      if (app.dataset.mode === 'tasks') setMode('split');
      $('btn-add-note').click();
    }
  });

  requestAnimationFrame(() => document.body.classList.add('ready'));
}

boot();
