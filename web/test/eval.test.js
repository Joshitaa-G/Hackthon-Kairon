// Eval on the real curated store (no LLM, no training): classifier accuracy on labelled questions, retrieval
// invariants, and the demo path. Needs data/stories/store.json and the local embedding model (npm install).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, retrieveStories, loadStore } from '../server/store.js';
import { countRegret } from '../server/report.js';

// [question, expected decision type]. null means off-topic: no report, or a choice between types.
const LABELLED = [
  ['Should I quit my job without another one lined up?', 'quit_job'],
  ['Should I resign from my toxic workplace?', 'quit_job'],
  ['Would quitting be a major mistake?', 'quit_job'],
  ['Should I quit my job because my boss is abusive?', 'quit_job'],
  ['Is it worth changing careers into software at 30?', 'career_change'],
  ['Should I do a coding bootcamp to switch careers?', 'career_change'],
  ['Should I leave teaching for a new career in UX?', 'career_change'],
  ['Should I leave my PhD for an industry job?', 'grad_vs_work'],
  ["Should I do a master's degree or start working right away?", 'grad_vs_work'],
  ['Should I end my PhD early and take an industry job?', 'grad_vs_work'],
  ['Is grad school worth it or should I get a job?', 'grad_vs_work'],
  ['Should I switch my major from biology to computer science?', 'switch_major'],
  ['I want to change my program from engineering to business', 'switch_major'],
  ['Is majoring in philosophy a mistake?', 'switch_major'],
  ['Should I quit my job and go freelance as a designer?', 'go_freelance'],
  ['Should I become self-employed as a consultant?', 'go_freelance'],
  ['Should I start my own business instead of working for someone?', 'go_freelance'],
  ['What toppings go on pizza?', null],
];
const MIN_ACCURACY = 0.9;

test(`classifier accuracy >= ${MIN_ACCURACY * 100}% on ${LABELLED.length} labelled questions`, async () => {
  const misses = [];
  for (const [q, expected] of LABELLED) {
    const m = await classify(q);
    const got = m.alternatives.length ? null : m.type; // asking the user to pick counts as "not decided"
    if (got !== expected) misses.push(`${q} -> ${got ?? `choice of ${m.alternatives}`} (want ${expected})`);
  }
  const acc = 1 - misses.length / LABELLED.length;
  console.log(`classifier accuracy ${(acc * 100).toFixed(0)}% (${LABELLED.length - misses.length}/${LABELLED.length})${misses.length ? '\n  ' + misses.join('\n  ') : ''}`);
  assert.ok(acc >= MIN_ACCURACY, misses.join('\n'));
});

test('retrieval returns only the requested type, sorted by similarity, top-k respected', async () => {
  for (const type of ['quit_job', 'grad_vs_work', 'career_change']) {
    const got = await retrieveStories(type, 'should I do it', 10, 5);
    const outcomes = got.filter((s) => s.kind !== 'advice');
    assert.ok(got.every((s) => s.decision_type === type));
    assert.ok(outcomes.length <= 10);
    for (let i = 1; i < outcomes.length; i++) assert.ok(outcomes[i - 1].score >= outcomes[i].score);
    assert.ok(got.every((s) => s.embedding === undefined), 'embeddings are not sent out');
  }
});

test('store holds no shared user stories and no mock fixtures', async () => {
  const { stories, mock } = await loadStore();
  assert.equal(mock, false);
  assert.ok(stories.every((s) => s.source !== 'mock' && !String(s.id).startsWith('mock-')));
});

test('every quote and experience in the store links to its source', async () => {
  const { stories } = await loadStore();
  for (const s of stories.filter((x) => x.source === 'stackexchange')) {
    assert.match(s.source_url, /^https:\/\/\w+\.stackexchange\.com\/[aq]\/\d+$/, s.id);
    assert.ok(s.author, s.id);
  }
});

test('demo question: enough stories for percentages, counts add up, all three outcomes present', async () => {
  const q = 'Should I leave my PhD for an industry job?';
  const m = await classify(q);
  const outcomes = (await retrieveStories(m.type, q)).filter((s) => s.kind !== 'advice');
  const c = countRegret(outcomes);
  assert.ok(outcomes.length >= 5);
  assert.equal(c.yes + c.mixed + c.no, outcomes.length);
  assert.ok(c.yes > 0 && c.mixed > 0 && c.no > 0);
});
