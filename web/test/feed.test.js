// For-you feed: picked by generation only, topics alternate, and unknown values fall back safely.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedFor, GENERATIONS } from '../server/feed.js';

for (const [name, g] of Object.entries(GENERATIONS)) {
  test(`${name} feed only shows its decision types, interleaved, outcomes only`, async () => {
    const f = await feedFor(name);
    assert.equal(f.generation, name);
    assert.deepEqual(f.topics.map((t) => t.type), g.types);
    assert.ok(f.items.length > 0 && f.items.length <= 30);
    assert.ok(f.items.every((s) => g.types.includes(s.decision_type) && s.regret));
    const firstTypes = f.items.slice(0, g.types.length).map((s) => s.decision_type);
    assert.deepEqual(firstTypes, g.types.filter((t) => f.topics.find((x) => x.type === t).count > 0));
    assert.ok(f.items.every((s) => s.embedding === undefined && s.label));
  });
}

test('Gen Z sees choosing a major first; Millennials see changing careers first', async () => {
  assert.equal((await feedFor('Gen Z')).items[0].decision_type, 'switch_major');
  assert.equal((await feedFor('Millennial')).items[0].decision_type, 'career_change');
});

test('Silent Generation gets the Boomer feed', async () => {
  assert.equal((await feedFor('Silent Generation')).generation, 'Boomer');
});

test('unknown or hostile values fall back to a general feed', async () => {
  for (const bad of ['', 'Gen Q', '__proto__', 'toString']) {
    const f = await feedFor(bad);
    assert.equal(f.generation, null);
    assert.ok(f.items.length > 0);
  }
});
