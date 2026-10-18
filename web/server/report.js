// Hindsight Report: counts are computed in code; the LLM only summarises and picks story IDs; quotes come from the DB.
import { createHash } from 'node:crypto';
import { geminiConfigured, geminiJson } from './gemini.js';

const SYSTEM = `You are given real stories and advice posts as JSON with ids. Items with kind "advice" are advice from experienced people (no regret label); kind "outcome" are personal decision stories. Write the 3 most common reasons for regret or no regret, the 3 most common pieces of advice, and one sentence on what people who did not regret it did differently. Use only these stories. Return quote_ids (3-5) of the most representative stories that have a quote. Do not write numbers or percentages. Do not quote text yourself.
Return JSON: {"top_reasons": [3 short strings], "top_advice": [3 short strings], "no_regret_pattern": "one sentence", "quote_ids": [ids]}`;

const cache = new Map();

export function countRegret(stories) {
  const c = { yes: 0, mixed: 0, no: 0 };
  for (const s of stories) if (s.kind !== 'advice' && s.regret in c) c[s.regret]++; // advice posts are never counted
  return c;
}

// Non-LLM fallback: most similar stories' own reason/advice, verbatim. Without an LLM we can't
// claim a "pattern", so no-regret advice is listed as separate voices, not repeated in top advice.
function fallbackSummary(stories) {
  const uniq = (key, list, skip = new Set()) => [...new Set(list.map((s) => s[key]).filter((x) => x && !skip.has(x)))].slice(0, 3);
  const outcomes = stories.filter((s) => s.kind !== 'advice');
  const noRegretAdvice = uniq('advice', outcomes.filter((s) => s.regret === 'no'));
  return {
    top_reasons: uniq('main_reason', outcomes), top_advice: uniq('advice', stories, new Set(noRegretAdvice)),
    no_regret_pattern: '', no_regret_advice: noRegretAdvice,
    quote_ids: [...outcomes.filter((s) => s.quote).slice(0, 3), ...stories.filter((s) => s.kind === 'advice' && s.quote).slice(0, 1)].map((s) => s.id),
    llm: false,
  };
}

export async function buildSummary(type, stories) {
  if (!stories.length) return { top_reasons: [], top_advice: [], no_regret_pattern: '', no_regret_advice: [], quote_ids: [], llm: false };
  if (!geminiConfigured()) return fallbackSummary(stories);

  const key = createHash('sha1').update(type + stories.map((s) => s.id).join()).digest('hex');
  if (cache.has(key)) return cache.get(key);
  try {
    const compact = stories.map(({ id, kind, regret, situation, choice, outcome, main_reason, advice, quote }) =>
      ({ id, kind, regret, situation, choice, outcome, main_reason, advice, has_quote: !!quote }));
    const out = await geminiJson({ system: SYSTEM, user: JSON.stringify(compact) });
    const ids = new Set(stories.map((s) => s.id));
    const arr = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 3) : []);
    const summary = {
      top_reasons: arr(out.top_reasons), top_advice: arr(out.top_advice),
      no_regret_pattern: typeof out.no_regret_pattern === 'string' ? out.no_regret_pattern : '', no_regret_advice: [],
      quote_ids: (out.quote_ids ?? []).filter((id) => ids.has(id)), // drop IDs not in the retrieved set
      llm: true,
    };
    cache.set(key, summary);
    return summary;
  } catch (e) {
    return { ...fallbackSummary(stories), warning: e.status === 429 ? 'Gemini rate limit hit — showing story excerpts instead of an AI summary.' : `Gemini error: ${e.message}` };
  }
}

// Quotes: the LLM's picks first, then the closest stories. One quote per author (shared stories are all
// "anonymous", so they don't count as one author), and if any regret or mixed story has a quote, at least one
// of them is shown so the voices aren't all one-sided.
export function pickQuotes(stories, quoteIds, max = 5) {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const preferred = quoteIds.map((id) => byId.get(id)).filter((s) => s?.quote);
  const pool = [...new Set([...preferred, ...stories.filter((s) => s.quote)])];
  const target = Math.min(max, Math.max(3, preferred.length));
  const isDoubtful = (s) => s.kind !== 'advice' && (s.regret === 'yes' || s.regret === 'mixed');

  const picked = [];
  const authors = new Set();
  const fresh = (s) => !picked.includes(s) && (s.author === 'anonymous' || !authors.has(s.author));
  const take = (s) => { picked.push(s); authors.add(s.author); };
  for (const s of pool) if (picked.length < target && fresh(s)) take(s);

  if (!picked.some(isDoubtful)) {
    const doubtful = pool.find((s) => isDoubtful(s) && fresh(s));
    if (doubtful) {
      if (picked.length >= target) { // make room by dropping the last no-regret outcome (advice voices stay)
        const i = picked.findLastIndex((s) => s.kind !== 'advice' && s.regret === 'no');
        if (i >= 0) { authors.delete(picked[i].author); picked.splice(i, 1); }
      }
      if (picked.length < max) take(doubtful);
    }
  }
  return picked.map((s) => ({ id: s.id, text: s.quote, author: s.author, source_url: s.source_url, regret: s.regret, kind: s.kind ?? 'outcome', site: s.site }));
}
