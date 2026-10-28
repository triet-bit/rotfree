// End-of-day recall: write what you remember first, only then compare with what actually happened.
import { state, save, dayKey, parseDayKey } from './store.js';
import { settings, onSetting } from './settings.js';
import { el, openSheet, sheetOpen, escapeHTML } from './ui.js';
import { isFocusing } from './focus.js';
import { api } from './store.js';

const SNOOZE_MS = 30 * 60_000;

const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ');

/** True if the recall text plausibly mentions `title` (a third of its longer words appear). */
export function mentions(recallText, title) {
  const hay = norm(recallText);
  const words = norm(title).split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return hay.includes(norm(title).trim()) && norm(title).trim() !== '';
  return words.filter((w) => hay.includes(w)).length / words.length >= 0.33;
}

const sameDay = (ts, key) => dayKey(new Date(ts)) === key;

export function initRecall({ noteTitle, refreshTasks }) {
  const rs = (state.recallState ??= { day: '', snoozeUntil: 0, draft: '' });

  function factsFor(day) {
    const seen = new Set();
    const tasks = [];
    for (const [key, list] of Object.entries(state.days)) {
      for (const t of list) {
        if (!t.done || seen.has(t.id)) continue;
        if (key === day || (t.doneAt && sameDay(t.doneAt, day))) {
          seen.add(t.id);
          tasks.push(t.title);
        }
      }
    }
    const notes = state.notes
      .filter((n) => sameDay(n.updatedAt, day) || sameDay(n.createdAt, day))
      .map((n) => noteTitle(n))
      .filter(Boolean);
    return { tasks, notes };
  }

  function longDate(day) {
    return parseDayKey(day).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /** Open the Recall screen for `day` (today by default). Shows the saved one read-only if it exists. */
  function open(day = dayKey(), { auto = false } = {}) {
    if (isFocusing()) return;
    const saved = state.recalls[day];
    let finished = !!saved?.text;
    let snooze = auto || day === dayKey();

    openSheet(
      (close, sheet) => {
        const root = el('div', { class: 'recall' });

        const compare = () => {
          const text = state.recalls[day].text;
          const { tasks, notes } = factsFor(day);
          const item = (t) => {
            const hit = mentions(text, t);
            return `<li class="${hit ? 'hit' : 'miss'}"><i></i><span>${escapeHTML(t)}</span>${hit ? '' : '<em>chưa nhắc tới</em>'}</li>`;
          };
          const section = (title, list, empty) =>
            `<h4>${title}</h4>${list.length ? `<ul class="facts">${list.map(item).join('')}</ul>` : `<p class="facts-empty">${empty}</p>`}`;
          const missed = [...tasks, ...notes].filter((t) => !mentions(text, t)).length;
          root.innerHTML = `
            <header><h2>So lại với thực tế</h2><p>${longDate(day)}</p></header>
            <div class="recall-cols">
              <section class="col mine"><h3>Bạn đã viết</h3><div class="mine-text"></div></section>
              <section class="col real">
                <h3>Thực tế trong ngày</h3>
                ${section('Task đã hoàn thành', tasks, 'Chưa có task nào hoàn thành.')}
                ${section('Note trong ngày', notes, 'Không có note nào.')}
              </section>
            </div>
            <footer>
              <span class="recall-hint">${missed ? `${missed} mục bạn chưa nhắc tới — không sao, đó là chỗ để ôn lại.` : 'Bạn đã nhớ lại đủ các mục. Làm tốt lắm.'}</span>
              <button class="btn primary" data-act="done">Xong</button>
            </footer>`;
          root.querySelector('.mine-text').textContent = text;
          root.querySelector('[data-act="done"]').addEventListener('click', () => close('done'));
        };

        const write = () => {
          root.innerHTML = `
            <header><h2>Hôm nay bạn đã làm và học được gì?</h2><p>${longDate(day)} · Tự nhớ lại, chưa xem task hay note nhé.</p></header>
            <textarea class="recall-input" spellcheck="false" placeholder="Viết bằng lời của bạn…"></textarea>
            <footer>
              <button class="btn" data-act="later">Để sau (30 phút)</button>
              <button class="btn primary" data-act="compare" disabled>Đối chiếu</button>
            </footer>`;
          const input = root.querySelector('.recall-input');
          const go = root.querySelector('[data-act="compare"]');
          input.value = rs.draft || '';
          go.disabled = !input.value.trim();
          input.addEventListener('input', () => {
            rs.draft = input.value;
            go.disabled = !input.value.trim();
            save();
          });
          root.querySelector('[data-act="later"]').addEventListener('click', () => close('later'));
          go.addEventListener('click', () => {
            state.recalls[day] = { text: input.value.trim(), at: Date.now() };
            rs.draft = '';
            finished = true;
            save();
            refreshTasks?.();
            compare();
          });
          setTimeout(() => input.focus(), 120);
        };

        if (finished) compare();
        else write();
        return root;
      },
      {
        className: 'sheet-opaque sheet-recall',
        onClose: (reason) => {
          if (!finished && snooze) {
            rs.day = dayKey();
            rs.snoozeUntil = Date.now() + SNOOZE_MS;
            save();
          }
        },
      },
    );
  }

  // ----- scheduler -----

  function due() {
    const s = settings();
    if (!s.recallEnabled) return false;
    const today = dayKey();
    if (state.recalls[today]?.text) return false;
    const [h, m] = s.recallTime.split(':').map(Number);
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return false;
    return !(rs.day === today && rs.snoozeUntil > Date.now());
  }

  function check() {
    if (!due() || sheetOpen() || isFocusing()) return;
    open(dayKey(), { auto: true });
    api.notify('Recall cuối ngày', 'Hôm nay bạn đã làm và học được gì? Thử tự nhớ lại trước khi xem lại ghi chú.');
  }

  setInterval(check, 20_000);
  setTimeout(check, 2500);
  onSetting((key) => {
    if (key === 'recallTime' || key === 'recallEnabled') {
      rs.snoozeUntil = 0;
      check();
    }
  });

  return { open, check };
}
