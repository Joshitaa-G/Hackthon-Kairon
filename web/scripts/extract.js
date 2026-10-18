// Step 2: one Gemini call per raw post -> structured outcome story. Resumable.
// Usage: node scripts/extract.js [--limit N]        Needs a Gemini key saved in the app's Settings (free tier). Output: data/stories/stories.jsonl

import { readFile, readdir, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fromRoot } from '../server/paths.js';
import { DECISION_TYPES } from '../server/decisionTypes.js';
import { geminiJson, geminiConfigured } from '../server/gemini.js';
import { getSettings } from '../server/settings.js';

if (!geminiConfigured()) { console.error('Save your Gemini API key in the app Settings first (npm start -> gear icon).'); process.exit(1); }

const RAW = fromRoot('data/stories/raw');
const STORIES = fromRoot('data/stories/stories.jsonl');
const SKIPPED = fromRoot('data/stories/extract_skipped.jsonl');
const MODEL = process.env.EXTRACT_MODEL || getSettings().geminiModel;
const RPM = +(process.env.LLM_RPM || 12);
const MAX_BODY = 4000;
const limit = +(process.argv[process.argv.indexOf('--limit') + 1] || 0) || Infinity;

const SYSTEM = (about) => `You extract structured outcomes from a single forum post.
Set is_outcome_story true ONLY if the author describes a decision they personally made about ${about} AND what happened afterward. Advice without a personal outcome, hypotheticals, other people's stories, and questions are false. A decision on a different topic is false.
If false, return {"is_outcome_story": false} and nothing else.
If true, fill every field:
- situation, choice, outcome, main_reason, advice: short plain sentences (max 25 words each), third person, based only on the post.
- regret: "yes" if they say they regret it or wish they had chosen differently, "no" if they say they are glad or don't regret it, "mixed" otherwise.
- years_later: years between the decision and the time of writing, or null if not stated.
- age_at_decision: their age when they decided, or null if not stated.
- quote: one or two sentences copied EXACTLY, character for character, from the post that best show the outcome (max 300 characters), or "" if none.
Never invent details. Use null for anything not stated.
JSON keys: is_outcome_story, situation, choice, outcome, regret, main_reason, advice, years_later, age_at_decision, quote.`;

const readJsonl = async (f) => (existsSync(f) ? (await readFile(f, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(path.dirname(STORIES), { recursive: true });
const done = new Set([...(await readJsonl(STORIES)), ...(await readJsonl(SKIPPED))].map((r) => r.id));
const todo = [];
for (const f of (await readdir(RAW)).filter((n) => n.endsWith('.jsonl')).sort())
  for (const p of await readJsonl(path.join(RAW, f)))
    if (!done.has(p.id) && DECISION_TYPES[p.decision_type]) { done.add(p.id); todo.push(p); }
todo.length = Math.min(todo.length, limit);
console.log(`${todo.length} posts to extract with ${MODEL}`);

let kept = 0, skipped = 0, failed = 0;
for (const [i, post] of todo.entries()) {
  const t0 = Date.now();
  try {
    const user = `${post.title ? `Question title: ${post.title}\n` : ''}Post:\n${post.body.slice(0, MAX_BODY)}`;
    const ex = await geminiJson({ system: SYSTEM(DECISION_TYPES[post.decision_type].about), user, model: MODEL });
    if (ex.is_outcome_story && ex.outcome) {
      const quote = (ex.quote ?? '').trim();
      const story = {
        id: post.id, decision_type: post.decision_type, is_outcome_story: true,
        situation: ex.situation ?? '', choice: ex.choice ?? '', outcome: ex.outcome,
        regret: ['yes', 'mixed', 'no'].includes(ex.regret) ? ex.regret : 'mixed',
        main_reason: ex.main_reason ?? '', advice: ex.advice ?? '',
        years_later: Number.isFinite(+ex.years_later) && ex.years_later !== null ? Math.round(+ex.years_later) : null,
        age_at_decision: Number.isFinite(+ex.age_at_decision) && ex.age_at_decision !== null ? Math.round(+ex.age_at_decision) : null,
        quote: quote && post.body.includes(quote) ? quote : '', // must be verbatim, else drop the quote
        source_url: post.source_url, author: post.author, site: post.site, license: post.license, source: 'stackexchange',
      };
      await appendFile(STORIES, JSON.stringify(story) + '\n');
      kept++;
      console.log(`[${i + 1}/${todo.length}] ${post.id} KEEP regret=${story.regret} quote=${story.quote ? 'yes' : 'no'}`);
    } else {
      await appendFile(SKIPPED, JSON.stringify({ id: post.id, decision_type: post.decision_type }) + '\n');
      skipped++;
      console.log(`[${i + 1}/${todo.length}] ${post.id} skip`);
    }
  } catch (e) {
    if (e.daily) { console.log(`\nDaily limit reached after ${i} posts. Rerun later; it resumes.`); break; }
    failed++;
    console.log(`[${i + 1}/${todo.length}] ${post.id} FAILED: ${e.message.slice(0, 150)}`);
    if (e.status === 429) await sleep(30000);
  }
  await sleep(Math.max(0, 60000 / RPM - (Date.now() - t0)));
}
console.log(`\nThis run: kept ${kept}, skipped ${skipped}, failed ${failed} (failed posts retry next run)`);
