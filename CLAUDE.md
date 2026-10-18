# Been There — Project Brief for Claude Code

> Claude Code reads this file automatically every session.

## 0. Context

- **Event:** Hack the Skies 2026, a 2-day in-person high school hackathon at Humber Polytechnic.
- **Hard deadline:** DevPost submission **Sunday Oct 18, 2026, 3:00 PM ET**. Team target: submitted by **2:30 PM**. Code freeze **1:00 PM Sunday**.
- **Judging:** Sunday 4–6 PM, live demo.
- **DevPost needs:** a valid public GitHub link + description fields: project description, tools/frameworks used, largest hurdle, greatest accomplishment.
- **Team (5):**
  - Aniruth: RAG + backend + extraction + deploy, lead pitcher
  - Aanya: frontend
  - Joshitaa: ingestion pipeline (Stack Exchange API, extraction runs, embeddings, DB)
  - Shammu: data quality (keywords, hand-labelling 30 stories), pitch story
  - Shawn: online form, slides, video, DevPost

## 1. The product in one paragraph

**Been There** answers a young adult's (about 17–25) big life decision with what actually happened to people who already made it. The user types a decision they're considering ("Should I switch my major?"). The app classifies it into a decision type, retrieves real first-person outcome stories from people who made that decision, counts how many regretted it **in code**, and shows a **Hindsight Report**: story count, regret split, top reasons, top advice, and real quotes with links to the original posts.

**Pitch line:** "ChatGPT knows what people *say* about a decision. We know what *happened* to the people who made it."

## 2. Features (priority order)

**Must have (demo):**
1. **Background quiz** (before first search; all optional, every question has "Prefer not to say"):
   - Age (number) → app computes generation (Gen Z / Millennial / Gen X / Boomer)
   - Gender: Woman or girl / Man or boy / Non-binary / Self-describe / Prefer not to say
   - Where you live now: province or state + country (no city)
   - Ethnicity (multi-select): Statistics Canada groups, Indigenous (First Nations, Métis, Inuit), Self-describe, Prefer not to say
2. **Ask a decision:** free text → classified into one of the decision types (§4).
3. **Hindsight Report:** "Estimated from N real stories", regret split (yes / mixed / no), top 3 reasons, top 3 pieces of advice, what people who *didn't* regret it did differently, 3–5 real quotes, each with author + link.
4. **Source links on every quote** (required by CC BY-SA, and it's our credibility).

**Nice to have (only if time):**
5. Online advisor card (same fields as the Google Form) that writes to the DB.
6. "People like you" line, filtered by up to 2 background traits the teen picks; show only if **≥ 5 matching stories**.
7. Six-month follow-up screen (shown in demo, not actually scheduled).

## 3. Data sources and legal rules — READ BEFORE WRITING INGESTION CODE

| Source | Use | Rules |
|---|---|---|
| **Stack Exchange** (sites: `academia`, `workplace`, `money`, `interpersonal`, `expatriates`, `parenting`) | **Main corpus.** Pull via the public API (`https://api.stackexchange.com/2.3/`). | Content is CC BY-SA. **Every quote shown must display author name + link to the original post.** RAG retrieval only. **Do not fine-tune or train any model on it.** Respect `backoff` in API responses. Free quota ~300 requests/day without a key; register a free key for more. |
| **Reddit** | **Do NOT ingest, store, embed, or run an LLM over Reddit posts.** Reddit's Data API terms forbid ML use without permission. Optional: plain "read more on r/AskOldPeople" outbound links only. | — |
| **Our Google Form** (shared online) | Structured answers, same fields as the advisor card. Import CSV. | Anonymous. No names, no city, no contact info. |
| **Public surveys** | National comparison numbers shown separately in reports. | Gallup 2017: 51% of U.S. adults with post-secondary education would change at least one education decision; 36% would change their major. Always labeled "National survey", never mixed with our counts. |

**Never generate fake stories or fake answers with an LLM to fill the database.** Every story in the DB must come from a real source with a link (or be a real form submission).

## 4. Decision types

Start with these, then **keep only the ones with ≥ 30 real outcome stories** after the data check (§6, step 1):

| id | Label | Main sites | Search keywords |
|---|---|---|---|
| `switch_major` | Choosing or switching your program/major | academia | major, switch program, change field |
| `grad_vs_work` | Grad school vs starting work | academia | PhD industry, master's or job, leave PhD |
| `gap_year` | Taking a gap year | academia | gap year, take a year off |
| `quit_job` | Quitting a job | workplace | quit job, resign |
| `career_change` | Changing careers | workplace | career change, switch careers |
| `take_debt` | Taking on debt (student loans, car, credit) | money | student loan, car loan, credit card debt |
| `move_abroad` | Moving far away / abroad for school or work | expatriates, academia | moving abroad, relocate |
| `confront_friend` | Confronting a friend/family member vs letting it go | interpersonal | confront friend, tell them |

**Data check result (Oct 17):** kept `switch_major` (88), `grad_vs_work` (75), `quit_job` (53), `career_change` (35). Dropped the rest. `gap_year` stays in the fixed list so `/match` can route it, but it has no real stories yet, so its report shows no percentages.

**Retrieval:** classify first, then vector search **only within that decision type**, keep the top 40 (`RETRIEVE_K`), and count regret over those. No hybrid search or reranker for the demo.

**Mock data:** `data/mock/` holds hand-written test fixtures (`mock-` ids, example.com links, `source='mock'`) in a separate DB. They are for tests and frontend work only, never the demo, and `embed_load.py` refuses to load them into the real DB.

To find **outcome** stories (not just advice), combine keywords with phrases: `"looking back"`, `"in hindsight"`, `"I regret"`, `"don't regret"`, `"years later"`, `"I did the same"`. Search **answers** too (`/search/excerpts` returns both questions and answers with `item_type`).

## 5. Architecture

```
INGESTION (run once, offline scripts)
  Stack Exchange API ──> raw posts (JSONL) ──> LLM extraction (1 call/story) ──> filter ──> embed ──> SQLite
  Google Form CSV ────────────────────────────────────────────────────────────────────────> SQLite

EACH REPORT (FastAPI)
  Teen app ──> /match (LLM classifies into decision type, fixed list)
           ──> /report:
                 1. FILTER stories by decision_type (SQL)
                 2. RANK by cosine similarity to the teen's question (in-memory)
                 3. COUNT regret yes/mixed/no in Python over the filtered set
                 4. ONE LLM call: summarize reasons/advice, citing story IDs only
                 5. Code pulls exact quote text + author + link by ID
```

**Key design rules (non-negotiable):**
- **Filter by decision type first, then rank by similarity.** Counting regret across loosely similar stories makes the % meaningless.
- **The LLM never writes a number or a quote.** Numbers are counted in Python. Quotes are pulled from the DB by ID. If the LLM returns an ID not in the retrieved set, drop it.
- **Fixed lists:** `/match` must return a type from the fixed list; reject anything else. Low confidence (< 0.6) → return the 2 closest types for the teen to pick.
- **< 5 stories** for a type/filter → show stories, **no percentage**.
- Every report shows **"Estimated from N real stories"** (regret labels are AI-extracted).

**Tech stack:**
- Backend: Python 3.11+, FastAPI, Uvicorn. Deploy on Render.
- Storage: **SQLite** (one file, committed sample + script to rebuild). Embeddings stored as BLOBs. **No vector DB needed** at a few hundred to a few thousand stories: linear cosine scan in NumPy.
- Embeddings: `all-MiniLM-L6-v2` via **fastembed** (ONNX, local, free, no key; no PyTorch, so the API runs in ~235 MB and fits Render's 512 MB free tier). Embed once at ingestion, cache. Deploy: `render.yaml` + `docs/deploy.md`.
- LLM: **free OpenAI-compatible providers** via the `openai` Python library, switched by env vars only (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`). Current: **Groq** free tier, where limits are per model (1,000 req/day, 8,000 tokens/min). Extraction ran on `qwen/qwen3.8-27b` and `openai/gpt-oss-20b` in parallel (`EXTRACT_SHARD`). The app uses `gpt-oss-120b` for report summaries (`REPORT_LLM_*`, ~1 call per decision type, saved to `<db>.summaries.json`) and `gpt-oss-20b` for `/match` (`MATCH_LLM_MODEL`). Both Groq keys share one quota; see `docs/token_budget.md`. Llama 3.3 70B is not available on our Groq key. The report summary can use a separate provider through `REPORT_LLM_*` (falls back to `LLM_*`). Free tiers may not support strict JSON schemas, so use JSON mode and rely on Pydantic validation. Wrap it in **one** function `llm_json(system, user, schema) -> dict` so it's swappable. Always request JSON; validate with Pydantic; retry once on invalid JSON.
- Frontend: React + Tailwind (Vite or Next.js), deploy on Vercel. Can be scaffolded with Lovable/v0 and then wired to the API.

## 6. Build order (do in this order)

1. **Data check (first 30 minutes).** Script `scripts/count_stories.py`: for each decision type × site, count total topic posts and posts matching outcome phrases via `/search/excerpts` with `filter=total`. Print a table, flag types with ≥ 30. Output decides which types we build.
2. **Agree on the story JSON schema** (§7) before writing extraction or report code.
3. `scripts/fetch_se.py`: pull posts (questions + answers) per kept decision type, save to `data/raw/{type}.jsonl` with `source_url`, `author`, `site`, `post_id`, `body` (strip HTML), `score`, `creation_date`. Use `filter=withbody`. Paginate; respect `backoff`; stop at ~150 raw posts per type.
4. `scripts/extract.py`: one LLM call per post → story JSON (§7). Discard if `is_outcome_story` is false. Save `data/stories.jsonl`.
5. `scripts/embed_load.py`: embed `situation + choice + outcome`, write to SQLite.
6. `scripts/accuracy_sample.py`: export 30 random stories to CSV (text + extracted `regret`) with an empty `human_regret` column for Shammu. Second script computes agreement (e.g. "27/30 match"). This number goes on a slide.
7. FastAPI: `/match`, `/report`, `/answer` (optional), `/health`.
8. Wire the frontend; deploy backend (Render) and frontend (Vercel).
9. Polish, backup screenshots/video, README.

## 7. Schemas

**Story (DB row / extraction output)**
```json
{
  "id": "se-academia-123456-a",
  "decision_type": "switch_major",
  "is_outcome_story": true,
  "situation": "Undergrad in biology unhappy with lab work",
  "choice": "Switched to computer science in third year",
  "outcome": "Graduated a year late but loves the job now",
  "regret": "no",                     // "yes" | "mixed" | "no"
  "main_reason": "Found work they enjoy",
  "advice": "Switch early; the extra year was worth it",
  "years_later": 6,                   // null if not stated
  "age_at_decision": 20,              // null if not stated
  "quote": "Looking back, the extra year was nothing compared to ...",  // verbatim span from body, <= 300 chars
  "source_url": "https://academia.stackexchange.com/a/123456",
  "author": "username",
  "site": "academia",
  "license": "CC BY-SA 4.0"
}
```
Validate that `quote` is an exact substring of the original body; if not, drop the quote (keep the story).

**`POST /match`**
```json
// request
{"text": "should i drop bio and switch to cs?"}
// response
{"type": "switch_major", "confidence": 0.91,
 "restated": "Switching your program or major",
 "alternatives": []}            // 2 closest types if confidence < 0.6
```

**`GET /report?type=switch_major&q=<teen text>&filters=gender:woman,region:ON`**
```json
{
  "type": "switch_major",
  "label": "Choosing or switching your program/major",
  "story_count": 38,
  "regret": {"yes": 9, "mixed": 7, "no": 22},     // counted in Python
  "show_percentages": true,                         // false if story_count < 5
  "top_reasons": ["...", "...", "..."],             // LLM, grounded in retrieved stories
  "top_advice": ["...", "...", "..."],
  "no_regret_pattern": "...",
  "quotes": [
    {"id": "se-academia-123456-a", "text": "...", "author": "username",
     "source_url": "https://...", "regret": "no"}
  ],
  "national_comparison": {"text": "36% of U.S. adults would change their major", "source": "Gallup, 2017"},
  "people_like_you": null                           // only when >= 5 matching
}
```

**Report summary LLM call** gets only the retrieved stories (id + fields) and must return:
```json
{"top_reasons": [...3], "top_advice": [...3], "no_regret_pattern": "...", "quote_ids": [...3-5]}
```

## 8. Prompts (starting points)

**Extraction system prompt (sketch):**
> You extract structured outcomes from a single forum post. Return JSON only, matching the schema. Set `is_outcome_story` true ONLY if the author describes a decision they personally made AND what happened afterward. Advice without a personal outcome, hypotheticals, and questions are false. `regret`: "yes" if they say they regret it or wish they'd chosen differently, "no" if they say they're glad / don't regret, "mixed" otherwise. `quote` must be copied verbatim from the post (max 300 chars), or empty. Never invent details. Use null for anything not stated.

**Match system prompt (sketch):**
> Classify the teen's decision into exactly one of these types: [list ids + labels]. Return JSON {type, confidence 0-1, restated}. If none fit, type = "other". If the text mentions self-harm, suicide, abuse, or danger, return type = "safety".

**Summary system prompt (sketch):**
> You are given real stories as JSON with ids. Write the 3 most common reasons for regret or no regret, the 3 most common pieces of advice, and one sentence on what people who didn't regret it did differently. Use only these stories. Return quote_ids (3–5) of the most representative stories. Do not write numbers or percentages. Do not quote text yourself.

## 9. Safety, privacy, security

- **Safety route:** if `/match` returns `safety` (or a keyword check hits self-harm/suicide/abuse terms), return no report; show a gentle message with **9-8-8 (call or text, any age)** and **Kids Help Phone: call 1-800-668-6868 or text 686868**, plus 9-1-1 for immediate danger. Judges may test this.
- **Privacy:** background quiz answers are optional, anonymous, stored without names/city/contact. Never output group generalizations ("X group regrets…"); only numbers and quotes from matching stories, and only with ≥ 5.
- **Keys:** `.env` for all keys, `.env` in `.gitignore` **before the first commit**, commit `.env.example` with placeholders. No keys in frontend code. Keys go in Render's environment variables. Set a spending limit on the LLM key. CORS locked to the Vercel domain. Simple rate limit on public endpoints (`slowapi`). Run `git grep` for key prefixes before pushing.
- **Caching:** cache each report per (type, filters) and rebuild only when stories change, so judges refreshing don't trigger new LLM calls.

## 10. Repo layout

```
been-there/
  CLAUDE.md
  README.md                 # what it is, how to run, data sources + licenses, team
  .env.example
  backend/
    app/main.py             # FastAPI app, routes
    app/llm.py              # llm_json() wrapper
    app/retrieval.py        # filter + cosine ranking
    app/report.py           # counting + summary + quote lookup
    app/models.py           # Pydantic schemas
    app/safety.py
    requirements.txt
  scripts/
    count_stories.py
    fetch_se.py
    extract.py
    embed_load.py
    accuracy_sample.py
    import_form_csv.py
  data/
    been_there.sqlite       # small committed sample is fine
    raw/                    # gitignored if large
  frontend/                 # React + Tailwind
```

## 11. Definition of done (demo-ready)

- [ ] ≥ 3 decision types with ≥ 30 indexed outcome stories each
- [ ] `/match` → `/report` works end to end on the deployed URL
- [ ] Every quote shows author + link; numbers counted in code; "Estimated from N real stories" shown
- [ ] Extractor accuracy on 30 hand-labelled stories computed (e.g. "27/30")
- [ ] Safety route works
- [ ] No keys in repo; `.env.example` present
- [ ] README lists data sources and licenses (Stack Exchange CC BY-SA, Gallup cited)
- [ ] Backup screenshots / video recorded in case of live failure

## 12. Do NOT

- Ingest, embed, or LLM-process Reddit content.
- Fine-tune or train on Stack Exchange data.
- Let the LLM generate numbers, percentages, or quote text.
- Generate synthetic stories or answers to pad the dataset.
- Show a percentage from fewer than 5 stories.
- Collect names, cities, or contact info.
