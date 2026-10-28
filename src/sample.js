import { uid, dayKey } from './store.js';

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKey(d);
};

const task = (title, priority, tag, done = false) => ({ id: uid(), title, priority, tag, done, createdAt: Date.now() });

export function sampleData() {
  const now = Date.now();
  return {
    version: 1,
    recentEmoji: ['📌', '✅', '💡', '🔥', '🎯', '🚀'],
    days: {
      [daysAgo(2)]: [
        task('Draft Q4 roadmap outline', 'A', 'urgent', true),
        task('Sync with design team', 'B', 'today', true),
        task('Collect glass material references', 'C', '', false),
      ],
      [daysAgo(1)]: [
        task('Prototype horizontal card strip', 'A', 'urgent', true),
        task('Pick Apple pastel note palette', 'B', 'today', true),
        task('Write emoji picker spec', 'B', 'today', true),
        task('Review onboarding copy', 'C', '', false),
      ],
      [dayKey()]: [
        task('Review VisionOS UI Kit', 'A', 'today', true),
        task('Optimize Glassmorphism performance', 'A', 'urgent', true),
        task('Test dual Split View layout', 'B', 'urgent'),
        task('Export Product Specs & Design Tokens', 'C', 'today'),
      ],
    },
    notes: [
      {
        id: uid(),
        color: 'yellow',
        pinned: false,
        createdAt: now,
        updatedAt: now,
        doc: null,
        html: `
          <h2>UI/UX Q4 Release Strategy</h2>
          <p>Modal system and task lists synced seamlessly with VisionOS experience:</p>
          <ul>
            <li><p>Liquid Glass blur effect at 480px on all sizes.</p></li>
            <li><p>Shift + Mouse Wheel smooth horizontal scroll between cards.</p></li>
            <li><p>Pastel natural palette to enhance Deep Work focus.</p></li>
          </ul>
          <div data-callout data-emoji="📌"><div class="callout-content">
            <p><strong>Test Note:</strong><br>Check toggle between Tasks only, Split view, and Notes only.</p>
          </div></div>
          <p></p>`,
      },
      {
        id: uid(),
        color: 'blue',
        pinned: false,
        createdAt: now,
        updatedAt: now,
        doc: null,
        html: `
          <h2>Keyboard Cheatsheet ⌨️</h2>
          <p>Everything below works in any note — try it right here.</p>
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="true"><p>Press <code>Ctrl + '</code> to open the emoji picker 😄</p></li>
            <li data-type="taskItem" data-checked="false"><p>Select some lines and press <strong>Highlight</strong> (<code>Ctrl+Shift+H</code>)</p></li>
            <li data-type="taskItem" data-checked="false"><p>Paste or drag an image in, then drag its corner to resize</p></li>
          </ul>
          <h3>Markdown shortcuts</h3>
          <ol>
            <li><p><code># </code> <code>## </code> <code>### </code> → headings</p></li>
            <li><p><code>- </code> bullets, <code>1. </code> numbers, <code>[] </code> checklist</p></li>
            <li><p><code>---</code> → divider, <code>Tab</code> / <code>Shift+Tab</code> → indent</p></li>
          </ol>
          <hr>
          <p><strong>Ctrl+B</strong> bold · <em>Ctrl+I</em> italic · <u>Ctrl+U</u> underline · <s>Ctrl+Shift+X</s> strike · <code>Ctrl+E</code> code · Ctrl+K link</p>
          <p>Global hotkey <strong>Ctrl+Alt+N</strong> shows / hides this window. Visit <a href="https://developer.apple.com/design/human-interface-guidelines/">Apple HIG</a>.</p>`,
      },
    ],
  };
}
