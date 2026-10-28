import { api } from '../store.js';
import { el, icons, openPopover, closePopover } from '../ui.js';

const TEXT_COLORS = [
  ['Default', null],
  ['Red', '#FF3B30'],
  ['Orange', '#FF9500'],
  ['Green', '#28A745'],
  ['Blue', '#007AFF'],
  ['Purple', '#AF52DE'],
  ['Pink', '#FF2D55'],
  ['Gray', '#8E8E93'],
];
const HIGHLIGHTS = [
  ['None', null],
  ['Yellow', 'rgba(255, 204, 0, 0.38)'],
  ['Orange', 'rgba(255, 149, 0, 0.30)'],
  ['Green', 'rgba(52, 199, 89, 0.28)'],
  ['Blue', 'rgba(0, 122, 255, 0.22)'],
  ['Purple', 'rgba(175, 82, 222, 0.24)'],
  ['Pink', 'rgba(255, 45, 85, 0.22)'],
  ['Gray', 'rgba(142, 142, 147, 0.28)'],
];

const caretRect = (editor) => {
  const c = editor.view.coordsAtPos(editor.state.selection.from);
  return { left: c.left, top: c.top, bottom: c.bottom };
};

// Menus use mousedown.preventDefault so the editor keeps its selection while they are open.
function menu(items) {
  const root = el('div', { class: 'menu' });
  for (const item of items) {
    if (item === '-') {
      root.appendChild(el('div', { class: 'menu-sep' }));
      continue;
    }
    const b = el('button', { class: 'menu-item' + (item.active ? ' checked' : '') },
      `<span class="menu-check">${item.active ? '✓' : ''}</span><span class="menu-label ${item.cls || ''}">${item.label}</span><kbd>${item.kbd || ''}</kbd>`);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      closePopover();
      item.run();
    });
    root.appendChild(b);
  }
  return root;
}

function formatMenu(editor) {
  const chain = () => editor.chain().focus();
  return menu([
    { label: 'Body', cls: 'm-body', kbd: '', active: editor.isActive('paragraph') && !editor.isActive('heading'), run: () => chain().setParagraph().run() },
    { label: 'Heading 1', cls: 'm-h1', kbd: '# ', active: editor.isActive('heading', { level: 1 }), run: () => chain().toggleHeading({ level: 1 }).run() },
    { label: 'Heading 2', cls: 'm-h2', kbd: '## ', active: editor.isActive('heading', { level: 2 }), run: () => chain().toggleHeading({ level: 2 }).run() },
    { label: 'Heading 3', cls: 'm-h3', kbd: '### ', active: editor.isActive('heading', { level: 3 }), run: () => chain().toggleHeading({ level: 3 }).run() },
    '-',
    { label: 'Inline Code', kbd: 'Ctrl+E', active: editor.isActive('code'), run: () => chain().toggleCode().run() },
    { label: 'Divider', kbd: '---', run: () => chain().setHorizontalRule().run() },
    '-',
    { label: 'Undo', kbd: 'Ctrl+Z', run: () => chain().undo().run() },
    { label: 'Redo', kbd: 'Ctrl+Shift+Z', run: () => chain().redo().run() },
  ]);
}

function listMenu(editor) {
  const chain = () => editor.chain().focus();
  return menu([
    { label: '• Bulleted List', kbd: '- ', active: editor.isActive('bulletList'), run: () => chain().toggleBulletList().run() },
    { label: '1. Numbered List', kbd: '1. ', active: editor.isActive('orderedList'), run: () => chain().toggleOrderedList().run() },
    { label: '☑ Checklist', kbd: '[] ', active: editor.isActive('taskList'), run: () => chain().toggleTaskList().run() },
    '-',
    { label: 'Indent', kbd: 'Tab', run: () => editor.commands.keyboardShortcut('Tab') },
    { label: 'Outdent', kbd: 'Shift+Tab', run: () => editor.commands.keyboardShortcut('Shift-Tab') },
  ]);
}

function colorMenu(editor) {
  const current = editor.getAttributes('textStyle');
  const root = el('div', { class: 'color-menu' });
  const section = (title, list, isBg) => {
    root.appendChild(el('div', { class: 'menu-title' }, title));
    const row = el('div', { class: 'swatch-row' });
    for (const [name, value] of list) {
      const active = isBg ? (current.backgroundColor ?? null) === value : (current.color ?? null) === value;
      const b = el('button', { class: `color-swatch ${isBg ? 'bg' : 'fg'}${value ? '' : ' none'}${active ? ' active' : ''}`, title: name });
      if (isBg) b.style.setProperty('--sw', value || 'transparent');
      else b.style.setProperty('--sw', value || 'currentColor');
      b.innerHTML = isBg ? 'Aa' : 'A';
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        const c = editor.chain().focus();
        if (isBg) (value ? c.setBackgroundColor(value) : c.unsetBackgroundColor()).run();
        else (value ? c.setColor(value) : c.unsetColor()).run();
        closePopover();
      });
      row.appendChild(b);
    }
    root.appendChild(row);
  };
  section('Text Color', TEXT_COLORS, false);
  section('Highlight Color', HIGHLIGHTS, true);
  return root;
}

/** Ctrl+K: small URL field near the caret. Empty value removes the link. */
export function openLinkEditor(editor, anchor) {
  const prev = editor.getAttributes('link').href || '';
  const root = el('form', { class: 'link-editor' });
  root.innerHTML = `
    <input type="text" placeholder="Paste or type a link…" spellcheck="false" />
    <button type="submit" class="link-apply">${prev ? 'Update' : 'Add'}</button>
    ${prev ? '<button type="button" class="link-remove" title="Remove link">Remove</button>' : ''}`;
  const input = root.querySelector('input');
  input.value = prev;
  let applied = false;

  const apply = (raw) => {
    applied = true;
    const url = raw.trim();
    const chain = editor.chain().focus();
    if (!url) {
      chain.extendMarkRange('link').unsetLink().run();
    } else {
      const href = /^[a-z][\w+.-]*:/i.test(url) ? url : /^[^\s@]+@[^\s@]+$/.test(url) ? `mailto:${url}` : `https://${url}`;
      const { empty } = editor.state.selection;
      if (empty && !editor.isActive('link')) {
        chain.insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href } }] }).unsetMark('link').run();
      } else {
        chain.extendMarkRange('link').setLink({ href }).run();
      }
    }
    closePopover();
  };

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    apply(input.value);
  });
  root.querySelector('.link-remove')?.addEventListener('click', () => apply(''));

  openPopover(anchor ?? caretRect(editor), root, {
    className: 'link-popover',
    onClose: () => {
      if (!applied) editor.commands.focus();
    },
  });
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

export async function insertImageFiles(editor, files, pos) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const src = await api.saveImage(await file.arrayBuffer(), ext);
    const node = { type: 'image', attrs: { src, alt: file.name || '' } };
    if (typeof pos === 'number') {
      editor.chain().focus().insertContentAt(pos, node).run();
      pos = undefined; // following images go after the first one
    } else {
      editor.chain().focus().insertContent(node).run();
    }
  }
}

/**
 * Builds the formatting bar for one note editor. Returns { el, update } — call update()
 * after transactions to refresh active states.
 */
export function createToolbar(editor, { onLink }) {
  const bar = el('div', { class: 'note-toolbar', role: 'toolbar' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  fileInput.addEventListener('change', () => {
    insertImageFiles(editor, [...fileInput.files]);
    fileInput.value = '';
  });

  const buttons = [
    { id: 'bold', html: icons.bold, title: 'Bold (Ctrl+B)', run: () => editor.chain().focus().toggleBold().run(), active: () => editor.isActive('bold') },
    { id: 'italic', html: icons.italic, title: 'Italic (Ctrl+I)', run: () => editor.chain().focus().toggleItalic().run(), active: () => editor.isActive('italic') },
    { id: 'underline', html: icons.underline, title: 'Underline (Ctrl+U)', run: () => editor.chain().focus().toggleUnderline().run(), active: () => editor.isActive('underline') },
    { id: 'strike', html: icons.strike, title: 'Strikethrough (Ctrl+Shift+X)', run: () => editor.chain().focus().toggleStrike().run(), active: () => editor.isActive('strike') },
    '|',
    { id: 'format', html: '<span class="tb-text">Aa</span>', title: 'Text style', menu: () => formatMenu(editor), active: () => editor.isActive('heading') },
    { id: 'list', html: icons.list, title: 'Lists', menu: () => listMenu(editor), active: () => editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList') },
    { id: 'color', html: icons.color, title: 'Text & highlight color', menu: () => colorMenu(editor) },
    '|',
    { id: 'link', html: icons.link, title: 'Link (Ctrl+K)', run: () => onLink(), active: () => editor.isActive('link') },
    { id: 'image', html: icons.image, title: 'Insert image', run: () => fileInput.click() },
    { id: 'callout', html: 'Highlight', cls: 'tb-highlight', title: 'Highlight block as callout (Ctrl+Shift+H)', run: () => editor.chain().focus().toggleCallout().run(), active: () => editor.isActive('callout') },
  ];

  const refs = [];
  for (const def of buttons) {
    if (def === '|') {
      bar.appendChild(el('span', { class: 'tb-sep' }));
      continue;
    }
    const b = el('button', { class: `tb-btn ${def.cls || ''}`, title: def.title, 'aria-label': def.title, dataset: { id: def.id } }, def.html);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (def.menu) {
        if (b.classList.contains('open')) return closePopover();
        b.classList.add('open');
        openPopover(b, def.menu(), { onClose: () => b.classList.remove('open') });
      } else def.run();
    });
    bar.appendChild(b);
    refs.push([b, def]);
  }
  bar.appendChild(fileInput);

  const colorBar = bar.querySelector('.tb-color i');
  function update() {
    for (const [b, def] of refs) if (def.active) b.classList.toggle('active', !!def.active());
    const { color, backgroundColor } = editor.getAttributes('textStyle');
    colorBar.style.background = color || backgroundColor || '';
  }
  update();
  return { el: bar, update };
}
