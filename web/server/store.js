// Local JSON stores: stories with embeddings (data/stories/store.json, built by `npm run ingest`)
// + stories shared in the app (data/stories/user_stories.jsonl, gitignored, merged in at load)
// + Canadian self-employment context (data/stories/context.json).
import { readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { embed } from './embed.js';
import { DECISION_TYPES } from './decisionTypes.js';
import { fromRoot } from './paths.js';

export const STORE_FILE = fromRoot('data/stories/store.json');
const USER_FILE = fromRoot('data/stories/user_stories.jsonl');
const CONTEXT_FILE = fromRoot('data/stories/context.json');

const storyText = (s) => `${s.situation}. ${s.choice}. ${s.outcome}`;

let storePromise, context;
async function readStore() {
  const st = JSON.parse(await readFile(STORE_FILE, 'utf8'));
  // Shared stories never go into store.json (which is committed); they live in the gitignored file.
  st.stories = st.stories.filter((s) => s.source !== 'user');
  if (existsSync(USER_FILE)) {
    const users = (await readFile(USER_FILE, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((s) => DECISION_TYPES[s.decision_type]);
    const missing = users.filter((s) => !Array.isArray(s.embedding));
    if (missing.length) (await embed(missing.map(storyText))).forEach((v, i) => (missing[i].embedding = v));
    st.stories.push(...users);
  }
  return st;
}
export function loadStore() {
  storePromise ??= readStore().catch((e) => { storePromise = undefined; throw e; });
  return storePromise;
}
export async function loadContext() {
  context ??= existsSync(CONTEXT_FILE) ? JSON.parse(await readFile(CONTEXT_FILE, 'utf8')) : [];
  return context;
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export const PROVINCES = ['Newfoundland and Labrador', 'Prince Edward Island', 'Nova Scotia', 'New Brunswick', 'Quebec', 'Ontario', 'Manitoba', 'Saskatchewan', 'Alberta', 'British Columbia'];

const OFF_TOPIC = 0.2; // best MiniLM cosine below this: not one of our decision types at all

/** Classify free text into a decision type: regex fast-path, else local embedding similarity. */
export async function classify(text) {
  const { typeVectors } = await loadStore();
  const hits = Object.entries(DECISION_TYPES)
    .map(([id, t]) => [id, t.keywords.filter((k) => k.test(text)).length])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (hits.length && (hits.length === 1 || hits[0][1] > hits[1][1])) return { type: hits[0][0], confidence: 0.9, alternatives: [] };

  const [qv] = await embed([text]);
  // Keyword tie (e.g. "quit my job and go freelance"): let the embedding pick between the tied types only.
  const tied = hits.filter(([, n]) => n === hits[0]?.[1]).map(([id]) => id);
  const candidates = tied.length ? tied : Object.keys(typeVectors);
  const ranked = candidates.map((id) => [id, dot(qv, typeVectors[id])]).sort((a, b) => b[1] - a[1]);
  const [best] = ranked;
  if (!tied.length && best[1] < OFF_TOPIC) return { type: null, confidence: 0, alternatives: [], score: +best[1].toFixed(3) };
  if (tied.length) return { type: best[0], confidence: 0.8, alternatives: [] };
  const confidence = Math.max(0, Math.min(1, best[1] * 1.6)); // MiniLM cosine of ~0.4+ is a clear match
  return {
    type: best[0], confidence: +confidence.toFixed(2),
    alternatives: confidence < 0.6 ? ranked.slice(0, 2).map(([id]) => id) : [],
  };
}

/** Stories of one decision type ranked by similarity: top K outcome stories + top advice posts. */
export async function retrieveStories(type, question, k = 40, kAdvice = 20) {
  const { stories } = await loadStore();
  const pool = stories.filter((s) => s.decision_type === type);
  const [qv] = await embed([question]);
  const rank = (items, n) =>
    items.map((s) => ({ s, score: dot(qv, s.embedding) })).sort((a, b) => b.score - a.score).slice(0, n);
  const isAdvice = (s) => s.kind === 'advice';
  return [...rank(pool.filter((s) => !isAdvice(s)), k), ...rank(pool.filter(isAdvice), kAdvice)]
    .map(({ s, score }) => ({ ...s, kind: s.kind ?? 'outcome', embedding: undefined, score: +score.toFixed(3) }));
}

export async function selfEmploymentContext(province = 'Canada') {
  const ctx = await loadContext();
  return ctx.find((c) => c.meta.geo === province && c.meta.industry === 'Total employed, all industries')
    ?? ctx.find((c) => c.meta.geo === 'Canada' && c.meta.industry === 'Total employed, all industries') ?? null;
}

const strip = ({ embedding, ...rest }) => rest;

export async function listStories(type) {
  const { stories } = await loadStore();
  return stories.filter((s) => !type || s.decision_type === type).map(strip);
}

export async function getEmbedding(id) {
  const { stories, model } = await loadStore();
  const s = stories.find((x) => x.id === id);
  return s ? { id, model, dim: s.embedding.length, vector: s.embedding } : null;
}

/** Embed a user-submitted story with the local model, add it to the live store, and persist it to the gitignored file. */
export async function addStory(story) {
  const st = await loadStore();
  [story.embedding] = await embed([storyText(story)]);
  await appendFile(USER_FILE, JSON.stringify(story) + '\n'); // survives `npm run ingest`, never committed
  st.stories.push(story);
  return strip(story);
}
