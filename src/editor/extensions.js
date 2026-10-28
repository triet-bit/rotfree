import { Node, Extension, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TextSelection } from '@tiptap/pm/state';
import { NodeRange } from '@tiptap/pm/model';
import { findWrapping, liftTarget } from '@tiptap/pm/transform';
import { openLightbox } from '../ui.js';
import { uid } from '../store.js';

const REVIEW_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="4.5" width="9" height="8" rx="1.8"/><path d="M5 4.5V4a1.8 1.8 0 0 1 1.8-1.8h5.4A1.8 1.8 0 0 1 14 4v5a1.8 1.8 0 0 1-1.8 1.8"/></svg>';

const LIST_ITEMS = ['listItem', 'taskItem'];

/** Depth of the innermost ancestor matching `pred`, or -1. */
function ancestorDepth($pos, pred) {
  for (let d = $pos.depth; d > 0; d--) if (pred($pos.node(d))) return d;
  return -1;
}

// ---------- Callout ----------

/**
 * A boxed block (📌 Test Note style) that wraps any blocks. Its emoji is clickable;
 * `options.onEmojiClick(anchorEl, current, setEmoji)` lets the app open the picker.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { onEmojiClick: null, onReviewClick: null };
  },

  addAttributes() {
    return {
      emoji: {
        default: '📌',
        parseHTML: (el) => el.getAttribute('data-emoji') || '📌',
        renderHTML: (attrs) => ({ 'data-emoji': attrs.emoji }),
      },
      // Callouts made with Highlight carry an id and become spaced-repetition cards (see review.js).
      cid: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-cid'),
        renderHTML: (attrs) => (attrs.cid ? { 'data-cid': attrs.cid } : {}),
      },
      review: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-review') !== 'false',
        renderHTML: (attrs) => (attrs.review ? {} : { 'data-review': 'false' }),
      },
      cue: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-cue') || '',
        renderHTML: (attrs) => (attrs.cue ? { 'data-cue': attrs.cue } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]', contentElement: '.callout-content' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'callout' }),
      ['span', { class: 'callout-emoji', contenteditable: 'false' }, node.attrs.emoji],
      ['div', { class: 'callout-content' }, 0],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'callout';
      dom.dataset.callout = '';
      const btn = document.createElement('button');
      btn.className = 'callout-emoji';
      btn.contentEditable = 'false';
      btn.type = 'button';
      btn.title = 'Change icon';
      btn.textContent = node.attrs.emoji;
      const content = document.createElement('div');
      content.className = 'callout-content';
      const rv = document.createElement('button');
      rv.className = 'callout-review';
      rv.contentEditable = 'false';
      rv.type = 'button';
      rv.innerHTML = REVIEW_ICON;
      dom.append(btn, content, rv);
      const syncReview = (n) => {
        rv.hidden = !n.attrs.cid;
        dom.classList.toggle('is-card', !!n.attrs.cid && n.attrs.review);
        rv.title = n.attrs.review ? 'Thẻ ôn tập — bấm để chỉnh' : 'Không ôn tập — bấm để bật';
      };
      syncReview(node);

      rv.addEventListener('mousedown', (e) => e.preventDefault());
      rv.addEventListener('click', (e) => {
        e.preventDefault();
        // Patch attrs without focusing the editor, so the popover's input keeps the caret.
        const set = (patch) => {
          const pos = getPos();
          if (typeof pos !== 'number') return;
          const tr = editor.state.tr;
          for (const [k, v] of Object.entries(patch)) tr.setNodeAttribute(pos, k, v);
          editor.view.dispatch(tr);
        };
        this.options.onReviewClick?.(rv, { attrs: node.attrs, set });
      });

      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.options.onEmojiClick?.(btn, (emoji) => {
          const pos = getPos();
          if (typeof pos !== 'number') return;
          editor.chain().focus().command(({ tr }) => {
            tr.setNodeAttribute(pos, 'emoji', emoji);
            return true;
          }).run();
        });
      });

      return {
        dom,
        contentDOM: content,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          if (btn.textContent !== updated.attrs.emoji) btn.textContent = updated.attrs.emoji;
          syncReview(updated);
          return true;
        },
        stopEvent: (e) => btn.contains(e.target) || rv.contains(e.target),
        ignoreMutation: (m) => m.type !== 'selection' && !content.contains(m.target),
      };
    };
  },

  addCommands() {
    return {
      /** Wrap the selected blocks (or current line) in a callout; unwrap if already inside one. */
      toggleCallout: () => ({ state, tr, dispatch }) => {
        const type = state.schema.nodes.callout;
        const { $from, $to } = state.selection;

        const inside = ancestorDepth($from, (n) => n.type === type);
        if (inside > 0) {
          const pos = $from.before(inside);
          const node = $from.node(inside);
          const $start = tr.doc.resolve(pos + 1);
          const $end = tr.doc.resolve(pos + node.nodeSize - 1);
          const range = $start.blockRange($end, (n) => n.type === type);
          const target = range && liftTarget(range);
          if (target == null) return false;
          if (dispatch) tr.lift(range, target).scrollIntoView();
          return true;
        }

        // Find the shallowest-necessary range that may legally hold a callout,
        // e.g. inside a list we climb up and wrap the whole list.
        let range = $from.blockRange($to);
        while (range) {
          const wrapping = findWrapping(range, type, { cid: uid() });
          if (wrapping) {
            if (dispatch) tr.wrap(range, wrapping).scrollIntoView();
            return true;
          }
          if (range.depth === 0) break;
          const d = range.depth;
          range = new NodeRange(state.doc.resolve($from.before(d)), state.doc.resolve($to.after(d)), d - 1);
        }
        return false;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () => this.editor.commands.toggleCallout(),
      // Enter on an empty last line of a callout leaves the callout.
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        const para = $from.parent;
        if (para.type.name !== 'paragraph' || para.content.size > 0) return false;
        const d = $from.depth - 1;
        if (d < 1) return false;
        const callout = $from.node(d);
        if (callout.type.name !== 'callout' || $from.index(d) !== callout.childCount - 1) return false;

        return this.editor.commands.command(({ tr, dispatch }) => {
          if (!dispatch) return true;
          if (callout.childCount === 1) {
            // Only an empty line left: drop the callout entirely.
            const start = $from.before(d);
            tr.replaceWith(start, start + callout.nodeSize, state.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, start + 1));
          } else {
            const after = $from.after(d);
            tr.delete($from.before(), $from.after());
            const insertAt = tr.mapping.map(after);
            tr.insert(insertAt, state.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
          }
          tr.scrollIntoView();
          return true;
        });
      },
    };
  },
});

// ---------- Collapsible (a pasted passage folded away behind a one-line header) ----------

export const Collapsible = Node.create({
  name: 'collapsible',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      collapsed: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-collapsed') === 'true',
        renderHTML: (attrs) => ({ 'data-collapsed': String(attrs.collapsed) }),
      },
      label: {
        default: 'Đoạn dán gốc',
        parseHTML: (el) => el.getAttribute('data-label') || 'Đoạn dán gốc',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-collapsible]', contentElement: '.collapsible-content' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-collapsible': '', class: 'collapsible' }), ['div', { class: 'collapsible-content' }, 0]];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'collapsible';
      const head = document.createElement('button');
      head.className = 'collapsible-head';
      head.type = 'button';
      head.contentEditable = 'false';
      head.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg><span></span>';
      const content = document.createElement('div');
      content.className = 'collapsible-content';
      dom.append(head, content);

      const apply = (n) => {
        dom.classList.toggle('collapsed', n.attrs.collapsed);
        head.setAttribute('aria-expanded', !n.attrs.collapsed);
        head.querySelector('span').textContent = n.attrs.label;
        head.title = n.attrs.collapsed ? 'Bấm để mở đoạn gốc' : 'Bấm để thu gọn';
      };
      apply(node);

      head.addEventListener('mousedown', (e) => e.preventDefault());
      head.addEventListener('click', () => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'collapsed', !node.attrs.collapsed));
      });

      return {
        dom,
        contentDOM: content,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          apply(updated);
          return true;
        },
        stopEvent: (e) => head.contains(e.target),
        ignoreMutation: (m) => m.type !== 'selection' && !content.contains(m.target),
      };
    };
  },
});

// ---------- Indent (Tab / Shift+Tab) ----------

export const Indent = Extension.create({
  name: 'indent',
  priority: 1000,

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Number(el.getAttribute('data-indent')) || 0,
            renderHTML: (attrs) => (attrs.indent ? { 'data-indent': attrs.indent, style: `margin-left:${attrs.indent * 1.5}em` } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      changeIndent: (delta) => ({ state, tr }) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            const next = Math.max(0, Math.min(8, (node.attrs.indent || 0) + delta));
            if (next !== node.attrs.indent) {
              tr.setNodeAttribute(pos, 'indent', next);
              changed = true;
            }
            return false;
          }
          return true;
        });
        return changed;
      },
    };
  },

  addKeyboardShortcuts() {
    const listItemType = () => {
      const { $from } = this.editor.state.selection;
      const d = ancestorDepth($from, (n) => LIST_ITEMS.includes(n.type.name));
      return d > 0 ? $from.node(d).type.name : null;
    };
    // Always swallow Tab so focus never jumps out of the note.
    return {
      Tab: () => {
        const item = listItemType();
        if (item) this.editor.commands.sinkListItem(item);
        else this.editor.commands.changeIndent(1);
        return true;
      },
      'Shift-Tab': () => {
        const item = listItemType();
        if (item) this.editor.commands.liftListItem(item);
        else this.editor.commands.changeIndent(-1);
        return true;
      },
    };
  },
});

// ---------- Image with drag-to-resize + click to zoom ----------

export const NoteImage = Image.extend({
  draggable: true,

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('figure');
      dom.className = 'note-image';
      const img = document.createElement('img');
      img.draggable = false;
      const handle = document.createElement('span');
      handle.className = 'note-image-handle';
      handle.title = 'Drag to resize';
      dom.append(img, handle);

      const apply = (n) => {
        if (img.getAttribute('src') !== n.attrs.src) img.src = n.attrs.src;
        img.alt = n.attrs.alt || '';
        img.style.width = n.attrs.width ? `${n.attrs.width}px` : '';
      };
      apply(node);

      img.addEventListener('click', () => openLightbox(img.src));

      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = img.getBoundingClientRect().width;
        const maxW = dom.parentElement?.clientWidth || 2000;
        let w = startW;
        handle.setPointerCapture(e.pointerId);
        dom.classList.add('resizing');
        const move = (ev) => {
          w = Math.round(Math.max(48, Math.min(maxW, startW + ev.clientX - startX)));
          img.style.width = `${w}px`;
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          dom.classList.remove('resizing');
          const pos = getPos();
          if (typeof pos === 'number') {
            editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'width', w));
          }
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });

      return {
        dom,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          apply(updated);
          return true;
        },
        selectNode: () => dom.classList.add('selected'),
        deselectNode: () => dom.classList.remove('selected'),
        stopEvent: (e) => handle.contains(e.target),
        ignoreMutation: () => true,
      };
    };
  },
});

// ---------- Extra shortcuts wired to app UI ----------

export const NoteShortcuts = Extension.create({
  name: 'noteShortcuts',
  priority: 1000,

  addOptions() {
    return { onLink: null, onEmoji: null };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      'Mod-k': () => {
        this.options.onLink?.();
        return true;
      },
      "Mod-'": () => {
        this.options.onEmoji?.();
        return true;
      },
    };
  },
});
