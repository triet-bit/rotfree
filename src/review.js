// Spaced repetition over Highlight callouts. A callout with a `cid` is a card; the card keeps a
// snapshot of the callout (for review without loading the note) plus its schedule.
import { state, save, dayKey, addDays } from './store.js';
import { settings, onSetting } from './settings.js';
import { el, openSheet, escapeHTML, icons } from './ui.js';

/** Days to wait at each stage. Forgot → stage 0, vague → same stage, good → next stage. */
export const INTERVALS = [1, 3, 7, 14, 30];

let onChange = () => {};

const live = (c) => !c.gone && c.review !== false;
export const dueCards = () =>
  Object.values(state.cards)
    .filter((c) => live(c) && c.due <= dayKey())
    .sort((a, b) => a.due.localeCompare(b.due));

/** Reconcile the cards of one note with the callouts currently in its document. */
export function syncCards(noteId, infos) {
  const seen = new Set();
  let touched = false;
  for (const info of infos) {
    if (seen.has(info.cid)) continue; // pasted duplicate of a callout: only the first one counts
    seen.add(info.cid);
    let card = state.cards[info.cid];
    if (card && card.noteId !== noteId && !card.gone) continue;
    if (!card) {
      card = state.cards[info.cid] = { id: info.cid, stage: 0, due: addDays(dayKey(), INTERVALS[0]) };
      touched = true;
    }
    const next = { noteId, gone: false, firstLine: info.firstLine, html: info.html, cue: info.cue, review: info.review };
    if (Object.keys(next).some((k) => card[k] !== next[k])) {
      Object.assign(card, next);
      touched = true;
    }
  }
  for (const card of Object.values(state.cards)) {
    if (card.noteId === noteId && !seen.has(card.id) && !card.gone) {
      card.gone = true;
      touched = true;
    }
  }
  if (touched) onChange();
}

export function dropCards(noteId) {
  for (const [id, card] of Object.entries(state.cards)) if (card.noteId === noteId) delete state.cards[id];
  onChange();
}

function rate(card, grade) {
  if (grade === 'forgot') card.stage = 0;
  else if (grade === 'good') card.stage = Math.min(INTERVALS.length - 1, card.stage + 1);
  card.due = addDays(dayKey(), INTERVALS[card.stage]);
  card.lastReviewed = dayKey();
  save();
  onChange();
}

/**
 * `openNote(noteId, cid)` jumps to the callout in its note; `setCue(noteId, cid, cue)` writes a
 * custom prompt back into the callout.
 */
export function initReview({ button, openNote, setCue }) {
  const badge = button.querySelector('.badge-count');

  function updateBadge() {
    button.hidden = !settings().srsEnabled;
    const n = settings().srsEnabled ? dueCards().length : 0;
    badge.textContent = n > 99 ? '99+' : n;
    badge.hidden = n === 0;
    button.title = n ? `Ôn tập — ${n} thẻ cần ôn hôm nay` : 'Ôn tập — hôm nay không có thẻ nào cần ôn';
  }
  onChange = () => {
    updateBadge();
    save();
  };
  onSetting((k) => k === 'srsEnabled' && updateBadge());
  updateBadge();
  // The date can roll over while the app stays open.
  setInterval(updateBadge, 60_000);

  function open() {
    const queue = dueCards().map((c) => c.id);
    let pos = 0;
    let total = queue.length;

    openSheet(
      (close) => {
        const root = el('div', { class: 'review' });

        const finish = () => {
          const left = Object.values(state.cards).filter(live).length;
          root.innerHTML = `
            <div class="review-empty">
              <div class="big">${total ? '🌿' : '🌱'}</div>
              <h2>${total ? 'Xong lượt ôn hôm nay' : 'Chưa có thẻ nào cần ôn'}</h2>
              <p>${total ? 'Các thẻ sẽ quay lại theo lịch 1 · 3 · 7 · 14 · 30 ngày.' : left ? `Bạn có ${left} thẻ, chưa đến hạn ôn.` : 'Bôi đen một đoạn trong note rồi bấm Highlight — callout đó sẽ trở thành thẻ ôn tập.'}</p>
              <button class="btn primary" data-act="close">Đóng</button>
            </div>`;
          root.querySelector('[data-act="close"]').addEventListener('click', () => close('done'));
        };

        const show = () => {
          const card = state.cards[queue[pos]];
          if (!card) return finish();
          const cue = card.cue || card.firstLine || 'Callout này nói gì?';
          root.innerHTML = `
            <header class="review-head">
              <span class="review-progress">${pos + 1} / ${total}</span>
              <div class="review-bar"><i style="width:${(pos / total) * 100}%"></i></div>
              <button class="icon-btn" data-act="close" title="Đóng" aria-label="Đóng">${icons.close}</button>
            </header>
            <div class="flash">
              <div class="flash-label">Gợi ý
                <button class="link-btn" data-act="edit-cue">Sửa câu hỏi</button>
              </div>
              <div class="flash-cue"></div>
              <div class="flash-front">
                <textarea class="attempt" rows="3" spellcheck="false" placeholder="Nhớ lại trong đầu, hoặc gõ ra ở đây (không bắt buộc)…"></textarea>
                <button class="btn primary" data-act="reveal">Xem đáp án</button>
              </div>
              <div class="flash-back" hidden>
                <div class="flash-attempt" hidden><b>Bạn nhớ:</b> <span></span></div>
                <div class="flash-answer prose-lite"></div>
                <button class="link-btn" data-act="open-note">Mở note chứa callout này →</button>
                <div class="rate">
                  <button class="btn rate-forgot" data-grade="forgot"><b>Quên</b><small>về 1 ngày</small></button>
                  <button class="btn rate-vague" data-grade="vague"><b>Nhớ mang máng</b><small>giữ mốc ${INTERVALS[card.stage]} ngày</small></button>
                  <button class="btn rate-good" data-grade="good"><b>Nhớ rõ</b><small>lên mốc ${INTERVALS[Math.min(card.stage + 1, INTERVALS.length - 1)]} ngày</small></button>
                </div>
              </div>
            </div>`;
          root.querySelector('.flash-cue').textContent = cue;
          root.querySelector('.flash-answer').innerHTML = card.html;
          const attempt = root.querySelector('.attempt');
          setTimeout(() => attempt.focus(), 100);

          root.onclick = (e) => {
            const b = e.target.closest('[data-act], [data-grade]');
            if (!b) return;
            if (b.dataset.grade) {
              rate(card, b.dataset.grade);
              pos++;
              return pos < queue.length ? show() : finish();
            }
            switch (b.dataset.act) {
              case 'close':
                close('close');
                break;
              case 'reveal': {
                root.querySelector('.flash-front').hidden = true;
                root.querySelector('.flash-back').hidden = false;
                if (attempt.value.trim()) {
                  const box = root.querySelector('.flash-attempt');
                  box.hidden = false;
                  box.querySelector('span').textContent = attempt.value.trim();
                }
                break;
              }
              case 'open-note':
                close('open');
                openNote(card.noteId, card.id);
                break;
              case 'edit-cue': {
                const cueEl = root.querySelector('.flash-cue');
                const input = el('input', { class: 'cue-input', type: 'text', maxlength: 200, spellcheck: 'false', placeholder: card.firstLine || 'Câu hỏi gợi nhớ' });
                input.value = card.cue || '';
                cueEl.replaceChildren(input);
                input.focus();
                const commit = () => {
                  card.cue = input.value.trim();
                  setCue(card.noteId, card.id, card.cue);
                  cueEl.textContent = card.cue || card.firstLine || 'Callout này nói gì?';
                  save();
                };
                input.addEventListener('keydown', (ev) => {
                  if (ev.key === 'Enter') {
                    ev.preventDefault();
                    commit();
                    root.querySelector('.attempt')?.focus();
                  }
                });
                input.addEventListener('blur', commit);
                break;
              }
            }
          };
        };

        if (queue.length) show();
        else finish();
        return root;
      },
      { className: 'sheet-opaque sheet-review' },
    );
  }

  button.addEventListener('click', open);
  return { open, updateBadge };
}
