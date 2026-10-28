// Stats sheet: how often you switched, how long you focused. Screen Time–style bars, no scoring.
import { state, dayKey, addDays, parseDayKey } from './store.js';
import { el, openSheet, icons } from './ui.js';
import { dayMetrics, switches } from './metrics.js';

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function doneOn(day) {
  const ids = new Set();
  for (const [key, list] of Object.entries(state.days)) {
    for (const t of list) {
      if (t.done && (key === day || (t.doneAt && dayKey(new Date(t.doneAt)) === day))) ids.add(t.id);
    }
  }
  return ids.size;
}

const minutes = (ms) => Math.round(ms / 60000);
const unitFocus = (ms) => {
  const m = minutes(ms);
  return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`;
};

function insight() {
  const today = switches(dayMetrics(dayKey()));
  const prev = switches(dayMetrics(addDays(dayKey(), -1)));
  if (!prev) return today ? `Hôm nay bạn đã chuyển việc ${today} lần.` : 'Hôm nay bạn chưa chuyển việc lần nào.';
  if (today === prev) return 'Hôm nay bạn chuyển việc bằng hôm qua.';
  const pct = Math.round((Math.abs(today - prev) / prev) * 100);
  return `Hôm nay bạn chuyển việc ${today < prev ? 'ít' : 'nhiều'} hơn hôm qua ${pct}%.`;
}

/** Round the axis maximum up to a tidy number so the grid labels read nicely. */
function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 4, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}

function chart({ days, values, color, format, unit }) {
  const max = niceMax(Math.max(...values, 0));
  const rows = [max, max / 2, 0];
  const every = days.length > 10 ? 5 : 1;
  const bars = days
    .map((d, i) => {
      const dow = parseDayKey(d).getDay();
      return `<button class="bar${i === days.length - 1 ? ' today' : ''}${values[i] ? '' : ' zero'}" style="--h:${(values[i] / max) * 100}%" data-i="${i}" aria-label="${d}: ${format(values[i])}"><i></i></button>`;
    })
    .join('');
  const labels = days
    .map((d, i) => {
      const dt = parseDayKey(d);
      const show = (days.length - 1 - i) % every === 0;
      const text = days.length > 10 ? dt.getDate() : WEEKDAYS[dt.getDay()];
      return `<span class="${show ? '' : 'faint'}">${show ? text : ''}</span>`;
    })
    .join('');
  return `
    <div class="chart" style="--n:${days.length};--c:var(--${color})">
      <div class="plot">
        <div class="grid">${rows.map((r) => `<div><span>${format(r, true)}</span></div>`).join('')}</div>
        <div class="bars">${bars}</div>
      </div>
      <div class="xlabels">${labels}</div>
    </div>`;
}

export function initStats(button) {
  function open() {
    let range = 7;

    openSheet(
      (close, sheet) => {
        const root = el('div', { class: 'stats' });

        const draw = () => {
          const days = Array.from({ length: range }, (_, i) => addDays(dayKey(), i - (range - 1)));
          const ms = days.map((d) => dayMetrics(d));
          const focus = ms.map((m) => minutes(m.focusMs));
          const sw = ms.map((m) => switches(m));
          const t = dayMetrics(dayKey());
          const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);

          root.innerHTML = `
            <header class="stats-head">
              <h2>Thống kê</h2>
              <div class="seg-mini" role="tablist">
                <button data-r="7" aria-selected="${range === 7}">7 ngày</button>
                <button data-r="30" aria-selected="${range === 30}">30 ngày</button>
              </div>
              <button class="icon-btn" data-act="close" title="Đóng" aria-label="Đóng">${icons.close}</button>
            </header>
            <div class="stats-body">
              <section class="tiles">
                <div class="tile"><span class="tile-label">Focus hôm nay</span><b>${minutes(t.focusMs)}<small> phút</small></b><em>${t.sessions} phiên${t.quits ? ` · thoát giữa chừng ${t.quits}` : ''}</em></div>
                <div class="tile"><span class="tile-label">Chuyển việc</span><b>${switches(t)}<small> lần</small></b><em>note ${t.switchNote} · task ${t.switchTask} · chế độ ${t.switchView}</em></div>
                <div class="tile"><span class="tile-label">Task hoàn thành</span><b>${doneOn(dayKey())}</b><em>hôm nay</em></div>
              </section>
              <p class="insight">${insight()}</p>
              <section class="chart-card">
                <div class="chart-head"><span>Thời gian focus</span><b class="readout" data-k="focus">TB ${avg(focus)} phút/ngày</b></div>
                ${chart({ days, values: focus, color: 'blue', format: (v, axis) => (axis ? `${v}′` : `${v} phút`) })}
              </section>
              <section class="chart-card">
                <div class="chart-head"><span>Số lần chuyển việc</span><b class="readout" data-k="switch">TB ${avg(sw)} lần/ngày</b></div>
                ${chart({ days, values: sw, color: 'orange', format: (v, axis) => (axis ? `${v}` : `${v} lần`) })}
              </section>
              <p class="stats-foot">Dữ liệu chỉ lưu trên máy này. Không chấm điểm — chỉ để bạn tự nhìn lại.</p>
            </div>`;

          // Tap / hover a bar to read its value; leave to go back to the average.
          const wire = (selector, values, fmt, avgText) => {
            const card = root.querySelector(selector).closest('.chart-card');
            const readout = card.querySelector('.readout');
            card.querySelectorAll('.bar').forEach((bar) => {
              const show = () => {
                const i = Number(bar.dataset.i);
                const d = parseDayKey(days[i]);
                readout.textContent = `${d.getDate()}/${d.getMonth() + 1} · ${fmt(values[i])}`;
                card.querySelectorAll('.bar').forEach((b) => b.classList.toggle('sel', b === bar));
              };
              bar.addEventListener('mouseenter', show);
              bar.addEventListener('focus', show);
              bar.addEventListener('mouseleave', () => {
                readout.textContent = avgText;
                bar.classList.remove('sel');
              });
            });
          };
          wire('[data-k="focus"]', focus, (v) => `${v} phút`, `TB ${avg(focus)} phút/ngày`);
          wire('[data-k="switch"]', sw, (v) => `${v} lần`, `TB ${avg(sw)} lần/ngày`);
        };

        root.addEventListener('click', (e) => {
          const r = e.target.closest('[data-r]');
          if (r) {
            range = Number(r.dataset.r);
            draw();
          }
          if (e.target.closest('[data-act="close"]')) close('close');
        });
        draw();
        return root;
      },
      { className: 'sheet-opaque sheet-stats' },
    );
  }
  button.addEventListener('click', open);
  return { open };
}
