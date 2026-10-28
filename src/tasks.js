import Sortable from 'sortablejs';
import { state, save, uid, dayKey, parseDayKey } from './store.js';
import { el, icons, escapeHTML, ask } from './ui.js';
import { settings, onSetting } from './settings.js';
import { startFocus } from './focus.js';

const PRIORITIES = ['A', 'B', 'C'];
const TAGS = { '': 'None', today: 'Today', urgent: 'Urgent' };
const TAG_CYCLE = ['', 'today', 'urgent'];

function dayTitle(key) {
  const today = dayKey();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === today) return 'Today';
  if (key === dayKey(y)) return 'Yesterday';
  return parseDayKey(key).toLocaleDateString('en-US', { weekday: 'long' });
}

function autoGrow(field) {
  field.style.height = 'auto';
  field.style.height = `${Math.min(field.scrollHeight, 140)}px`;
}

const dayDate = (key) => parseDayKey(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const STATUS_TAG = {
  doing: '<button class="tag tag-doing" data-act="pause" title="Bấm để tạm dừng"><i class="live-dot"></i>Đang làm</button>',
  paused: '<button class="tag tag-paused" data-act="resume" title="Bấm để làm tiếp">Paused</button>',
};

const formatMinutes = (ms) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`;
};

function taskHTML(t, { open }) {
  const s = settings();
  const wip = s.wipEnabled;
  const status = wip && !t.done ? t.status : '';
  const tag = t.done
    ? '<span class="tag tag-done">Done</span>'
    : STATUS_TAG[status]
      ? STATUS_TAG[status]
      : t.tag
        ? `<button class="tag tag-${t.tag}" data-act="tag" title="Change tag">${TAGS[t.tag]}</button>`
        : '<button class="tag tag-none" data-act="tag" title="Add tag">+ Tag</button>';
  const hasThink = s.thinkEnabled && !!t.think?.trim();
  const startBtn = !wip || t.done
    ? ''
    : status === 'doing'
      ? `<button class="mini-btn" data-act="pause">${icons.pause}<span>Tạm dừng</span></button>`
      : `<button class="mini-btn primary" data-act="${status === 'paused' ? 'resume' : 'start'}">${icons.play}<span>${status === 'paused' ? 'Làm tiếp' : 'Bắt đầu'}</span></button>`;
  const think = s.thinkEnabled
    ? `<label class="field-label" for="think-${t.id}">Tôi nghĩ trước</label>
       <textarea class="field think-input" id="think-${t.id}" rows="2" spellcheck="false" placeholder="Bạn định làm thế nào? Ghi hướng đi, ý tưởng ban đầu của riêng bạn…">${escapeHTML(t.think || '')}</textarea>`
    : '';
  return `
    <li class="task${t.done ? ' done' : ''}${status ? ` st-${status}` : ''}${open ? ' open' : ''}${hasThink ? ' has-think' : ''}" data-id="${t.id}">
      <div class="task-main">
        <button class="prio prio-${t.priority}" title="Priority ${t.priority} — click to change">${t.priority}</button>
        <span class="task-title" title="Double-click to rename · bấm để mở ghi chú">${escapeHTML(t.title)}</span>
        <span class="bulb" title="Bạn đã ghi hướng làm trước">${icons.bulb}</span>
        ${tag}
        ${s.focusEnabled && !t.done ? `<button class="task-focus" data-act="focus" title="Focus vào task này" aria-label="Focus">${icons.focus}</button>` : ''}
        <button class="task-del" title="Delete task" aria-label="Delete task">${icons.close}</button>
        <label class="check" title="${t.done ? 'Mark as not done' : 'Mark as done'}">
          <input type="checkbox"${t.done ? ' checked' : ''} /><span>${icons.check}</span>
        </label>
      </div>
      <div class="task-detail"><div class="task-detail-inner">
        ${think}
        <label class="field-label" for="notes-${t.id}">Ghi chú</label>
        <textarea class="field notes-input" id="notes-${t.id}" rows="2" spellcheck="false" placeholder="Ghi chú cho task này…">${escapeHTML(t.notes || '')}</textarea>
        <div class="detail-actions">
          ${startBtn}
          ${t.focusMs ? `<span class="focus-total">${icons.focus}Đã focus ${formatMinutes(t.focusMs)}</span>` : ''}
        </div>
      </div></div>
    </li>`;
}

export function initTasks(strip, todayButton, { openRecall } = {}) {
  const cards = new Map(); // day key -> { card, render, relabel }
  const openIds = new Set(); // tasks whose detail panel is expanded

  const allTasks = () => Object.entries(state.days).flatMap(([day, list]) => list.map((task) => ({ task, day })));
  const renderAll = () => cards.forEach((c) => c.render());
  const changed = () => {
    renderAll();
    save();
  };

  function markDone(task, done = true) {
    task.done = done;
    if (done) {
      task.status = '';
      task.doneAt = Date.now();
    } else delete task.doneAt;
    changed();
  }

  // ----- anti-multitasking flows: think first, then WIP limit -----

  /** Show a day's card and open a task's detail panel, optionally focusing a field inside. */
  function reveal(task, day, field) {
    const entry = cards.get(day);
    if (!entry) return;
    strip.goTo(strip.indexOf(entry.card));
    openIds.add(task.id);
    entry.render();
    const li = entry.card.querySelector(`.task[data-id="${task.id}"]`);
    setTimeout(() => {
      li?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (field) li?.querySelector(field)?.focus();
    }, 120);
  }

  /** Nudge to write a plan before starting. Resolves true to carry on, false to stop. */
  async function thinkGate(task, day) {
    if (!settings().thinkEnabled || task.think?.trim()) return true;
    const choice = await ask({
      title: 'Dành 2 phút ghi lại bạn định làm thế nào?',
      message: 'Tự nghĩ hướng đi trước khi bắt đầu (hoặc trước khi nhờ AI) giúp bạn nhớ và hiểu sâu hơn.',
      actions: [
        { label: 'Bỏ qua', value: 'skip' },
        { label: 'Viết ngay', value: 'write', kind: 'primary' },
      ],
    });
    if (choice === 'write') reveal(task, day, '.think-input');
    return choice === 'skip';
  }

  /** Make `task` the one in progress, asking what to do with the others if the WIP limit is hit. */
  async function claimDoing(task) {
    const s = settings();
    if (!s.wipEnabled || task.status === 'doing') return true;
    for (;;) {
      const doing = allTasks()
        .filter((x) => x.task.status === 'doing' && !x.task.done && x.task !== task)
        .sort((a, b) => (a.task.startedAt || 0) - (b.task.startedAt || 0));
      if (doing.length < s.wipLimit) break;
      const cur = doing[0].task;
      const choice = await ask({
        title: `Bạn đang làm “${cur.title}”.`,
        message: 'Hoàn thành hay tạm dừng nó trước?',
        actions: [
          { label: 'Hoàn thành', value: 'done' },
          { label: 'Tạm dừng', value: 'pause', kind: 'primary' },
        ],
      });
      if (!choice) return false;
      if (choice === 'done') markDone(cur);
      else cur.status = 'paused';
    }
    task.status = 'doing';
    task.startedAt = Date.now();
    changed();
    return true;
  }

  async function beginTask(task, day) {
    if (task.status !== 'paused' && !(await thinkGate(task, day))) return;
    await claimDoing(task);
  }

  async function focusTask(task, day) {
    if (task.status !== 'doing' && !(await thinkGate(task, day))) return;
    if (!(await claimDoing(task))) return;
    startFocus({
      task,
      onDone: () => markDone(task),
      onChange: () => {
        renderAll();
        save();
      },
    });
  }

  function buildDayCard(key) {
    const tasks = () => state.days[key];
    const card = el('article', { class: 'card task-card', dataset: { day: key } });
    card.innerHTML = `
      <header class="task-head">
        <div class="task-head-text"><h3></h3><span class="task-date"></span></div>
        <span class="badge"></span>
      </header>
      <ul class="task-list"></ul>
      <div class="task-empty">No tasks yet.<br/>Add one below to get started.</div>
      <footer class="task-foot">
        <div class="add-form">
          <div class="add-form-inner">
            <input class="add-input" type="text" placeholder="What needs doing?" maxlength="200" spellcheck="false" />
            <div class="add-opts">
              <div class="pick prio-pick" role="radiogroup" aria-label="Priority">
                ${PRIORITIES.map((p) => `<button type="button" class="prio prio-${p}" data-p="${p}">${p}</button>`).join('')}
              </div>
              <div class="pick tag-pick" role="radiogroup" aria-label="Tag">
                ${TAG_CYCLE.map((t) => `<button type="button" class="tag-opt" data-t="${t}">${TAGS[t]}</button>`).join('')}
              </div>
            </div>
            <div class="add-hint"><kbd>Enter</kbd> add · <kbd>Esc</kbd> close</div>
          </div>
        </div>
        <div class="foot-row">
          <button class="add-btn"><span class="add-icon">${icons.plus}</span><span>Add task</span></button>
          <button class="recall-btn" title="Nhìn lại hôm nay bằng trí nhớ của bạn">${icons.brain}<span></span></button>
        </div>
      </footer>`;

    const list = card.querySelector('.task-list');
    const badge = card.querySelector('.badge');
    const form = card.querySelector('.add-form');
    const input = card.querySelector('.add-input');
    const addBtn = card.querySelector('.add-btn');
    const recallBtn = card.querySelector('.recall-btn');
    let draft = { priority: 'B', tag: 'today' };

    function relabel() {
      card.querySelector('h3').textContent = dayTitle(key);
      card.querySelector('.task-date').textContent = dayDate(key);
      card.classList.toggle('is-today', key === dayKey());
      const saved = !!state.recalls[key]?.text;
      recallBtn.hidden = !settings().recallEnabled || (!saved && key !== dayKey());
      recallBtn.classList.toggle('saved', saved);
      recallBtn.querySelector('span').textContent = saved ? 'Xem recall' : 'Recall';
    }

    function render() {
      const items = tasks();
      list.innerHTML = items.map((t) => taskHTML(t, { open: openIds.has(t.id) })).join('');
      list.querySelectorAll('textarea').forEach(autoGrow);
      relabel();
      const done = items.filter((t) => t.done).length;
      badge.textContent = `${done}/${items.length} Completed`;
      badge.classList.toggle('all-done', items.length > 0 && done === items.length);
      card.classList.toggle('empty', items.length === 0);
    }

    function syncDraft() {
      card.querySelectorAll('.prio-pick .prio').forEach((b) => b.classList.toggle('selected', b.dataset.p === draft.priority));
      card.querySelectorAll('.tag-opt').forEach((b) => b.classList.toggle('selected', b.dataset.t === draft.tag));
    }

    function openForm(open) {
      form.classList.toggle('open', open);
      addBtn.classList.toggle('open', open);
      addBtn.querySelector('span:last-child').textContent = open ? 'Close' : 'Add task';
      if (open) {
        syncDraft();
        setTimeout(() => input.focus(), 60);
      } else {
        input.value = '';
        input.blur();
      }
    }

    function addTask() {
      const title = input.value.trim();
      if (!title) return;
      tasks().push({ id: uid(), title, priority: draft.priority, tag: draft.tag, done: false, status: '', think: '', notes: '', focusMs: 0, createdAt: Date.now() });
      input.value = '';
      render();
      list.lastElementChild?.classList.add('entering');
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
      save();
    }

    const find = (li) => tasks().find((t) => t.id === li.dataset.id);

    function startRename(li) {
      const task = find(li);
      const span = li.querySelector('.task-title');
      const field = el('input', { class: 'rename-input', type: 'text', maxlength: 200, spellcheck: 'false' });
      field.value = task.title;
      span.replaceWith(field);
      field.focus();
      field.select();
      let finished = false;
      const finish = (commit) => {
        if (finished) return;
        finished = true;
        const v = field.value.trim();
        if (commit && v && v !== task.title) {
          task.title = v;
          save();
        }
        render();
      };
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) finish(true);
        if (e.key === 'Escape') finish(false);
      });
      field.addEventListener('blur', () => finish(true));
    }

    let expandTimer = 0;

    list.addEventListener('click', (e) => {
      const li = e.target.closest('.task');
      if (!li) return;
      const task = find(li);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'focus') return void focusTask(task, key);
      if (act === 'start' || act === 'resume') return void beginTask(task, key);
      if (act === 'pause') {
        task.status = 'paused';
        return changed();
      }
      if (e.target.closest('.prio')) {
        task.priority = PRIORITIES[(PRIORITIES.indexOf(task.priority) + 1) % PRIORITIES.length];
      } else if (act === 'tag') {
        task.tag = TAG_CYCLE[(TAG_CYCLE.indexOf(task.tag) + 1) % TAG_CYCLE.length];
      } else if (e.target.closest('.task-del')) {
        li.classList.add('removing');
        setTimeout(() => {
          state.days[key] = tasks().filter((t) => t.id !== task.id);
          openIds.delete(task.id);
          render();
          save();
        }, 200);
        return;
      } else if (e.target.closest('.task-main') && !e.target.closest('.check, input, .rename-input')) {
        // Single click toggles the detail panel; wait out a possible double-click (rename).
        clearTimeout(expandTimer);
        expandTimer = setTimeout(() => {
          const open = li.classList.toggle('open');
          if (open) {
            openIds.add(task.id);
            li.querySelectorAll('textarea').forEach(autoGrow);
          } else openIds.delete(task.id);
        }, 230);
        return;
      } else return;
      render();
      save();
    });

    // Plan / notes fields save as you type without re-rendering (that would steal the caret).
    list.addEventListener('input', (e) => {
      const field = e.target.closest('.field');
      if (!field) return;
      const li = field.closest('.task');
      const task = find(li);
      autoGrow(field);
      if (field.classList.contains('think-input')) {
        task.think = field.value;
        li.classList.toggle('has-think', !!field.value.trim());
      } else task.notes = field.value;
      save();
    });

    list.addEventListener('change', (e) => {
      if (!e.target.matches('.check input')) return;
      const li = e.target.closest('.task');
      const task = find(li);
      li.classList.toggle('done', e.target.checked);
      // Let the checkbox spring animate before the row re-renders.
      setTimeout(() => markDone(task, e.target.checked), 160);
    });

    list.addEventListener('dblclick', (e) => {
      clearTimeout(expandTimer);
      const title = e.target.closest('.task-title');
      if (title) startRename(title.closest('.task'));
    });

    Sortable.create(list, {
      animation: 220,
      easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.1)',
      forceFallback: true,
      fallbackTolerance: 4,
      filter: 'input, textarea, .task-detail, .check, .prio, .tag, .task-focus, .task-del, .rename-input',
      preventOnFilter: false,
      ghostClass: 'task-ghost',
      chosenClass: 'task-chosen',
      dragClass: 'task-drag',
      onEnd: () => {
        const order = [...list.children].map((li) => li.dataset.id);
        state.days[key] = order.map((id) => tasks().find((t) => t.id === id)).filter(Boolean);
        save();
      },
    });

    addBtn.addEventListener('click', () => openForm(!form.classList.contains('open')));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        addTask();
      } else if (e.key === 'Escape') {
        openForm(false);
      }
    });
    card.querySelector('.prio-pick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      draft.priority = b.dataset.p;
      syncDraft();
      input.focus();
    });
    card.querySelector('.tag-pick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      draft.tag = b.dataset.t;
      syncDraft();
      input.focus();
    });
    recallBtn.addEventListener('click', () => openRecall?.(key));
    // Keep the input focused when clicking the option chips.
    form.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });

    relabel();
    render();
    cards.set(key, { card, render, relabel });
    return card;
  }

  // ----- day bookkeeping -----

  let today = dayKey();

  function ensureToday() {
    if (!state.days[today]) state.days[today] = [];
  }

  function updateTodayButton() {
    todayButton.hidden = strip.count() < 2 || strip.index === strip.count() - 1;
  }

  // Drop empty past days so idle days don't pile up as blank cards.
  for (const [key, list] of Object.entries(state.days)) {
    if (key < today && list.length === 0) delete state.days[key];
  }
  ensureToday();
  for (const key of Object.keys(state.days).sort()) strip.append(buildDayCard(key), { scroll: false });
  requestAnimationFrame(() => {
    strip.goTo(strip.count() - 1, false);
    updateTodayButton();
  });

  todayButton.addEventListener('click', () => strip.goTo(strip.count() - 1));

  // Roll over to a fresh card when the date changes (app may stay open overnight).
  setInterval(() => {
    const now = dayKey();
    if (now === today) return;
    today = now;
    ensureToday();
    if (!cards.has(today)) strip.append(buildDayCard(today));
    cards.forEach((c) => c.relabel());
    save();
  }, 30_000);

  onSetting(() => {
    renderAll();
    cards.forEach((c) => c.relabel());
  });

  return {
    onIndexChange: updateTodayButton,
    /** Re-render every card (e.g. after a recall was saved). */
    refresh: () => cards.forEach((c) => (c.render(), c.relabel())),
  };
}
