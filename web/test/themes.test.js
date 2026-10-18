// Patterns: every theme must be backed by at least 2 retrieved stories and never state numbers.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanThemes } from '../server/report.js';

const ids = new Set(['a', 'b', 'c', 'd']);

test('keeps themes with 2+ known sources and drops unknown ids', () => {
  const t = cleanThemes({ common: [{ text: 'Many felt lonely at first.', ids: ['a', 'b', 'made-up', 'a'] }] }, ids);
  assert.deepEqual(t.common, [{ text: 'Many felt lonely at first.', ids: ['a', 'b'] }]);
  assert.deepEqual(t.helped, []);
});

test('drops themes backed by fewer than 2 stories', () => {
  assert.equal(cleanThemes({ helped: [{ text: 'Clubs helped.', ids: ['a', 'zzz'] }] }, ids), null);
});

test('drops themes that state numbers or percentages', () => {
  const t = cleanThemes({ common: [{ text: 'Most of them, 70% in fact, regretted it.', ids: ['a', 'b'] }, { text: 'Some people moved abroad.', ids: ['c', 'd'] }, { text: 'They moved twice in 2 years.', ids: ['a', 'c'] }] }, ids);
  assert.deepEqual(t.common.map((x) => x.text), ['Some people moved abroad.']);
});

test('drops overlong text, junk items and keeps at most 3 per group', () => {
  const ok = (n) => ({ text: `Theme ${'x'.repeat(n)}.`, ids: ['a', 'b'] });
  const t = cleanThemes({ differed: [ok(1), ok(2), ok(3), ok(4), { text: 'y'.repeat(300), ids: ['a', 'b'] }, null, 'str', { text: 5, ids: ['a', 'b'] }] }, ids);
  assert.equal(t.differed.length, 3);
});

test('hostile or malformed input returns null', () => {
  for (const bad of [null, 'themes', [], 42, { __proto__: { common: [{ text: 'x', ids: ['a', 'b'] }] } }, { common: 'not a list' }]) {
    assert.equal(cleanThemes(bad, ids), null);
  }
});
