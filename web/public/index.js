const $ = (id) => document.getElementById(id);
const esc = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Demo default: the question with the richest curated data (40 stories, 14 advice posts, all three outcomes).
// The page opens on this report; add ?nodemo to the URL to start blank.
const DEMO = 'Should I leave my PhD for an industry job?';
const EXAMPLES = [
  'Should I quit my job without another one lined up?',
  'Is it worth changing careers into software at 30?',
  'Should I switch my major from biology to computer science?',
  'Should I quit my job and go freelance as a designer?',
];
const REGRET_LABEL = { no: 'No regret', mixed: 'Mixed', yes: 'Regrets it' };

function experienceCard(e) {
  const when = [e.age_at_decision != null && `age ${e.age_at_decision} at the time`, e.years_later != null && `${e.years_later} year${e.years_later === 1 ? '' : 's'} later`].filter(Boolean).join(' · ');
  return `<article class="exp ${esc(e.regret)}">
    <div class="exp-head"><span class="badge ${esc(e.regret)}">${REGRET_LABEL[e.regret] ?? 'Mixed'}</span>${when ? `<span class="muted small">${esc(when)}</span>` : ''}</div>
    <dl>
      <dt>Where they were</dt><dd>${esc(e.situation)}</dd>
      <dt>What they decided</dt><dd>${esc(e.choice)}</dd>
      <dt>What happened</dt><dd>${esc(e.outcome)}</dd>
      ${e.main_reason ? `<dt>Why they did it</dt><dd>${esc(e.main_reason)}</dd>` : ''}
      ${e.advice ? `<dt>Their advice</dt><dd>${esc(e.advice)}</dd>` : ''}
    </dl>
    <cite>— ${esc(e.author)} · ${e.source_url ? `<a href="${esc(e.source_url)}" target="_blank" rel="noopener">read the original post</a>` : 'shared by a user'}</cite>
  </article>`;
}

const experiencesSection = (list) => !list.length ? '' : `
  <div class="card" id="exps"><h3>Their experiences</h3>
    <p class="muted small">Closest to your question first: what each person was facing, what they chose, and how it turned out.</p>
    <div class="filters">${['all', 'no', 'mixed', 'yes'].map((f) => {
      const c = f === 'all' ? list.length : list.filter((e) => e.regret === f).length;
      return c ? `<button type="button" data-f="${f}">${f === 'all' ? 'All' : REGRET_LABEL[f]} · ${c}</button>` : '';
    }).join('')}</div>
    <div class="exp-list"></div>
    <button type="button" class="more navbtn"></button>
  </div>`;

function mountExperiences(list) {
  const box = $('exps');
  if (!box) return;
  let filter = 'all', expanded = false;
  const draw = () => {
    const shown = list.filter((e) => filter === 'all' || e.regret === filter);
    box.querySelector('.exp-list').innerHTML = shown.slice(0, expanded ? shown.length : 5).map(experienceCard).join('');
    const more = box.querySelector('.more');
    more.hidden = shown.length <= 5;
    more.textContent = expanded ? 'Show fewer' : `Show all ${shown.length}`;
    box.querySelectorAll('.filters button').forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
  };
  box.querySelector('.filters').onclick = (ev) => { const b = ev.target.closest('button'); if (b) { filter = b.dataset.f; expanded = false; draw(); } };
  box.querySelector('.more').onclick = () => { expanded = !expanded; draw(); };
  draw();
}

function renderReport(r) {
  const n = r.story_count, c = r.regret, a = r.advice_count || 0;
  if (n === 0 && a === 0) {
    $('out').innerHTML = `
      <div class="card hero"><span class="tag">${esc(r.label)}</span>
        <h2>No stories for this decision yet</h2>
        <p class="muted">Nobody has shared an outcome story about this yet, so there is nothing to count. Be the first — your story is added and searchable straight away.</p>
        <button type="button" id="emptyShare" class="navbtn primary">Share your story</button></div>
      ${r.canada_context ? `<div class="card ctx"><h3>🍁 Canadian context</h3><p>${esc(r.canada_context)}</p><p class="muted small">${esc(r.context_source)}</p></div>` : ''}`;
    $('emptyShare').onclick = () => { $('s_type').value = r.type; $('shareBtn').click(); };
    return;
  }
  // Largest-remainder rounding so the three percentages always add up to 100.
  const keys = ['no', 'mixed', 'yes'], raw = keys.map((k) => (100 * c[k]) / n), floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((x, y) => x + y, 0);
  for (const i of raw.map((v, i) => i).sort((x, y) => (raw[y] - floor[y]) - (raw[x] - floor[x]))) if (left-- > 0) floor[i]++;
  const pct = (k) => floor[keys.indexOf(k)];
  const split = r.show_percentages
    ? `<div class="split">
        <div class="seg no" style="flex:${c.no || 0.01}"><b>${pct('no')}%</b> no regret</div>
        <div class="seg mixed" style="flex:${c.mixed || 0.01}"><b>${pct('mixed')}%</b> mixed</div>
        <div class="seg yes" style="flex:${c.yes || 0.01}"><b>${pct('yes')}%</b> regret</div></div>`
    : `<p class="muted">Only ${n} matching stor${n === 1 ? 'y' : 'ies'} — too few for percentages. Read them below.</p>`;
  const list = (a) => (a.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">—</p>');
  $('out').innerHTML = `
    <div class="card hero"><span class="tag">${esc(r.label)}</span>
      <h2>Estimated from ${n} real stor${n === 1 ? 'y' : 'ies'}</h2>${a ? `<p class="muted small">plus ${a} advice post${a === 1 ? '' : 's'} from people with experience (not counted in the regret split)</p>` : ''}${split}
      ${r.ai_summary ? '' : '<p class="muted small">AI summary off — showing excerpts from the closest stories.</p>'}</div>
    ${experiencesSection(r.experiences ?? [])}
    <div class="grid">
      <div class="card"><h3>Top reasons</h3>${list(r.top_reasons)}</div>
      <div class="card"><h3>Top advice</h3>${list(r.top_advice)}</div>
    </div>
    ${r.no_regret_pattern ? `<div class="card"><h3>What people who didn't regret it did differently</h3><p>${esc(r.no_regret_pattern)}</p></div>` : ''}
    ${r.no_regret_advice?.length ? `<div class="card"><h3>Advice from people who didn't regret it</h3>${list(r.no_regret_advice)}<p class="muted small">Each line is one person's own advice, not an AI summary.</p></div>` : ''}
    ${r.canada_context ? `<div class="card ctx"><h3>🍁 Canadian context</h3><p>${esc(r.canada_context)}</p><p class="muted small">${esc(r.context_source)} · shown separately from the story counts</p></div>` : ''}
    <div class="card"><h3>In their words</h3>
      ${r.quotes.map((q) => `<blockquote class="${q.kind === 'advice' ? 'advice' : q.regret}">“${esc(q.text)}”<cite>— ${esc(q.author)} · ${q.kind === 'advice' ? 'advice' : 'regret: ' + q.regret} · ${q.source_url ? `<a href="${esc(q.source_url)}" target="_blank" rel="noopener">source</a>` : 'shared by a user'}</cite></blockquote>`).join('') || '<p class="muted">No quotes available.</p>'}
    </div>
    ${r.warning ? `<p class="warn">${esc(r.warning)}</p>` : ''}`;
  mountExperiences(r.experiences ?? []);
}

async function run(question, type) {
  $('send').disabled = true;
  $('out').innerHTML = '<p class="muted">Finding people who made this decision…</p>';
  try {
    const res = await fetch('/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, type, province: $('province').value || undefined }),
    });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || res.statusText);
    if (r.safety) {
      $('out').innerHTML = `<div class="card safety"><h2>You're not alone</h2><p>${esc(r.safety.message)}</p><ul>${r.safety.resources.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    } else if (r.needsChoice || r.offTopic) {
      $('out').innerHTML = `<div class="card"><h3>${r.offTopic ? esc(r.message) : 'Which is closest to your decision?'}</h3><div class="examples">${r.alternatives.map((a) => `<button type="button" data-type="${a.id}">${esc(a.label)}</button>`).join('')}</div></div>`;
      $('out').querySelectorAll('button').forEach((b) => (b.onclick = () => run(question, b.dataset.type)));
    } else renderReport(r);
  } catch (e) {
    $('out').innerHTML = `<p class="warn">Error: ${esc(e.message)}</p>`;
  } finally { $('send').disabled = false; }
}

$('ask').addEventListener('submit', (e) => { e.preventDefault(); run($('q').value.trim()); });
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('ask').requestSubmit(); } });
for (const ex of [DEMO, ...EXAMPLES]) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = ex === DEMO ? `★ Demo: ${ex}` : ex;
  if (ex === DEMO) b.className = 'demo';
  b.onclick = () => { $('q').value = ex; $('ask').requestSubmit(); };
  $('examples').append(b);
}
const startDemo = () => { if (!new URLSearchParams(location.search).has('nodemo') && !$('out').innerHTML.trim()) { $('q').value = DEMO; run(DEMO); } };

// ---- Background quiz: before the first search, all optional, saved in this browser only ----
const BG_KEY = 'beenThere.background';
const readBg = () => { try { return JSON.parse(localStorage.getItem(BG_KEY)); } catch { return null; } };
const writeBg = (v) => { try { localStorage.setItem(BG_KEY, JSON.stringify(v)); } catch { /* private mode: answers last for this visit */ } };
let background = readBg();
let quizOpts;

function generationOf(age) {
  const born = new Date().getFullYear() - age;
  return born >= 2013 ? 'Gen Alpha' : born >= 1997 ? 'Gen Z' : born >= 1981 ? 'Millennial' : born >= 1965 ? 'Gen X' : born >= 1946 ? 'Boomer' : 'Silent Generation';
}
const validAge = () => { const a = +$('b_age').value; return $('b_age').value !== '' && !$('b_age_skip').checked && a >= 10 && a <= 100 ? Math.round(a) : null; };

function buildQuiz(opts) {
  quizOpts = opts;
  for (const [id, label] of Object.entries(opts.genders)) $('b_gender').append(new Option(label, id));
  for (const c of Object.keys(opts.regions)) $('b_country').append(new Option(c, c));
  $('b_eth').innerHTML = [...Object.entries(opts.ethnicities), ['none', 'Prefer not to say']].map(([id, label]) =>
    `<label class="check"><input type="checkbox" value="${esc(id)}"> ${esc(label)}</label>`).join('');
  $('b_age').oninput = $('b_age_skip').onchange = () => {
    if ($('b_age_skip').checked) $('b_age').value = '';
    const a = validAge();
    $('genOut').textContent = a ? `→ ${generationOf(a)}` : '';
  };
  $('b_gender').onchange = () => { $('b_gender_self').hidden = $('b_gender').value !== 'self-describe'; };
  $('b_country').onchange = () => fillRegions($('b_country').value);
  $('b_eth').onchange = (e) => { // "Prefer not to say" clears the rest, and the other way round
    const boxes = [...$('b_eth').querySelectorAll('input')];
    if (e.target.value === 'none' && e.target.checked) boxes.forEach((b) => { if (b !== e.target) b.checked = false; });
    else if (e.target.checked) boxes.find((b) => b.value === 'none').checked = false;
    $('b_eth_self').hidden = !boxes.find((b) => b.value === 'self_describe').checked;
  };
}
function fillRegions(country, value = '') {
  const sel = $('b_region'), list = quizOpts.regions[country] ?? [];
  sel.innerHTML = '<option value="">Prefer not to say</option>' + list.map((r) => `<option>${esc(r)}</option>`).join('');
  sel.hidden = !list.length;
  sel.value = value;
}
function openQuiz() {
  const b = background ?? {};
  $('b_age').value = b.age ?? ''; $('b_age_skip').checked = !!b.ageSkipped; $('b_age').oninput();
  $('b_gender').value = b.gender ?? ''; $('b_gender_self').value = b.genderSelf ?? ''; $('b_gender').onchange();
  $('b_country').value = b.country ?? ''; fillRegions(b.country ?? '', b.region ?? '');
  $('b_eth').querySelectorAll('input').forEach((x) => (x.checked = (b.ethnicity ?? []).includes(x.value)));
  $('b_eth_self').value = b.ethnicitySelf ?? ''; $('b_eth_self').hidden = !(b.ethnicity ?? []).includes('self_describe');
  $('quiz').showModal();
}
function saveQuiz(skipped) {
  const age = validAge();
  const eth = [...$('b_eth').querySelectorAll('input:checked')].map((x) => x.value);
  background = skipped ? (background && !background.skipped ? background : { skipped: true }) : {
    age, ageSkipped: $('b_age_skip').checked, generation: age ? generationOf(age) : null,
    gender: $('b_gender').value || null, genderSelf: $('b_gender').value === 'self-describe' ? $('b_gender_self').value.trim() : '',
    country: $('b_country').value || null, region: $('b_region').value || null,
    ethnicity: eth, ethnicitySelf: eth.includes('self_describe') ? $('b_eth_self').value.trim() : '',
  };
  writeBg(background);
  applyBackground();
  $('quiz').close();
  startDemo();
}
// What a shared story may carry: coarse fixed values only (the server re-checks them against the same lists).
const backgroundForServer = () => (!background || background.skipped ? null : {
  generation: background.generation, gender: background.gender, country: background.country, region: background.region,
  ethnicity: (background.ethnicity ?? []).filter((e) => e !== 'none'),
});
function applyBackground() {
  const b = background;
  if (b?.country === 'Canada' && [...$('province').options].some((o) => o.value === b.region)) $('province').value = b.region;
  const parts = !b || b.skipped ? [] : [
    b.generation, b.gender && (b.gender === 'self-describe' ? (b.genderSelf || 'self-described') : quizOpts.genders[b.gender]),
    [b.region, b.country].filter(Boolean).join(', '),
    (b.ethnicity ?? []).filter((e) => e !== 'none').map((e) => (e === 'self_describe' ? (b.ethnicitySelf || 'self-described') : quizOpts.ethnicities[e])).join(' / '),
  ].filter(Boolean);
  $('bgLine').innerHTML = `${parts.length ? `Your background: ${esc(parts.join(' · '))}` : 'Background quiz skipped.'} <button type="button" id="bgEdit" class="linkbtn">${parts.length ? 'Edit' : 'Answer it'}</button>`;
  $('bgEdit').onclick = openQuiz;
}
$('bgBtn').onclick = openQuiz;
$('quizForm').addEventListener('submit', (e) => { e.preventDefault(); saveQuiz(false); });
$('quizSkip').onclick = () => saveQuiz(true);
$('quiz').addEventListener('cancel', (e) => { e.preventDefault(); saveQuiz(true); }); // Esc counts as "skip for now"
// ---- Settings (Gemini key lives on the server; it is only ever shown masked) ----
async function loadSettings() {
  const s = await (await fetch('/api/settings')).json();
  $('keyState').textContent = s.managedByEnv ? `· set on the server (${s.geminiKeyMasked})` : s.geminiKeySet ? `· saved (${s.geminiKeyMasked})` : '· not set';
  for (const id of ['key', 'model', 'saveSettings', 'clearKey']) $(id).disabled = s.managedByEnv;
  $('model').value = s.geminiModel;
  $('key').value = '';
}
async function saveSettings(body) {
  $('settingsMsg').textContent = '';
  const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { $('settingsMsg').textContent = data.error; return; }
  await loadSettings();
  await loadStatus();
  $('settingsMsg').textContent = '';
  $('settings').close();
}
$('gear').onclick = () => { loadSettings(); $('settings').showModal(); };
$('closeSettings').onclick = () => $('settings').close();
$('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  saveSettings({ geminiModel: $('model').value, ...($('key').value.trim() ? { geminiApiKey: $('key').value } : {}) });
});
$('clearKey').onclick = () => saveSettings({ geminiApiKey: '' });

function loadStatus() { return fetch('/api/health').then((r) => r.json()).then((h) => {
  if ($('province').options.length === 1) for (const p of h.provinces) $('province').append(new Option(p, p));
  if ($('s_type').options.length === 0) for (const [id, label] of Object.entries(h.types)) { $('s_type').append(new Option(label, id)); $('btype').append(new Option(label, id)); }
  const s = $('status');
  s.textContent = h.ok ? `${h.stories} stories · local embeddings · ${h.gemini ? 'Gemini on' : 'add Gemini key in ⚙️ (optional)'}` : 'run: npm run ingest';
  s.className = `status ${h.ok && h.gemini ? 'ok' : 'warn'}`;
  return h;
}).catch(() => { $('status').textContent = 'server offline'; }); }

// First visit: the background quiz comes before the first search (the demo runs once it is saved or skipped).
loadStatus().then((h) => {
  if (!h) return;
  buildQuiz(h.quiz);
  if (background) { applyBackground(); startDemo(); } else openQuiz();
});

// ---- Share your story (embedded locally by the server on arrival) ----
function syncKind() {
  const adv = $('s_kind').value === 'advice';
  $('regretRow').hidden = adv;
  $('s_choice').required = $('s_outcome').required = !adv;
  $('s_advice').required = adv;
}
$('s_kind').onchange = syncKind;
$('shareBtn').onclick = () => { $('shareMsg').textContent = ''; $('share').showModal(); };
$('closeShare').onclick = () => $('share').close();
$('shareForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    kind: $('s_kind').value, decision_type: $('s_type').value, situation: $('s_situation').value, choice: $('s_choice').value, outcome: $('s_outcome').value,
    regret: $('s_regret').value, main_reason: $('s_reason').value, advice: $('s_advice').value,
    years_later: $('s_years').value, age_at_decision: $('s_age').value, quote: $('s_quote').value, background: backgroundForServer(),
  };
  $('submitShare').disabled = true;
  $('shareMsg').textContent = 'Embedding with the local model…';
  try {
    const res = await fetch('/api/stories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const r = await res.json();
    if (r.safety) { $('share').close(); $('out').innerHTML = `<div class="card safety"><h2>You're not alone</h2><p>${esc(r.safety.message)}</p><ul>${r.safety.resources.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`; return; }
    if (!res.ok) throw new Error(r.error || res.statusText);
    $('shareForm').reset();
    syncKind();
    $('share').close();
    loadStatus();
    $('out').innerHTML = `<div class="card"><h3>Thank you</h3><p>Your story was embedded and added (${r.total} stories now). It will show up in matching reports.</p></div>`;
  } catch (err) { $('shareMsg').textContent = err.message; }
  finally { $('submitShare').disabled = false; }
});

// ---- Browse stored stories + inspect embeddings ----
const REGRET = { no: 'no regret', mixed: 'mixed', yes: 'regret' };
async function loadBrowse() {
  const list = await (await fetch(`/api/stories?type=${$('btype').value}`)).json();
  $('bcount').textContent = `· ${list.length}`;
  $('blist').innerHTML = list.map((s) => `
    <div class="story ${s.kind === 'advice' ? 'advice' : s.regret}" data-id="${esc(s.id)}">
      <button type="button" class="embtn" title="Show this story's embedding vector">embed</button>
      <div class="meta">${esc(s.decision_type.replace(/_/g, ' '))} · ${s.kind === 'advice' ? 'advice' : REGRET[s.regret]} · ${esc(s.author)}${s.source === 'user' ? ' · shared here' : ''}${s.source_url ? ` · <a href="${esc(s.source_url)}" target="_blank" rel="noopener">source</a>` : ''}</div>
      <p><b>Situation:</b> ${esc(s.situation)}</p><p><b>Choice:</b> ${esc(s.choice)}</p><p><b>Outcome:</b> ${esc(s.outcome)}</p>
      ${s.advice ? `<p><b>Advice:</b> ${esc(s.advice)}</p>` : ''}
      <div class="vec" hidden></div>
    </div>`).join('') || '<p class="muted">No stories yet.</p>';
}
$('browseBtn').onclick = () => { loadBrowse(); $('browse').showModal(); };
$('closeBrowse').onclick = () => $('browse').close();
$('btype').onchange = loadBrowse;
$('blist').addEventListener('click', async (e) => {
  const btn = e.target.closest('.embtn');
  if (!btn) return;
  const box = btn.parentElement.querySelector('.vec');
  if (!box.hidden) { box.hidden = true; btn.classList.remove('open'); return; }
  const v = await (await fetch(`/api/stories/${encodeURIComponent(btn.parentElement.dataset.id)}/embedding`)).json();
  const strip = v.vector.map((x) => `<i style="background:hsl(${x > 0 ? 8 : 215} 70% 50% / ${Math.min(1, Math.abs(x) * 6)})"></i>`).join('');
  box.innerHTML = `<div class="muted small">${esc(v.model)} · ${v.dim} dimensions (unit vector)</div><div class="strip">${strip}</div><pre>[${v.vector.join(', ')}]</pre>`;
  box.hidden = false;
  btn.classList.add('open');
});
