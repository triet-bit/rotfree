// Focus mode: the window shrinks to a single task, a progress ring and a scratch note.
import { api, save } from './store.js';
import { settings } from './settings.js';
import { track } from './metrics.js';
import { ask } from './ui.js';

const PRESETS = [25, 45, 60];
const RING_R = 88;
const RING_C = 2 * Math.PI * RING_R;

let session = null; // the running focus session, if any

export const isFocusing = () => !!session;

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Soft two-note chime; silent if audio is unavailable. */
function chime() {
  try {
    const ctx = new AudioContext();
    [659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.22;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.14, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1);
    });
    setTimeout(() => ctx.close(), 1800);
  } catch {
    /* no audio device */
  }
}

/**
 * Start a focus session on `task`. `onDone()` marks the task finished, `onChange()` re-renders
 * the task list after focus time / notes were added.
 */
export function startFocus({ task, onDone, onChange }) {
  if (session) return;
  const app = document.getElementById('app');
  const layer = document.getElementById('focus-layer');
  const minutes0 = settings().focusMinutes;

  const s = (session = {
    task,
    phase: 'setup', // setup | run | ask | break
    minutes: minutes0,
    total: 0, // ms of the current block
    endAt: 0,
    remaining: 0, // ms left while paused
    paused: false,
    counted: 0, // ms of focus already credited to the task / stats
    runSince: 0, // when the current running stretch began
    baseNotes: task.notes || '',
    note: '',
    timer: 0,
  });

  document.body.classList.add('focusing');
  api.setFocus(true);

  // ----- bookkeeping -----

  /** Credit focus time that elapsed since the last checkpoint. */
  function credit() {
    if (!s.runSince) return;
    const ms = Math.max(0, Date.now() - s.runSince);
    s.runSince = s.paused ? 0 : Date.now();
    task.focusMs = (task.focusMs || 0) + ms;
    s.counted += ms;
    track('focusMs', ms);
  }

  function countSession() {
    if (s.sessionCounted || s.counted <= 0) return;
    s.sessionCounted = true;
    track('sessions');
  }

  function writeNote() {
    const text = s.note.trim();
    task.notes = text
      ? `${s.baseNotes}${s.baseNotes ? '\n\n' : ''}• ${new Date(s.startedAt || Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} focus — ${text}`
      : s.baseNotes;
    save();
  }

  function finishSession(quit) {
    credit();
    clearInterval(s.timer);
    countSession();
    if (quit && s.counted > 0) track('quits');
    session = null;
    document.removeEventListener('keydown', s.onKey);
    document.body.classList.remove('focusing');
    layer.innerHTML = '';
    layer.dataset.phase = '';
    api.setFocus(false);
    onChange?.();
    save();
  }

  function startBlock(ms) {
    s.phase = 'run';
    s.total = ms;
    s.endAt = Date.now() + ms;
    s.paused = false;
    s.runSince = Date.now();
    s.startedAt ??= Date.now();
    clearInterval(s.timer);
    s.timer = setInterval(tick, 250);
    render();
  }

  function tick() {
    const left = s.paused ? s.remaining : s.endAt - Date.now();
    paint(left);
    // Checkpoint regularly so a crash or quit mid-session doesn't lose the time.
    if (s.phase === 'run' && !s.paused && Date.now() - s.runSince > 15000) credit();
    if (!s.paused && left <= 0) {
      clearInterval(s.timer);
      if (s.phase === 'break') {
        chime();
        s.phase = 'setup';
        render();
      } else {
        credit();
        countSession();
        chime();
        s.phase = 'ask';
        s.runSince = 0;
        render();
        api.notify('Hết giờ focus', `“${task.title}” — task này xong chưa?`);
      }
    }
  }

  function togglePause() {
    if (s.paused) {
      s.paused = false;
      s.endAt = Date.now() + s.remaining;
      s.runSince = Date.now();
    } else {
      credit();
      s.remaining = Math.max(0, s.endAt - Date.now());
      s.paused = true;
      s.runSince = 0;
    }
    render();
  }

  async function endEarly() {
    if (s.phase !== 'run') return finishSession(false);
    const wasPaused = s.paused;
    const choice = await ask({
      title: 'Thoát focus giữa chừng?',
      message: 'Bạn mới focus được một phần. Thêm chút nữa nhé?',
      actions: [
        { label: 'Thoát', value: 'quit', kind: 'danger' },
        { label: 'Tiếp tục focus', value: 'stay', kind: 'primary' },
      ],
    });
    if (choice === 'quit') {
      writeNote();
      finishSession(s.phase === 'run');
    } else if (!wasPaused) tick();
  }

  // ----- view -----

  const ring = (cls = '') => `
    <div class="ring ${cls}">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle class="ring-track" cx="100" cy="100" r="${RING_R}" />
        <circle class="ring-bar" cx="100" cy="100" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="0" />
      </svg>
      <div class="ring-text"><b class="ring-time"></b><span class="ring-sub"></span></div>
    </div>`;

  function paint(left = s.paused ? s.remaining : s.endAt - Date.now()) {
    const time = layer.querySelector('.ring-time');
    if (!time) return;
    if (s.phase === 'setup') {
      time.textContent = fmt(s.minutes * 60000);
      layer.querySelector('.ring-bar').style.strokeDashoffset = 0;
      return;
    }
    time.textContent = fmt(left);
    const frac = s.total ? Math.min(1, Math.max(0, 1 - left / s.total)) : 0;
    layer.querySelector('.ring-bar').style.strokeDashoffset = RING_C * frac;
  }

  function render() {
    layer.dataset.phase = s.phase;
    const title = `<h1 class="focus-title"></h1>`;
    if (s.phase === 'setup') {
      layer.innerHTML = `
        ${title}
        ${ring()}
        <div class="focus-presets" role="radiogroup" aria-label="Thời lượng">
          ${PRESETS.map((m) => `<button class="preset${m === s.minutes ? ' on' : ''}" data-m="${m}">${m}′</button>`).join('')}
          <label class="preset custom${PRESETS.includes(s.minutes) ? '' : ' on'}"><input type="number" min="1" max="240" inputmode="numeric" placeholder="…" value="${PRESETS.includes(s.minutes) ? '' : s.minutes}" /><span>phút</span></label>
        </div>
        <div class="focus-actions">
          <button class="btn" data-act="cancel">Hủy</button>
          <button class="btn primary" data-act="go">Bắt đầu</button>
        </div>`;
    } else if (s.phase === 'ask') {
      layer.innerHTML = `
        ${title}
        <div class="focus-done">
          <div class="focus-done-emoji">⏰</div>
          <h2>Task này xong chưa?</h2>
          <p>Bạn vừa focus ${Math.round(s.total / 60000)} phút.</p>
        </div>
        <div class="focus-actions col">
          <button class="btn primary" data-act="finished">Xong</button>
          <button class="btn" data-act="more">Thêm 10 phút</button>
          <button class="btn" data-act="rest">Nghỉ 5 phút</button>
        </div>
        ${noteBox()}`;
    } else {
      const brk = isBreak();
      layer.innerHTML = `
        ${title}
        ${ring(brk ? 'rest' : '')}
        <div class="focus-actions">
          ${
            brk
              ? '<button class="btn" data-act="skip-break">Bỏ qua nghỉ</button>'
              : `<button class="btn" data-act="pause">${s.paused ? 'Tiếp tục' : 'Tạm dừng'}</button><button class="btn danger-soft" data-act="end">Kết thúc</button>`
          }
        </div>
        ${brk ? '' : noteBox()}`;
      layer.querySelector('.ring-sub').textContent = brk ? 'Nghỉ ngơi' : s.paused ? 'Đang tạm dừng' : 'Tập trung';
    }
    layer.querySelector('.focus-title').textContent = isBreak() ? 'Nghỉ một chút' : task.title;
    layer.classList.toggle('paused', s.paused);
    paint();
  }

  const isBreak = () => s.phase === 'break';

  function noteBox() {
    return `<textarea class="focus-note" rows="2" spellcheck="false" placeholder="Ghi nhanh ý nghĩ, đừng để nó kéo bạn đi chỗ khác…">${s.note.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</textarea>`;
  }

  // ----- events (delegated; the layer's innerHTML is rebuilt per phase) -----

  layer.onclick = (e) => {
    const preset = e.target.closest('.preset[data-m]');
    if (preset) {
      s.minutes = Number(preset.dataset.m);
      return render();
    }
    switch (e.target.closest('[data-act]')?.dataset.act) {
      case 'go':
        startBlock(s.minutes * 60000);
        break;
      case 'cancel':
        finishSession(false);
        break;
      case 'pause':
        togglePause();
        break;
      case 'end':
        endEarly();
        break;
      case 'more':
        startBlock(10 * 60000);
        break;
      case 'rest':
        writeNote();
        s.phase = 'break';
        s.total = 5 * 60000;
        s.endAt = Date.now() + s.total;
        s.paused = false;
        s.timer = setInterval(tick, 250);
        render();
        break;
      case 'skip-break':
        clearInterval(s.timer);
        s.phase = 'setup';
        render();
        break;
      case 'finished':
        writeNote();
        finishSession(false);
        onDone?.();
        break;
    }
  };

  layer.oninput = (e) => {
    if (e.target.matches('.focus-note')) {
      s.note = e.target.value;
      writeNote();
    } else if (e.target.matches('.custom input')) {
      const v = Math.max(1, Math.min(240, Number(e.target.value) || 0));
      s.minutes = v || s.minutes;
      layer.querySelectorAll('.preset[data-m]').forEach((b) => b.classList.remove('on'));
      e.target.closest('.custom').classList.add('on');
      paint();
    }
  };

  layer.onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.matches('.custom input')) {
      e.preventDefault();
      startBlock(s.minutes * 60000);
    }
  };

  s.onKey = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.sheet-backdrop')) {
      e.preventDefault();
      endEarly();
    }
  };
  document.addEventListener('keydown', s.onKey);
  render();
}
