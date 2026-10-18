// "For you" feed: stories picked for the reader's generation, which the background quiz works out from their age.
// Only the generation reaches the server (never the exact age). Gender and ethnicity are never used: the stories
// don't record them, and CLAUDE.md §9 rules out "people like you" claims about groups.
import { loadStore } from './store.js';
import { embed } from './embed.js';
import { LABELS } from './decisionTypes.js';

// One feed per generation: which decisions come first, and a persona the stories are ranked against.
export const GENERATIONS = {
  'Gen Alpha': {
    label: 'still in school and starting to think about what comes next',
    persona: 'A middle or high school student thinking about what to study after school and what kind of work they might want.',
    types: ['switch_major', 'grad_vs_work'],
  },
  'Gen Z': {
    label: 'in school or just starting out',
    persona: 'A high school or university student or new graduate deciding what to study, whether to switch majors, go to grad school, start working or leave a first job.',
    types: ['switch_major', 'grad_vs_work', 'quit_job', 'career_change'],
  },
  Millennial: {
    label: 'building a career',
    persona: 'A professional in their thirties or early forties deciding whether to change careers, leave a job, go back to school or go freelance.',
    types: ['career_change', 'quit_job', 'go_freelance', 'grad_vs_work'],
  },
  'Gen X': {
    label: 'deep into a career',
    persona: 'An experienced professional in their late forties or fifties deciding whether to change careers, become self-employed or leave a long-held job.',
    types: ['career_change', 'go_freelance', 'quit_job'],
  },
  Boomer: {
    label: 'late career or looking back',
    persona: 'Someone near or past retirement age deciding whether to leave a long career, consult on their own terms, or start something new.',
    types: ['quit_job', 'go_freelance', 'career_change'],
  },
};
const ALIASES = { 'Silent Generation': 'Boomer' };
const GENERAL = { label: '', persona: 'Someone weighing a big education or career decision.', types: Object.keys(LABELS) };

// A starter question per type, used when the reader taps a topic in the feed.
export const STARTERS = {
  switch_major: 'Should I switch my major?',
  grad_vs_work: 'Should I go to grad school or start working?',
  quit_job: 'Should I quit my job?',
  career_change: 'Should I change careers?',
  go_freelance: 'Should I go freelance?',
};

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const personaVectors = new Map();
async function personaVector(persona) {
  if (!personaVectors.has(persona)) personaVectors.set(persona, (await embed([persona]))[0]);
  return personaVectors.get(persona);
}

/** Outcome stories for a generation: each topic ranked by similarity to its persona, then interleaved so topics alternate. */
export async function feedFor(generation, limit = 30) {
  const name = Object.hasOwn(ALIASES, generation) ? ALIASES[generation] : generation;
  const known = Object.hasOwn(GENERATIONS, name);
  const g = known ? GENERATIONS[name] : GENERAL;
  const { stories } = await loadStore();
  const pv = await personaVector(g.persona);
  const byType = g.types.map((type) => stories
    .filter((s) => s.decision_type === type && s.kind !== 'advice')
    .map((s) => ({ s, score: dot(pv, s.embedding) }))
    .sort((a, b) => b.score - a.score));
  const items = [];
  for (let i = 0; items.length < limit && byType.some((list) => i < list.length); i++) {
    for (const list of byType) if (i < list.length && items.length < limit) items.push(list[i].s);
  }
  return {
    generation: known ? name : null,
    stageLabel: g.label,
    generations: Object.keys(GENERATIONS),
    topics: g.types.map((type, i) => ({ type, label: LABELS[type], count: byType[i].length, question: STARTERS[type] })),
    items: items.map(({ id, decision_type, regret, situation, choice, outcome, main_reason, advice, years_later, age_at_decision, author, source_url, site, source }) =>
      ({ id, decision_type, label: LABELS[decision_type], regret, situation, choice, outcome, main_reason, advice, years_later, age_at_decision, author, source_url, site, source })),
  };
}
