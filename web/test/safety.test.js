// Safety harness: crisis wording must route to support resources; ordinary career wording must not.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnsafe, SAFETY_MESSAGE } from '../server/safety.js';
import { cleanBackground } from '../server/background.js';

const MUST_ROUTE = [
  'I want to hurt myself',
  'I want to kill myself',
  'I feel suicidal about my job',
  'I want to end my life',
  'sometimes I think about ending it all',
  "I don't want to live anymore",
  'I have been self-harming since I failed my exams',
  'I keep cutting myself',
  'I thought about an overdose',
  'my dad hits me when I talk about quitting school',
  'I am being abused at home',
  'I am not safe at home',
];

const MUST_NOT_ROUTE = [
  'Should I end my PhD early and take an industry job?',
  'Should I quit my job because my boss is abusive?',
  'This commute is going to kill me, should I quit?',
  'Is it worth changing careers into software at 30?',
  'Should I end my contract early?',
  'My manager hurts my career by taking credit for my work',
  'Will switching majors kill my GPA?',
];

for (const text of MUST_ROUTE) {
  test(`routes to safety: "${text}"`, () => assert.equal(isUnsafe(text), true));
}
for (const text of MUST_NOT_ROUTE) {
  test(`gets a normal report: "${text}"`, () => assert.equal(isUnsafe(text), false));
}

test('safety message lists 9-8-8, Kids Help Phone and 9-1-1', () => {
  const all = SAFETY_MESSAGE.resources.join(' ');
  for (const line of ['9-8-8', '1-800-668-6868', '686868', '9-1-1']) assert.ok(all.includes(line), line);
});

test('shared-story background keeps only fixed values (no age, city or free text)', () => {
  const out = cleanBackground({
    generation: 'Gen Z', gender: 'woman', country: 'Canada', region: 'Toronto',
    ethnicity: ['south_asian', 'my own words', '__proto__'], age: 18, genderSelf: 'secret',
  });
  assert.deepEqual(out, { generation: 'Gen Z', gender: 'woman', country: 'Canada', ethnicity: ['south_asian'] });
  assert.equal(cleanBackground('junk'), null);
  assert.equal(cleanBackground({ gender: 'toString' }), null);
});
