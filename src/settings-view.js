// The Settings sheet (gear icon in the title bar).
import { api } from './store.js';
import { settings, setSetting } from './settings.js';
import { el, openSheet, icons, escapeHTML } from './ui.js';

const toggle = (key) => `<button class="switch" role="switch" data-toggle="${key}" aria-checked="${settings()[key]}"><i></i></button>`;
const choice = (key, values, suffix = '') =>
  `<div class="seg-mini" data-choice="${key}">${values.map((v) => `<button data-v="${v}" aria-selected="${settings()[key] === v}">${v}${suffix}</button>`).join('')}</div>`;

const row = (title, desc, control, { sub = false, dep = '' } = {}) => `
  <div class="set-row${sub ? ' sub' : ''}"${dep ? ` data-dep="${dep}"` : ''}>
    <div class="set-text"><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</div>
    <div class="set-ctl">${control}</div>
  </div>`;

export function initSettingsView(button, { alwaysOnTop = false, launchAtLogin = false } = {}) {
  const win = { alwaysOnTop, launchAtLogin };
  api.onOnTop((on) => {
    win.alwaysOnTop = on;
    document.querySelector('[data-toggle="alwaysOnTop"]')?.setAttribute('aria-checked', on);
  });

  function open() {
    openSheet(
      (close) => {
        const s = settings();
        const root = el('div', { class: 'settings' });
        root.innerHTML = `
          <header class="stats-head">
            <h2>Settings</h2>
            <span></span>
            <button class="icon-btn" data-act="close" title="Đóng" aria-label="Đóng">${icons.close}</button>
          </header>
          <div class="settings-body">
            <h4 class="set-group">Giữ tập trung</h4>
            <div class="set-card">
              ${row('Focus Mode', 'Nút Focus trên mỗi task: thu gọn cửa sổ, chỉ còn task và đồng hồ.', toggle('focusEnabled'))}
              ${row('Thời lượng mặc định', 'Phút cho mỗi phiên focus.', choice('focusMinutes', [25, 45, 60], '′'), { sub: true, dep: 'focusEnabled' })}
              ${row('Giới hạn việc đang làm', 'Chỉ cho một số task “Đang làm” cùng lúc.', toggle('wipEnabled'))}
              ${row('Số task tối đa', '', choice('wipLimit', [1, 2, 3]), { sub: true, dep: 'wipEnabled' })}
            </div>

            <h4 class="set-group">Rèn trí nhớ</h4>
            <div class="set-card">
              ${row('Ô “Tôi nghĩ trước”', 'Nhắc nhẹ tự ghi hướng làm trước khi bắt đầu hoặc nhờ AI.', toggle('thinkEnabled'))}
              ${row('Recall cuối ngày', 'Thông báo và màn hình tự nhớ lại ngày hôm nay.', toggle('recallEnabled'))}
              ${row('Giờ recall', '', `<input class="set-input" type="time" id="set-recall-time" value="${s.recallTime}" />`, { sub: true, dep: 'recallEnabled' })}
              ${row('Ôn tập giãn cách', 'Callout tạo bằng Highlight thành thẻ ôn sau 1, 3, 7, 14, 30 ngày.', toggle('srsEnabled'))}
              ${row('Thống kê chuyển việc', 'Ghi cục bộ số lần chuyển note/task/chế độ và thời gian focus.', toggle('statsEnabled'))}
              ${row('Nhắc khi dán đoạn dài', 'Gợi ý tóm tắt lại bằng lời của bạn.', toggle('pasteEnabled'))}
              ${row('Ngưỡng số từ', '', `<input class="set-input narrow" type="number" min="10" max="2000" step="10" id="set-paste-words" value="${s.pasteWords}" /><span class="set-unit">từ</span>`, { sub: true, dep: 'pasteEnabled' })}
            </div>

            <h4 class="set-group">Cửa sổ</h4>
            <div class="set-card">
              ${row('Luôn nằm trên cùng', 'Always on top.', `<button class="switch" role="switch" data-toggle="alwaysOnTop" aria-checked="${win.alwaysOnTop}"><i></i></button>`)}
              ${row('Khởi động cùng Windows', '', `<button class="switch" role="switch" data-toggle="launchAtLogin" aria-checked="${win.launchAtLogin}"><i></i></button>`)}
            </div>
          </div>`;

        const syncDeps = () => {
          root.querySelectorAll('[data-dep]').forEach((r) => r.classList.toggle('off', !settings()[r.dataset.dep]));
        };
        syncDeps();

        root.addEventListener('click', async (e) => {
          if (e.target.closest('[data-act="close"]')) return close('close');
          const sw = e.target.closest('[data-toggle]');
          if (sw) {
            const key = sw.dataset.toggle;
            if (key === 'alwaysOnTop') {
              win.alwaysOnTop = await api.toggleOnTop();
              sw.setAttribute('aria-checked', win.alwaysOnTop);
            } else if (key === 'launchAtLogin') {
              win.launchAtLogin = await api.setLaunchAtLogin(sw.getAttribute('aria-checked') !== 'true');
              sw.setAttribute('aria-checked', win.launchAtLogin);
            } else {
              setSetting(key, !settings()[key]);
              sw.setAttribute('aria-checked', settings()[key]);
              syncDeps();
            }
            return;
          }
          const opt = e.target.closest('[data-choice] [data-v]');
          if (opt) {
            const group = opt.closest('[data-choice]');
            setSetting(group.dataset.choice, Number(opt.dataset.v));
            group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b === opt));
          }
        });

        root.querySelector('#set-recall-time').addEventListener('change', (e) => e.target.value && setSetting('recallTime', e.target.value));
        root.querySelector('#set-paste-words').addEventListener('change', (e) => {
          const v = Math.max(10, Math.min(2000, Math.round(Number(e.target.value)) || settings().pasteWords));
          e.target.value = v;
          setSetting('pasteWords', v);
        });
        return root;
      },
      { className: 'sheet-opaque sheet-settings' },
    );
  }
  button.addEventListener('click', open);
  return { open };
}
