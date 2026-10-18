# Kairon

Answers a career/freelancing decision with what actually happened to people who made it. Runs locally in Node.js.

## Quick start

Needs Node.js 18+. Open this folder in a terminal and run:

```bash
npm install && npm start
```

**API key:** never commit it. Locally, paste it in ⚙️ Settings (saved to `data/settings.json`, which is gitignored). On a server, set the `GEMINI_API_KEY` environment variable instead (optional `GEMINI_MODEL`, default `gemini-3.8-flash`); the key is never sent to the browser, and only the first and last 4 characters are ever shown.

Then open http://localhost:3000. `npm install` also downloads the local embedding model. No API key is needed to start; add a free Gemini key later in ⚙️ Settings. **Get one at https://aistudio.google.com/apikey** (sign in with Google, click "Create API key", paste it into Settings).

## 1. Files

| File | What it does |
|---|---|
| `package.json` | Dependencies and npm scripts (`start`, `fetch`, `extract`, `ingest`, `postinstall`) |
| `server/index.js` | Express app and all API routes (report, stories, embedding, settings, health) |
| `server/store.js` | Loads the store, classifies a question into a decision type, ranks stories by similarity, adds new stories |
| `server/report.js` | Counts regret in code, asks Gemini for the summary (fallback without a key), picks quotes by ID |
| `server/embed.js` | Local embeddings with Xenova `all-MiniLM-L6-v2` (384 numbers per text) |
| `server/gemini.js` | Gemini REST client (JSON mode) |
| `server/settings.js` | Saves the Gemini key and model to `data/settings.json` |
| `server/safety.js` | Detects self-harm/abuse wording and returns the crisis lines (9-8-8, Kids Help Phone, 9-1-1) |
| `server/decisionTypes.js` | The fixed decision types: labels, keywords, Stack Exchange search terms |
| `public/index.html` | Page layout and the dialogs (Share your story, Browse stories, Settings) |
| `public/index.js` | All browser logic: report, share form, story browser, hidden `embed` viewer, settings |
| `public/style.css` | Styling |
| `public/favicon.svg` | Browser tab icon (red compass) |
| `scripts/postinstall.js` | Runs on `npm install`; downloads the embedding model into `node_modules` |
| `scripts/fetch-se.js` | Pulls raw posts from the Stack Exchange API |
| `scripts/extract.js` | Gemini turns raw posts into structured stories (resumable) |
| `scripts/ingest.js` | Embeds stories locally and writes `store.json` |
| `data/stories/store.json` | The database the app reads: stories + embeddings + decision-type vectors |
| `data/stories/context.json` | Canadian self-employment stats (Statistics Canada LFS 14-10-0027-01) |
| `data/stories/mock_stories.jsonl` | Hand-written test stories (dev only) |
| `data/stories/raw/*.jsonl` | Raw Stack Exchange posts (git-ignored) |
| `data/stories/stories.jsonl` | Extracted stories (created by `extract`) |
| `data/stories/user_stories.jsonl` | Stories shared through the app |
| `data/settings.json` | Your Gemini key and model (git-ignored) |

## 2. Pipeline

**Build the data (once)**
1. Collect real first-person posts about career decisions from Stack Exchange.
2. Use Gemini to keep only posts where someone made a decision and describes what happened, and turn each into a structured story (situation, choice, outcome, regret, reason, advice, quote).
3. Convert each story into a vector with the local embedding model.
4. Store the stories and their vectors in one JSON file.

**Answer a question**
1. The user types a decision.
2. Safety check: if it mentions self-harm or abuse, show crisis lines instead of a report.
3. Classify the decision into one fixed type (e.g. going freelance, quitting a job).
4. Take only stories of that type and rank them by similarity to the question (the question is embedded locally too). Keep the top 40.
5. Count how many regretted it, mixed, or didn't regret it. This is done in code, not by the AI. Fewer than 5 stories means no percentages.
6. Gemini (optional) summarises the top reasons and advice from those stories only. Without a key, show excerpts from the closest stories.
7. Pull real quotes from the stored stories, with author and link to the source.
8. Add Canadian self-employment statistics for freelance questions.
9. Show the report.

**User shares a story**
1. User fills the form (same fields as a story).
2. Safety check and validation.
3. Embed it locally and add it to the stored stories.
4. It is searchable immediately.
