// Step 3: embed stories locally -> data/stories/store.json
// Real stories (data/stories/stories.jsonl) are used when present; mock fixtures only with --mock.
// Stories shared in the app stay in data/stories/user_stories.jsonl (gitignored); the server merges them in at load.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { embed, EMBED_MODEL } from '../server/embed.js';
import { DECISION_TYPES } from '../server/decisionTypes.js';
import { fromRoot } from '../server/paths.js';

const readJsonl = async (f) => (existsSync(f) ? (await readFile(f, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const useMock = process.argv.includes('--mock');

let stories = await readJsonl(fromRoot('data/stories/stories.jsonl'));
if (useMock || !stories.length) {
  console.log('Using MOCK fixtures (not real data — dev only).');
  stories = [...stories, ...(await readJsonl(fromRoot('data/stories/mock_stories.jsonl')))];
}
stories = stories.filter((s) => (s.is_outcome_story || s.kind === 'advice') && DECISION_TYPES[s.decision_type] && s.source !== 'user');
for (const s of stories) s.kind ??= 'outcome';

const storyText = (s) => `${s.situation}. ${s.choice}. ${s.outcome}`;
for (let i = 0; i < stories.length; i += 32) {
  const slice = stories.slice(i, i + 32);
  (await embed(slice.map(storyText))).forEach((v, j) => (slice[j].embedding = v));
  process.stdout.write(`\r  embedded ${Math.min(i + 32, stories.length)}/${stories.length}`);
}
const types = Object.keys(DECISION_TYPES);
const typeVecs = await embed(types.map((t) => DECISION_TYPES[t].description));
const typeVectors = Object.fromEntries(types.map((t, i) => [t, typeVecs[i]]));

await writeFile(fromRoot('data/stories/store.json'), JSON.stringify({
  model: EMBED_MODEL, createdAt: new Date().toISOString(), mock: stories.some((s) => s.source === 'mock'), stories, typeVectors,
}));
console.log(`\nWrote data/stories/store.json: ${stories.length} stories`);
const counts = {};
for (const s of stories) (counts[s.decision_type] ??= { outcome: 0, advice: 0 })[s.kind]++;
console.table(counts);
