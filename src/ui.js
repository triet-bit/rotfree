// Small shared UI primitives: SVG icons, anchored popovers, image lightbox.

const svg = (body, vb = '0 0 16 16') => `<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;

export const icons = {
  bold: '<b>B</b>',
  italic: '<i>I</i>',
  underline: '<u>U</u>',
  strike: '<s>S</s>',
  code: svg('<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5"/>'),
  heading: '<span class="tb-text">H</span>',
  list: svg('<circle cx="3" cy="4.5" r="1" class="fill"/><circle cx="3" cy="8" r="1" class="fill"/><circle cx="3" cy="11.5" r="1" class="fill"/><path d="M6 4.5h8M6 8h8M6 11.5h8"/>'),
  color: '<span class="tb-color">A<i></i></span>',
  link: svg('<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/>'),
  image: svg('<rect x="2" y="3" width="12" height="10" rx="2"/><circle cx="6" cy="6.5" r="1.2" class="fill"/><path d="M2.5 11.5l3.5-3 2.5 2 2-1.5 3 2.5"/>'),
  pin: svg('<path d="M10.5 2.5l3 3-2 1-2.5 2.5.5 3-1 1-2.5-2.5L3 13.5 2.5 13l2.5-3L2.5 7.5l1-1 3 .5L9 4.5z"/>'),
  trash: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2c.1.7.6 1.3 1.4 1.3h3c.8 0 1.3-.6 1.4-1.3l.6-8.2"/>'),
  check: svg('<path d="M3.5 8.5l3 3 6-7"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  undo: svg('<path d="M5 6.5H10a3 3 0 0 1 0 6H7"/><path d="M7 4L4.5 6.5 7 9"/>'),
  redo: svg('<path d="M11 6.5H6a3 3 0 0 0 0 6h3"/><path d="M9 4l2.5 2.5L9 9"/>'),
  focus: svg('<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.6"/>'),
  bulb: svg('<path d="M6 11.5h4M6.5 13.5h3M8 2.5a4 4 0 0 0-2.2 7.3c.3.3.4.6.4 1v.7h3.6v-.7c0-.4.1-.7.4-1A4 4 0 0 0 8 2.5z"/>'),
  gear: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>'),
  chart: svg('<path d="M3 13V8.5M6.5 13V4M10 13V6.5M13.5 13V2.5"/>'),
  cards: svg('<rect x="2.5" y="4.5" width="9" height="8" rx="1.8"/><path d="M5 4.5V4a1.8 1.8 0 0 1 1.8-1.8h5.4A1.8 1.8 0 0 1 14 4v5a1.8 1.8 0 0 1-1.8 1.8"/>'),
  brain: svg('<path d="M8 3v10M5.6 3.2A2.4 2.4 0 0 0 3.5 5.6c0 .5.1.9.4 1.3A2.5 2.5 0 0 0 3 8.8 2.5 2.5 0 0 0 4.6 11a2.2 2.2 0 0 0 3.4 1.6M10.4 3.2a2.4 2.4 0 0 1 2.1 2.4c0 .5-.1.9-.4 1.3a2.5 2.5 0 0 1 .9 1.9A2.5 2.5 0 0 1 11.4 11 2.2 2.2 0 0 1 8 12.6"/>'),
  chevron: svg('<path d="M6 3.5L10.5 8 6 12.5"/>'),
  play: svg('<path d="M5 3.2v9.6L12.8 8z" class="fill"/>'),
  pause: svg('<path d="M5.5 3.5v9M10.5 3.5v9"/>'),
  note: svg('<path d="M4 2.5h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM5.5 6h5M5.5 8.5h5M5.5 11h3"/>'),
  grip: svg('<circle cx="6" cy="4" r="1" class="fill"/><circle cx="10" cy="4" r="1" class="fill"/><circle cx="6" cy="8" r="1" class="fill"/><circle cx="10" cy="8" r="1" class="fill"/><circle cx="6" cy="12" r="1" class="fill"/><circle cx="10" cy="12" r="1" class="fill"/>'),
};

export function el(tag, attrs = {}, html = '') {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  if (html) node.innerHTML = html;
  return node;
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- popovers ----------

let current = null;

/**
 * Show `content` in a floating popover near `anchor` (an element or a {left, top, bottom} rect).
 * Only one popover is open at a time. Returns a close() function.
 */
export function openPopover(anchor, content, { onClose, className = '', placement = 'below' } = {}) {
  closePopover();
  const pop = el('div', { class: `popover ${className}` });
  pop.appendChild(content);
  document.body.appendChild(pop);

  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = Math.min(Math.max(8, rect.left), vw - pw - 8);
  let top = placement === 'above' ? rect.top - ph - 6 : rect.bottom + 6;
  if (top + ph > vh - 8) top = rect.top - ph - 6;
  if (top < 8) top = Math.min(vh - ph - 8, rect.bottom + 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(8, top)}px`;
  pop.style.transformOrigin = top < rect.top ? 'bottom left' : 'top left';

  const onDown = (e) => {
    if (!pop.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) closePopover();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePopover();
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onDown, true));
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closePopover, { once: true });

  current = {
    pop,
    close() {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', closePopover);
      pop.classList.add('leaving');
      setTimeout(() => pop.remove(), 120);
      onClose?.();
    },
  };
  return closePopover;
}

export function closePopover() {
  const c = current;
  current = null;
  c?.close();
}

export function popoverOpen() {
  return !!current;
}

// ---------- lightbox ----------

export function openLightbox(src) {
  const box = el('div', { class: 'lightbox' }, `<img alt="" />`);
  box.querySelector('img').src = src;
  const close = () => {
    box.classList.add('leaving');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => box.remove(), 180);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(box);
}

// ---------- sheets (full-window overlays) ----------

let sheetState = null;

/**
 * Open a full-window sheet (Settings, Stats, Review, Recall…) above the workspace.
 * Only one is open at a time. `build(close)` receives a close function and returns the
 * sheet body. Esc and a click on the dim backdrop close it, unless `dismissable` is false.
 * Returns { close, body }.
 */
export function openSheet(build, { className = '', onClose, dismissable = true, host = document.getElementById('app') } = {}) {
  closeSheet();
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const sheet = el('section', { class: `sheet ${className}`, role: 'dialog', 'aria-modal': 'true' });
  backdrop.appendChild(sheet);
  let closed = false;
  const close = (reason) => {
    if (closed) return;
    closed = true;
    if (sheetState?.sheet === sheet) sheetState = null;
    document.removeEventListener('keydown', onKey, true);
    backdrop.classList.add('leaving');
    setTimeout(() => backdrop.remove(), 200);
    onClose?.(reason);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable && !popoverOpen()) {
      e.preventDefault();
      e.stopPropagation();
      close('escape');
    }
  };
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && dismissable) close('backdrop');
  });
  sheet.appendChild(build(close, sheet));
  document.addEventListener('keydown', onKey, true);
  host.appendChild(backdrop);
  sheetState = { sheet, close };
  return { close, sheet };
}

export function closeSheet() {
  sheetState?.close('replaced');
}

export function sheetOpen() {
  return !!sheetState;
}

/**
 * Small modal question (Apple alert style). `actions` is [{ label, value, kind }] where kind may
 * be 'primary' | 'danger'. Resolves with the chosen value, or null if dismissed (Esc / backdrop).
 */
export function ask({ title, message = '', actions }) {
  return new Promise((resolve) => {
    let answer = null;
    openSheet(
      (close) => {
        const box = el('div', { class: 'alert-box' }, `<strong></strong><p></p><div class="alert-actions"></div>`);
        box.querySelector('strong').textContent = title;
        box.querySelector('p').textContent = message;
        box.querySelector('p').hidden = !message;
        const row = box.querySelector('.alert-actions');
        row.style.setProperty('--n', actions.length);
        for (const a of actions) {
          const b = el('button', { class: `btn ${a.kind || ''}` });
          b.textContent = a.label;
          b.addEventListener('click', () => {
            answer = a.value;
            close('choice');
          });
          row.appendChild(b);
        }
        setTimeout(() => (row.querySelector('.primary') || row.lastElementChild)?.focus(), 30);
        return box;
      },
      { className: 'sheet-alert', onClose: () => resolve(answer) },
    );
  });
}
