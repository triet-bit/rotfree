import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { DOMSerializer } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { state, save, onBeforeSave, uid, api } from './store.js';
import { el, icons, openPopover, closePopover } from './ui.js';
import { settings, setSetting } from './settings.js';
import { syncCards, dropCards } from './review.js';
import { Callout, Collapsible, Indent, NoteImage, NoteShortcuts } from './editor/extensions.js';
import { createToolbar, openLinkEditor, insertImageFiles } from './editor/toolbar.js';
import { openEmojiPicker } from './emoji-picker.js';

export const NOTE_COLORS = ['yellow', 'green', 'purple', 'blue', 'pink', 'gray'];

const live = new Map(); // note id -> { editor, card, dirty }

const timeLabel = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// ---------- paste cleanup ----------

function unwrap(node) {
  node.replaceWith(...node.childNodes);
}

/** Strip foreign styling (Word, Google Docs, web pages) but keep structure and basic emphasis. */
function cleanPastedHTML(html) {
  if (html.includes('data-pm-slice')) return html; // copied from another note: keep everything
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style, script, meta, link, title, xml, o\\:p, colgroup').forEach((n) => n.remove());
  doc.querySelectorAll('b[id^="docs-internal-guid"]').forEach(unwrap);

  for (const node of [...doc.body.querySelectorAll('*')]) {
    const s = node.style;
    if (s && node.tagName === 'SPAN') {
      const wrapWith = [];
      const weight = s.fontWeight;
      if (weight === 'bold' || Number(weight) >= 600) wrapWith.push('strong');
      if (s.fontStyle === 'italic') wrapWith.push('em');
      if (s.textDecoration.includes('underline') || s.textDecorationLine.includes('underline')) wrapWith.push('u');
      if (s.textDecoration.includes('line-through') || s.textDecorationLine.includes('line-through')) wrapWith.push('s');
      for (const tag of wrapWith) {
        const w = doc.createElement(tag);
        w.append(...node.childNodes);
        node.append(w);
      }
    }
    if (/^(B|STRONG)$/.test(node.tagName) && /font-weight:\s*(normal|[1-5]00)/.test(node.getAttribute('style') || '')) {
      unwrap(node);
      continue;
    }
    for (const attr of [...node.attributes]) {
      const keep = (attr.name === 'href' && node.tagName === 'A')
        || ((attr.name === 'src' || attr.name === 'alt') && node.tagName === 'IMG')
        || attr.name === 'start' || attr.name.startsWith('data-');
      if (!keep) node.removeAttribute(attr.name);
    }
  }
  doc.querySelectorAll('font, span').forEach(unwrap);
  return doc.body.innerHTML;
}

// ---------- editor ----------

function createEditor(note, mount, hooks) {
  let editor;
  const emojiAtCaret = () => {
    const c = editor.view.coordsAtPos(editor.state.selection.from);
    openEmojiPicker({ left: c.left, top: c.top, bottom: c.bottom }, (ch) => editor.chain().focus().insertContent(ch).run(), {
      onClose: (picked) => !picked && editor.commands.focus(),
    });
  };

  editor = new Editor({
    element: mount,
    content: note.doc ?? note.html ?? '',
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer', target: null } },
        codeBlock: false,
        blockquote: false,
        dropcursor: { color: 'var(--blue)', width: 2 },
      }),
      TextStyle,
      Color,
      BackgroundColor,
      TaskList,
      TaskItem.configure({ nested: true }),
      NoteImage.configure({ allowBase64: true }),
      Callout.configure({ onEmojiClick: (btn, set) => openEmojiPicker(btn, set), onReviewClick: hooks.onReviewClick }),
      Collapsible,
      Indent,
      NoteShortcuts.configure({ onLink: () => openLinkEditor(editor), onEmoji: emojiAtCaret }),
      Placeholder.configure({ placeholder: 'Start writing…  Ctrl+\' for emoji' }),
    ],
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'false' },
      transformPastedHTML: cleanPastedHTML,
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
        if (files.length) {
          insertImageFiles(editor, files);
          return true;
        }
        // Let the paste go through, then offer to summarise a long passage.
        const s = settings();
        const words = (event.clipboardData?.getData('text/plain').match(/\S+/g) || []).length;
        if (s.pasteEnabled && words > s.pasteWords) {
          const start = view.state.selection.from;
          setTimeout(() => hooks.onLongPaste?.(start, words), 0);
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = [...(event.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertImageFiles(editor, files, pos);
        return true;
      },
      handleClick: (view, _pos, event) => {
        const a = event.target.closest?.('a[href]');
        if (a && view.dom.contains(a)) {
          api.openExternal(a.getAttribute('href'));
          return true;
        }
        return false;
      },
    },
    onUpdate: hooks.onUpdate,
    onTransaction: hooks.onTransaction,
  });
  return editor;
}

function wordCount(editor) {
  const doc = editor.state.doc;
  const text = doc.textBetween(0, doc.content.size, ' ', ' ');
  return (text.match(/\S+/g) || []).length;
}

// ---------- callouts as review cards ----------

function firstLine(callout) {
  const para = callout.firstChild;
  let out = '';
  for (let i = 0; para && i < para.childCount; i++) {
    const c = para.child(i);
    if (c.type.name === 'hardBreak') break;
    out += c.textContent;
  }
  return out.trim().slice(0, 140);
}

/** Every Highlight callout in the editor, described for the spaced-repetition store. */
function collectCallouts(editor) {
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const out = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'callout' || !node.attrs.cid) return;
    const box = document.createElement('div');
    box.appendChild(serializer.serializeFragment(node.content));
    out.push({ cid: node.attrs.cid, firstLine: firstLine(node), html: box.innerHTML, cue: node.attrs.cue || '', review: node.attrs.review !== false });
  });
  return out;
}

function findCallout(editor, cid) {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'callout' && node.attrs.cid === cid) found = pos;
  });
  return found;
}

/** A short title for a note: its first line of text. Used by the Recall screen. */
function jsonText(node) {
  if (node.type === 'text') return node.text || '';
  return (node.content || []).map(jsonText).join(node.type === 'doc' ? '\n' : '');
}

// ---------- cards ----------

export function initNotes(strip, addButton) {
  function buildCard(note) {
    const card = el('article', { class: 'card note-card', dataset: { color: note.color, id: note.id } });
    card.innerHTML = `
      <header class="note-head">
        <div class="swatches" role="radiogroup" aria-label="Note color">
          ${NOTE_COLORS.map((c) => `<button class="swatch" data-color="${c}" title="${c[0].toUpperCase() + c.slice(1)}"></button>`).join('')}
        </div>
        <div class="note-actions">
          <button class="icon-btn pin-btn" title="Pin note (opens first)">${icons.pin}</button>
          <button class="icon-btn del-btn" title="Delete note">${icons.trash}</button>
        </div>
      </header>
      <div class="note-scroll"><div class="note-editor"></div></div>
      <footer class="note-foot"><span class="words"></span><span class="saved-at"></span></footer>`;

    const words = card.querySelector('.words');
    const savedAt = card.querySelector('.saved-at');
    const entry = { card, editor: null, dirty: false, toolbar: null };

    const updateFooter = () => {
      const n = wordCount(entry.editor);
      words.textContent = `${n} ${n === 1 ? 'word' : 'words'}`;
      savedAt.textContent = `Auto-saved at ${timeLabel(note.updatedAt)}`;
    };
    const updateMeta = () => {
      card.dataset.color = note.color;
      card.classList.toggle('pinned', !!note.pinned);
      card.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s.dataset.color === note.color));
    };

    let raf = 0;
    entry.editor = createEditor(note, card.querySelector('.note-editor'), {
      onReviewClick: (btn, ctx) => openReviewPopover(btn, ctx),
      onLongPaste: (start, words) => showPasteHint(entry, card, start, words),
      onUpdate: () => {
        entry.dirty = true;
        note.updatedAt = Date.now();
        updateFooter();
        save();
      },
      onTransaction: () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => entry.toolbar?.update());
      },
    });
    entry.toolbar = createToolbar(entry.editor, { onLink: () => openLinkEditor(entry.editor) });
    card.querySelector('.note-head').after(entry.toolbar.el);

    // Clicking empty space below the text puts the caret at the end.
    card.querySelector('.note-scroll').addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('note-scroll')) {
        e.preventDefault();
        entry.editor.commands.focus('end');
      }
    });

    card.querySelector('.swatches').addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (!sw) return;
      note.color = sw.dataset.color;
      updateMeta();
      save();
    });
    card.querySelector('.pin-btn').addEventListener('click', () => {
      note.pinned = !note.pinned;
      updateMeta();
      save();
    });
    card.querySelector('.del-btn').addEventListener('click', () => confirmDelete(note, card));

    updateMeta();
    updateFooter();
    live.set(note.id, entry);
    return card;
  }

  // ----- callout → review card popover -----

  function openReviewPopover(btn, { attrs, set }) {
    const root = el('div', { class: 'review-pop' }, `
      <label class="review-pop-row"><span>Ôn tập callout này</span><button type="button" class="switch" role="switch" aria-checked="${attrs.review}"><i></i></button></label>
      <label class="field-label" for="rv-cue">Câu hỏi gợi nhớ</label>
      <input id="rv-cue" class="set-input wide" type="text" maxlength="200" spellcheck="false" placeholder="Mặc định: dòng đầu của callout" />`);
    const sw = root.querySelector('.switch');
    const input = root.querySelector('input');
    input.value = attrs.cue || '';
    sw.addEventListener('click', () => {
      const on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', on);
      set({ review: on });
    });
    const commit = () => input.value.trim() !== (attrs.cue || '') && set({ cue: input.value.trim() });
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        closePopover();
      }
    });
    openPopover(btn, root, { className: 'review-popover', onClose: commit });
  }

  // ----- long paste → "summarise in your own words" -----

  function showPasteHint(entry, card, start, words) {
    const { editor } = entry;
    const end = editor.state.selection.to;
    if (end <= start) return;
    card.querySelector('.paste-hint')?.remove();
    const scroll = card.querySelector('.note-scroll');
    const hint = el('div', { class: 'paste-hint', role: 'status' }, `
      <span class="paste-hint-text">Tóm tắt lại bằng lời của bạn?</span>
      <div class="paste-hint-actions">
        <button class="btn primary" data-act="write">Viết tóm tắt</button>
        <button class="btn" data-act="skip">Bỏ qua</button>
        <button class="link-btn" data-act="never">Không hỏi lại</button>
      </div>`);
    const c = editor.view.coordsAtPos(end);
    hint.style.top = `${c.bottom - scroll.getBoundingClientRect().top + scroll.scrollTop + 8}px`;
    scroll.appendChild(hint);
    hint.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    const dismiss = () => {
      clearTimeout(timer);
      editor.off('update', dismiss);
      hint.classList.add('leaving');
      setTimeout(() => hint.remove(), 180);
    };
    const timer = setTimeout(dismiss, 9000);
    // Typing again means the moment has passed.
    setTimeout(() => editor.on('update', dismiss), 50);
    hint.addEventListener('mouseenter', () => clearTimeout(timer));

    hint.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'write') writeSummary(editor, start, end, words);
      if (act === 'never') setSetting('pasteEnabled', false);
      dismiss();
    });
  }

  /** Fold the pasted passage into a collapsible block and open an empty "my summary" callout below it. */
  function writeSummary(editor, start, end, words) {
    const { state: st } = editor;
    const { schema } = st;
    const size = st.doc.content.size;
    const $s = st.doc.resolve(Math.min(start, size));
    const $e = st.doc.resolve(Math.min(end, size));
    if ($s.depth < 1 || $e.depth < 1) return;
    const from = $s.before(1);
    const to = $e.after(1);
    const folded = schema.nodes.collapsible.create(
      { collapsed: true, label: `Đoạn dán gốc · ${words} từ` },
      st.doc.slice(from, to).content,
    );
    const title = schema.nodes.paragraph.create(null, schema.text('Tóm tắt của tôi', [schema.marks.bold.create()]));
    const body = schema.nodes.paragraph.create();
    const callout = schema.nodes.callout.create({ emoji: '✍️', review: false }, [title, body]);
    const tr = st.tr.replaceWith(from, to, [folded, callout]);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + folded.nodeSize + 1 + title.nodeSize + 1)));
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
  }

  function confirmDelete(note, card) {
    if (card.querySelector('.confirm-sheet')) return;
    const sheet = el('div', { class: 'confirm-sheet' }, `
      <div class="confirm-box" role="alertdialog">
        <strong>Delete this note?</strong>
        <p>This can’t be undone.</p>
        <div class="confirm-actions">
          <button class="btn cancel">Cancel</button>
          <button class="btn danger">Delete</button>
        </div>
      </div>`);
    const close = () => {
      sheet.classList.add('leaving');
      setTimeout(() => sheet.remove(), 160);
    };
    sheet.querySelector('.cancel').addEventListener('click', close);
    sheet.addEventListener('mousedown', (e) => e.target === sheet && close());
    sheet.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    sheet.querySelector('.danger').addEventListener('click', () => removeNote(note, card));
    card.appendChild(sheet);
    sheet.querySelector('.danger').focus();
  }

  function removeNote(note, card) {
    card.classList.add('removing');
    setTimeout(() => {
      live.get(note.id)?.editor.destroy();
      live.delete(note.id);
      dropCards(note.id);
      state.notes = state.notes.filter((n) => n.id !== note.id);
      strip.remove(card);
      save();
      if (!state.notes.length) addNote({ focus: false });
    }, 220);
  }

  function addNote({ focus = true } = {}) {
    const last = state.notes[state.notes.length - 1];
    const now = Date.now();
    const note = { id: uid(), color: last?.color ?? 'yellow', pinned: false, doc: null, createdAt: now, updatedAt: now };
    state.notes.push(note);
    const card = buildCard(note);
    card.classList.add('entering');
    strip.append(card);
    save();
    if (focus) setTimeout(() => live.get(note.id)?.editor.commands.focus('start', { scrollIntoView: false }), 380);
  }

  onBeforeSave(() => {
    for (const note of state.notes) {
      const entry = live.get(note.id);
      if (entry?.dirty) {
        note.doc = entry.editor.getJSON();
        delete note.html;
        entry.dirty = false;
        syncCards(note.id, collectCallouts(entry.editor));
      }
    }
  });

  for (const note of state.notes) strip.append(buildCard(note), { scroll: false });
  if (!state.notes.length) addNote({ focus: false });
  const pinned = state.notes.findIndex((n) => n.pinned);
  requestAnimationFrame(() => strip.goTo(pinned >= 0 ? pinned : strip.count() - 1, false));

  // Cards for callouts that already existed before this session's first edit.
  for (const note of state.notes) syncCards(note.id, collectCallouts(live.get(note.id).editor));

  addButton.addEventListener('click', () => addNote());
  return {
    addNote,
    noteTitle(note) {
      const entry = live.get(note.id);
      const text = entry ? entry.editor.state.doc.textBetween(0, entry.editor.state.doc.content.size, '\n', ' ') : note.doc ? jsonText(note.doc) : '';
      return (text.split('\n').find((l) => l.trim()) || '').trim().slice(0, 70);
    },
    /** Scroll to a note (and a callout inside it, if `cid` is given) and flash it. */
    openNote(noteId, cid) {
      const i = state.notes.findIndex((n) => n.id === noteId);
      const entry = live.get(noteId);
      if (i < 0 || !entry) return;
      strip.goTo(i);
      if (!cid) return;
      setTimeout(() => {
        const pos = findCallout(entry.editor, cid);
        if (pos == null) return;
        entry.editor.commands.setTextSelection(pos + 2);
        const dom = entry.editor.view.nodeDOM(pos);
        dom?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        dom?.classList.add('flash');
        setTimeout(() => dom?.classList.remove('flash'), 1600);
      }, 420);
    },
    /** Write a custom review prompt into a callout (from the Review screen). */
    setCue(noteId, cid, cue) {
      const entry = live.get(noteId);
      const pos = entry && findCallout(entry.editor, cid);
      if (pos == null) return;
      entry.editor.view.dispatch(entry.editor.state.tr.setNodeAttribute(pos, 'cue', cue));
    },
  };
}
