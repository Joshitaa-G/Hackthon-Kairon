// Step 1: pull raw outcome-candidate posts from Stack Exchange (CC BY-SA) -> data/stories/raw/{type}.jsonl
// Usage: node scripts/fetch-se.js [type ...]     (SE_API_KEY optional; ~300 requests/day without)

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fromRoot } from '../server/paths.js';
import { DECISION_TYPES } from '../server/decisionTypes.js';

const API = 'https://api.stackexchange.com/2.3';
const OUT = fromRoot('data/stories/raw');
const MAX_PER_TYPE = 150;
const PHRASES = ['"looking back"', '"in hindsight"', '"I regret"', '"don\'t regret"', '"years later"', '"I did the same"'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(p, params) {
  if (process.env.SE_API_KEY) params.key = process.env.SE_API_KEY;
  const url = `${API}${p}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.backoff) { console.log(`  backoff ${data.backoff}s`); await sleep(data.backoff * 1000); }
      await sleep(300);
      return data;
    }
    console.log(`  HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
    await sleep(5000 * (attempt + 1));
  }
  throw new Error(`request failed: ${p}`);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
   .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
   .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
const stripHtml = (h) =>
  decode(h.replace(/<(p|br|li|div|blockquote|pre|h\d|tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

async function collectIds(site, keywords) {
  const answers = new Set(), questions = new Set();
  for (const kw of keywords) {
    for (const phrase of PHRASES) {
      const data = await get('/search/excerpts', { q: `${kw} ${phrase}`, site, pagesize: 100, sort: 'relevance', order: 'desc' });
      for (const it of data.items ?? []) (it.item_type === 'answer' ? answers.add(it.answer_id) : questions.add(it.question_id));
      console.log(`  ${site} ${kw} ${phrase}: ${data.items?.length ?? 0} hits (answers ${answers.size}, questions ${questions.size})`);
      if (data.quota_remaining !== undefined && data.quota_remaining < 20) throw new Error('SE quota nearly exhausted');
    }
  }
  return [...[...answers].map((id) => ['answer', id]), ...[...questions].map((id) => ['question', id])];
}

async function fetchBodies(site, kind, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const data = await get(`/${kind}s/${ids.slice(i, i + 100).join(';')}`, { site, filter: 'withbody', pagesize: 100 });
    out.push(...(data.items ?? []));
  }
  return out;
}

await mkdir(OUT, { recursive: true });
const wanted = process.argv.slice(2);
for (const [type, cfg] of Object.entries(DECISION_TYPES)) {
  if (wanted.length && !wanted.includes(type)) continue;
  console.log(`\n== ${type}`);
  const records = [];
  for (const site of cfg.sites) {
    const pairs = (await collectIds(site, cfg.search)).slice(0, Math.ceil(MAX_PER_TYPE / cfg.sites.length));
    for (const kind of ['answer', 'question']) {
      const items = await fetchBodies(site, kind, pairs.filter(([k]) => k === kind).map(([, id]) => id));
      for (const it of items) {
        const pid = it[`${kind}_id`], short = kind === 'answer' ? 'a' : 'q';
        const body = stripHtml(it.body ?? '');
        if (body.length < 200) continue;
        records.push({
          id: `se-${site}-${pid}-${short}`, decision_type: type, site, item_type: kind, post_id: pid,
          title: decode(it.title ?? ''), author: decode(it.owner?.display_name ?? 'anonymous'),
          source_url: `https://${site}.stackexchange.com/${short}/${pid}`,
          score: it.score ?? 0, creation_date: it.creation_date, body, license: 'CC BY-SA 4.0',
        });
      }
    }
  }
  await writeFile(path.join(OUT, `${type}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`  saved ${records.length} posts -> data/stories/raw/${type}.jsonl`);
}
