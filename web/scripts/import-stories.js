// Import stories extracted by the Python pipeline (../data/stories*.jsonl) into data/stories/stories.jsonl.
// Skips stories already present (same id or source link). Then run `npm run ingest` to re-embed.
// Usage: node scripts/import-stories.js
import { readFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fromRoot } from '../server/paths.js';
import { DECISION_TYPES } from '../server/decisionTypes.js';

const SRC_DIR = fromRoot('..', 'data');
const DEST = fromRoot('data/stories/stories.jsonl');
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const current = readJsonl(DEST);
const ids = new Set(current.map((s) => s.id));
const urls = new Set(current.map((s) => s.source_url));
const files = readdirSync(SRC_DIR).filter((f) => /^stories(\.shard\d+)?\.jsonl$/.test(f));

const added = [];
for (const f of files) {
  for (const { fetched_as, extracted_by, ...s } of readJsonl(path.join(SRC_DIR, f))) {
    if (!s.is_outcome_story || !DECISION_TYPES[s.decision_type] || ids.has(s.id) || urls.has(s.source_url)) continue;
    ids.add(s.id); urls.add(s.source_url);
    added.push({ ...s, source: 'stackexchange', kind: 'outcome' });
  }
}
if (added.length) appendFileSync(DEST, added.map((s) => JSON.stringify(s)).join('\n') + '\n');
const byType = {};
for (const s of added) byType[s.decision_type] = (byType[s.decision_type] ?? 0) + 1;
console.log(`Imported ${added.length} new stories from ${files.join(', ')} (now ${current.length + added.length})`, byType);
