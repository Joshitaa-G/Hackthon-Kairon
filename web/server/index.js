
import express from 'express';
import { loadStore, loadContext, classify, retrieveStories, selfEmploymentContext, listStories, getEmbedding, addStory, PROVINCES, STORE_FILE } from './store.js';
import { DECISION_TYPES, LABELS } from './decisionTypes.js';
import { buildSummary, pickQuotes, countRegret } from './report.js';
import { isUnsafe, SAFETY_MESSAGE } from './safety.js';
import { geminiConfigured } from './gemini.js';
import { embed } from './embed.js';
import { getSettings, saveSettings, maskKey, keyFromEnv } from './settings.js';
import { fromRoot } from './paths.js';
import { QUIZ_OPTIONS, cleanBackground } from './background.js';
import { feedFor } from './feed.js';

const MIN_FOR_PERCENT = 5;
const MAX_QUESTION = 1000;
const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(fromRoot('public')));

app.get('/api/health', async (_req, res) => {
  const s = await loadStore().catch(() => null);
  const perType = {};
  for (const st of s?.stories ?? []) perType[st.decision_type] = (perType[st.decision_type] ?? 0) + 1;
  res.json({
    ok: !!s, stories: s?.stories.length ?? 0, perType, types: LABELS, embeddingModel: s?.model,
    gemini: geminiConfigured(), geminiModel: getSettings().geminiModel, provinces: PROVINCES, quiz: QUIZ_OPTIONS,
  });
});

// Settings: the key is never sent back in full. Saving validates it with a cheap Google call.
const settingsView = () => {
  const s = getSettings();
  return { geminiKeySet: !!s.geminiApiKey, geminiKeyMasked: maskKey(s.geminiApiKey), geminiModel: s.geminiModel, managedByEnv: keyFromEnv() };
};
app.get('/api/settings', (_req, res) => res.json(settingsView()));
app.post('/api/settings', async (req, res) => {
  if (keyFromEnv()) return res.status(403).json({ error: 'The Gemini key is set on the server (GEMINI_API_KEY), so it can only be changed there.' });
  const { geminiApiKey, geminiModel } = req.body ?? {};
  const patch = {};
  if (typeof geminiModel === 'string' && /^[\w.-]{1,60}$/.test(geminiModel.trim())) patch.geminiModel = geminiModel.trim();
  if (typeof geminiApiKey === 'string') {
    const key = geminiApiKey.trim();
    if (key) {
      const check = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } }).catch(() => null);
      if (check && !check.ok) return res.status(400).json({ error: 'Google rejected that API key. Check it and try again.' });
    }
    patch.geminiApiKey = key; // empty string clears it
  }
  saveSettings(patch);
  res.json(settingsView());
});

// Hindsight Report: classify -> filter by decision type -> rank by similarity -> count in code -> summarise -> pull quotes by ID.
app.post('/api/report', async (req, res) => {
  const { question, type: forced, province } = req.body ?? {};
  if (typeof question !== 'string' || !question.trim()) return res.status(400).json({ error: 'question is required' });
  if (question.length > MAX_QUESTION) return res.status(400).json({ error: `Keep the question under ${MAX_QUESTION} characters.` });
  if (isUnsafe(question)) return res.json({ safety: SAFETY_MESSAGE });
  const match = typeof forced === 'string' && Object.hasOwn(DECISION_TYPES, forced)
    ? { type: forced, confidence: 1, alternatives: [] } : await classify(question);
  if (!match.type) {
    return res.json({ offTopic: true, message: "Did you mean one of these? That question isn't one of the decisions Been There covers yet.", alternatives: Object.entries(LABELS).map(([id, label]) => ({ id, label })) });
  }
  if (match.alternatives.length) {
    return res.json({ needsChoice: true, alternatives: match.alternatives.map((id) => ({ id, label: LABELS[id] })) });
  }
  const stories = await retrieveStories(match.type, question);
  const outcomes = stories.filter((s) => s.kind !== 'advice');
  const counts = countRegret(outcomes);
  const summary = await buildSummary(match.type, stories);
  res.json({
    type: match.type, label: LABELS[match.type], confidence: match.confidence,
    story_count: outcomes.length, advice_count: stories.length - outcomes.length, regret: counts, show_percentages: outcomes.length >= MIN_FOR_PERCENT,
    top_reasons: summary.top_reasons, top_advice: summary.top_advice, no_regret_pattern: summary.no_regret_pattern, no_regret_advice: summary.no_regret_advice,
    quotes: pickQuotes(stories, summary.quote_ids),
    // Full experiences, closest first: what each person faced, chose, and what happened — not just the regret label.
    experiences: outcomes.map(({ id, regret, situation, choice, outcome, main_reason, advice, years_later, age_at_decision, author, source_url, site, source }) =>
      ({ id, regret, situation, choice, outcome, main_reason, advice, years_later, age_at_decision, author, source_url, site, source })),
    ai_summary: summary.llm, warning: summary.warning,
    canada_context: match.type === 'go_freelance' ? (await selfEmploymentContext(typeof province === 'string' ? province : undefined))?.text ?? null : null,
    context_source: 'Statistics Canada, Labour Force Survey, Table 14-10-0027-01',
  });
});

// For-you feed: only the generation comes in (Gen Z, Millennial, ...), never the exact age.
app.get('/api/feed', async (req, res) => res.json(await feedFor(typeof req.query.generation === 'string' ? req.query.generation : '')));

// Browse stored stories, inspect a story's embedding, and add a new story (embedded locally on arrival).
app.get('/api/stories', async (req, res) => res.json(await listStories(typeof req.query.type === 'string' ? req.query.type : '')));
app.get('/api/stories/:id/embedding', async (req, res) => {
  const e = await getEmbedding(req.params.id);
  e ? res.json(e) : res.status(404).json({ error: 'story not found' });
});

// Shared stories are anonymous: no name is stored, and contact details are scrubbed from the text.
const scrub = (s) => s
  .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email removed]')
  .replace(/\b(https?:\/\/|www\.)\S+/gi, '[link removed]')
  .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 10 ? '[number removed]' : m)) // phone numbers, not "2015-2020"
  .replace(/(^|\s)@\w{2,}/g, '$1[handle removed]');
const text = (v, max) => (typeof v === 'string' ? scrub(v.trim().slice(0, max)) : '');
const num = (v, lo, hi) => (v === '' || v == null || !Number.isFinite(+v) || +v < lo || +v > hi ? null : Math.round(+v));
app.post('/api/stories', async (req, res) => {
  const b = req.body ?? {};
  const kind = b.kind === 'advice' ? 'advice' : 'outcome';
  const story = {
    decision_type: b.decision_type, situation: text(b.situation, 300), choice: text(b.choice, 300), outcome: text(b.outcome, 400),
    regret: b.regret, main_reason: text(b.main_reason, 200), advice: text(b.advice, 300),
    years_later: num(b.years_later, 0, 60), age_at_decision: num(b.age_at_decision, 10, 100), quote: text(b.quote, 300),
  };
  if (typeof story.decision_type !== 'string' || !Object.hasOwn(DECISION_TYPES, story.decision_type)) return res.status(400).json({ error: 'Pick a decision type.' });
  if (kind === 'advice') {
    story.regret = null; // advice is never counted in the regret split
    if (!story.situation || !story.advice) return res.status(400).json({ error: 'Describe the situation and give your advice.' });
  } else {
    if (!['yes', 'mixed', 'no'].includes(story.regret)) return res.status(400).json({ error: 'Say whether you regret it.' });
    if (!story.situation || !story.choice || !story.outcome) return res.status(400).json({ error: 'Situation, choice and outcome are required.' });
  }
  if (isUnsafe(Object.values(story).join(' '))) return res.json({ safety: SAFETY_MESSAGE });
  const saved = await addStory({
    id: `user-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, is_outcome_story: kind === 'outcome', kind, ...story,
    source_url: '', author: 'anonymous', site: 'community', license: 'Shared by a user', source: 'user',
    background: cleanBackground(b.background), // coarse quiz answers only, for a later "people like you" filter
  });
  res.json({ ok: true, story: saved, total: (await loadStore()).stories.length });
});

// Errors come back as JSON without stack traces or file paths (bad JSON bodies included).
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, _req, res, _next) => {
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status < 500 ? 'Bad request.' : 'Something went wrong on the server.' });
});

// Local-only by default so nobody else on the network can change the key or add stories. Set HOST=0.0.0.0 to deploy.
const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
await loadStore().catch(() => console.warn(`! ${STORE_FILE} missing — run \`npm run ingest\``));
await loadContext();
await embed(['warm up']);
app.listen(port, host, () => console.log(`Been There (Node) → http://localhost:${port}`));
