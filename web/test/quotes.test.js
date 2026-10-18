// Quote picker: one quote per author, and at least one regret/mixed voice when the stories have one.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickQuotes } from '../server/report.js';
import { classify, retrieveStories } from '../server/store.js';

const story = (id, author, regret, kind = 'outcome') => ({ id, author, regret, kind, quote: `quote ${id}`, source_url: `https://x.stackexchange.com/a/${id}` });

test('drops a second quote from the same author', () => {
  const stories = [story(1, 'ana', 'no'), story(2, 'ana', 'no'), story(3, 'ben', 'no'), story(4, 'cy', 'no')];
  const q = pickQuotes(stories, [1, 2, 3]);
  const authors = q.map((x) => x.author);
  assert.equal(new Set(authors).size, authors.length);
  assert.deepEqual(authors, ['ana', 'ben', 'cy']);
});

test('adds a regret or mixed quote when the picks are all no-regret', () => {
  const stories = [story(1, 'ana', 'no'), story(2, 'ben', 'no'), story(3, 'cy', 'no'), story(4, 'dee', 'yes')];
  const q = pickQuotes(stories, [1, 2, 3]);
  assert.ok(q.some((x) => x.regret === 'yes'));
  assert.ok(q.length <= 5);
});

test('swaps out a no-regret quote when already at the maximum', () => {
  const stories = [1, 2, 3, 4, 5].map((i) => story(i, `a${i}`, 'no')).concat(story(6, 'z', 'mixed'));
  const q = pickQuotes(stories, [1, 2, 3, 4, 5]);
  assert.equal(q.length, 5);
  assert.ok(q.some((x) => x.regret === 'mixed'));
});

test('advice posts never count as the regret voice, and stay in', () => {
  const stories = [story(1, 'ana', 'no'), story(2, 'ben', null, 'advice'), story(3, 'cy', 'no')];
  const q = pickQuotes(stories, [1, 2, 3]);
  assert.deepEqual(q.map((x) => x.author), ['ana', 'ben', 'cy']); // no regret story exists, so nothing added
});

test('shared stories are all "anonymous" and are not merged into one author', () => {
  const stories = [story(1, 'anonymous', 'no'), story(2, 'anonymous', 'no'), story(3, 'anonymous', 'mixed')];
  assert.equal(pickQuotes(stories, [1, 2, 3]).length, 3);
});

test('unknown quote ids from the LLM are ignored', () => {
  const stories = [story(1, 'ana', 'no'), story(2, 'ben', 'yes')];
  const q = pickQuotes(stories, ['made-up', 1]);
  assert.ok(q.every((x) => [1, 2].includes(x.id)));
});

test('demo question on the real store: distinct authors and a regret or mixed voice', async () => {
  const question = 'Should I leave my PhD for an industry job?';
  const { type } = await classify(question);
  const stories = await retrieveStories(type, question);
  const noRegretIds = stories.filter((s) => s.quote && s.regret === 'no').slice(0, 4).map((s) => s.id); // worst case LLM picks
  const q = pickQuotes(stories, noRegretIds);
  const authors = q.map((x) => x.author);
  assert.equal(new Set(authors).size, authors.length);
  assert.ok(q.some((x) => x.kind !== 'advice' && ['yes', 'mixed'].includes(x.regret)));
});
