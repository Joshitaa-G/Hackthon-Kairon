# Token budget: testing today + demo tomorrow (Groq free tier)

**Both of our Groq keys belong to the same account and share one quota.** (Checked: each model's
remaining count dropped on both keys at the same moment.) Limits are **per model**:

| Limit | Value | Notes |
|---|---|---|
| Requests | 1,000 / day | |
| Tokens per minute | 8,000 | |
| **Tokens per day** | **200,000** | Not shown in response headers; this is what stopped extraction |

The daily windows are **rolling 24 h**, so tokens used tonight still count during the demo
tomorrow afternoon.

## Status (Oct 17, about 9 PM)

| Model | Used for | Daily tokens |
|---|---|---|
| `qwen/qwen3.8-27b` | Extraction | **Used up** (198,948 / 200,000) |
| `openai/gpt-oss-120b` | Extraction + report summaries | Mostly used; extraction stopped to leave room |
| `openai/gpt-oss-20b` | `/match` in the app | Almost untouched: **reserved for the demo** |

Extraction was stopped at 389 of 706 posts (72 stories) so the demo can't run out.

## What the demo needs: almost nothing

1. **Report summaries: 0 calls.** All 4 are saved in `data/been_there.summaries.json` (built with
   `scripts/warm_cache.py`). Commit that file. If the database changes, rerun `warm_cache.py`
   (4 calls, ~16K tokens).
2. **`/match`: only for vague questions.** "PhD", "quit", "major", "career change", "gap year" match
   with no LLM call. Other questions take 1 call on gpt-oss-20b (~600 tokens). The 200K daily
   cap is about 300 vague questions.
3. **If the LLM fails or hits a limit:**
   - `/match` offers the 2 closest decision types (local embeddings, no LLM).
   - Reports use the code-only summary built from the extracted reasons and advice.
   - Counts and quotes never need the LLM.
4. **Embeddings are local** (`all-MiniLM-L6-v2`), with no API and no quota.

## Rules until judging
- **Don't run extraction on Groq again.** It would use the quota the demo depends on.
- **The other 317 posts need a different account.** Use a **Cerebras key** (separate provider, about
  1M tokens/day free) or a teammate's own Groq account. Both work with
  `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`; then rerun `extract.py`, which resumes where it stopped.
- **Unit tests** (`pytest`) use mock mode and cost 0 tokens.
- **The smoke test** (`scripts/smoke_test.py`) costs about 2 calls on gpt-oss-20b. Run it before judging.
- **Revoke and replace both Groq keys after the hackathon.** They were pasted in chat.
