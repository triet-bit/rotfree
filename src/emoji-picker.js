import EMOJI from './emoji-data.json'; // [char, group, "label tags…"][]
import { state, save } from './store.js';
import { el, openPopover, closePopover } from './ui.js';

const COLS = 8;
const MAX_RECENT = 32;
const GROUPS = [
  { id: 'recent', icon: '🕘', name: 'Recently Used' },
  { id: 0, icon: '😀', name: 'Smileys & Emotion' },
  { id: 1, icon: '👋', name: 'People & Body' },
  { id: 3, icon: '🐻', name: 'Animals & Nature' },
  { id: 4, icon: '🍔', name: 'Food & Drink' },
  { id: 5, icon: '✈️', name: 'Travel & Places' },
  { id: 6, icon: '⚽', name: 'Activities' },
  { id: 7, icon: '💡', name: 'Objects' },
  { id: 8, icon: '🔣', name: 'Symbols' },
  { id: 9, icon: '🏳️', name: 'Flags' },
];
const labelOf = new Map(EMOJI.map(([c, , label]) => [c, label.split(' ').slice(0, 3).join(' ')]));

/**
 * Opens the emoji picker anchored at `anchor` (element or caret rect).
 * `onPick(char)` runs when an emoji is chosen; `onClose(picked)` always runs afterwards.
 */
export function openEmojiPicker(anchor, onPick, { onClose } = {}) {
  const root = el('div', { class: 'emoji-picker' });
  root.innerHTML = `
    <input class="emoji-search" type="text" placeholder="Search emoji" spellcheck="false" />
    <div class="emoji-tabs"></div>
    <div class="emoji-title"></div>
    <div class="emoji-grid" role="listbox"></div>
    <div class="emoji-foot"><span class="emoji-foot-char"></span><span class="emoji-foot-label"></span></div>`;
  const input = root.querySelector('.emoji-search');
  const tabs = root.querySelector('.emoji-tabs');
  const title = root.querySelector('.emoji-title');
  const grid = root.querySelector('.emoji-grid');
  const footChar = root.querySelector('.emoji-foot-char');
  const footLabel = root.querySelector('.emoji-foot-label');

  let group = state.recentEmoji.length ? 'recent' : 0;
  let items = [];
  let active = 0;
  let picked = false;

  for (const g of GROUPS) {
    const b = el('button', { class: 'emoji-tab', title: g.name, dataset: { group: g.id } }, g.icon);
    tabs.appendChild(b);
  }

  function compute() {
    const q = input.value.trim().toLowerCase();
    if (q) {
      const words = q.split(/\s+/);
      items = EMOJI.filter(([, , label]) => words.every((w) => label.includes(w))).map((e) => e[0]).slice(0, 200);
      title.textContent = items.length ? 'Search Results' : 'No emoji found';
    } else if (group === 'recent') {
      items = state.recentEmoji.slice();
      title.textContent = items.length ? 'Recently Used' : 'Nothing here yet';
    } else {
      items = EMOJI.filter((e) => e[1] === group).map((e) => e[0]);
      title.textContent = GROUPS.find((g) => g.id === group).name;
    }
    tabs.querySelectorAll('.emoji-tab').forEach((t) => {
      t.classList.toggle('active', !q && String(group) === t.dataset.group);
    });
    active = 0;
    render();
  }

  function render() {
    grid.innerHTML = items.map((c, i) => `<button class="emoji-cell" role="option" data-i="${i}">${c}</button>`).join('');
    grid.scrollTop = 0;
    highlight();
  }

  function highlight() {
    grid.querySelector('.emoji-cell.active')?.classList.remove('active');
    const cell = grid.children[active];
    if (cell) {
      cell.classList.add('active');
      cell.scrollIntoView({ block: 'nearest' });
    }
    footChar.textContent = items[active] ?? '';
    footLabel.textContent = items[active] ? labelOf.get(items[active]) ?? '' : '';
  }

  function pick(char) {
    if (!char) return;
    picked = true;
    state.recentEmoji = [char, ...state.recentEmoji.filter((c) => c !== char)].slice(0, MAX_RECENT);
    save();
    onPick(char);
    closePopover();
  }

  function switchGroup(step) {
    const ids = GROUPS.map((g) => g.id);
    group = ids[(ids.indexOf(group) + step + ids.length) % ids.length];
    input.value = '';
    compute();
  }

  input.addEventListener('input', compute);
  input.addEventListener('keydown', (e) => {
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS };
    if (e.key in moves) {
      // Let Left/Right move the text caret while the user is typing a query.
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && input.value && input.selectionStart !== input.value.length) return;
      e.preventDefault();
      const next = active + moves[e.key];
      if (next >= 0 && next < items.length) active = next;
      else if (e.key === 'ArrowDown') active = items.length - 1;
      highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      switchGroup(e.shiftKey ? -1 : 1);
    }
  });

  // Keep focus in the search box so arrow keys keep working after mouse use.
  root.addEventListener('mousedown', (e) => {
    if (e.target !== input) e.preventDefault();
  });
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.emoji-cell');
    if (cell) pick(items[Number(cell.dataset.i)]);
  });
  grid.addEventListener('mousemove', (e) => {
    const cell = e.target.closest('.emoji-cell');
    if (cell && Number(cell.dataset.i) !== active) {
      active = Number(cell.dataset.i);
      highlight();
    }
  });
  tabs.addEventListener('click', (e) => {
    const t = e.target.closest('.emoji-tab');
    if (!t) return;
    group = t.dataset.group === 'recent' ? 'recent' : Number(t.dataset.group);
    input.value = '';
    compute();
  });

  compute();
  openPopover(anchor, root, { className: 'emoji-popover', onClose: () => onClose?.(picked) });
  requestAnimationFrame(() => input.focus());
}
