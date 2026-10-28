// Generates src/emoji-data.json — a slim emoji list (Unicode <= 15) that renders with Segoe UI Emoji.
import { readFileSync, writeFileSync } from 'node:fs';

const compact = JSON.parse(readFileSync('node_modules/emojibase-data/en/compact.json', 'utf8'));
const full = JSON.parse(readFileSync('node_modules/emojibase-data/en/data.json', 'utf8'));
const version = new Map(full.map((e) => [e.hexcode, e.version]));

const out = compact
  .filter((e) => e.group !== undefined && e.group !== 2 && (version.get(e.hexcode) ?? 99) <= 15)
  .sort((a, b) => a.order - b.order)
  .map((e) => [e.unicode, e.group, [e.label, ...(e.tags || [])].join(' ')]);

writeFileSync('src/emoji-data.json', JSON.stringify(out));
console.log(`wrote ${out.length} emoji`);
