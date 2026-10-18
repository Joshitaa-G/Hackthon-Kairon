# Token budget: testing today + demo tomorrow (Groq free tier)

**Both of our Groq keys belong to the same account and share one quota.** (Checked: each model's
remaining count dropped on both keys at the same moment.) Limits are **per model**:
1,000 requests/day and 8,000 tokens/minute. Each model's count replenishes over about 24 h.

## Who uses which model

| Model | Used for | When |
|---|---|---|
| `qwen/qwen3.8-27b` | Extraction, half the posts | Tonight only |
| `openai/gpt-oss-120b` | Extraction, other half + **report summaries** | Tonight + ~5 calls tomorrow |
| `openai/gpt-oss-20b` | **`/match`** (only when no keyword hits) | Testing + demo |

## Need vs. have

| | Requests needed | Per-model limit | Margin |
|---|---|---|---|
| Extraction tonight (Qwen) | ~310 | 1,000/day | about 3x |
| Extraction tonight (120b) | ~310 | 1,000/day | about 3x |
| Report summaries (120b) | **1 per decision type, about 5 total** | 1,000/day | huge |
| `/match` testing today + demo (20b) | ~200 (most questions hit the free keyword path) | 1,000/day | 5x |

Each summary call is ~4K tokens, under the 8K/minute cap. A `/match` call is ~600 tokens, so
about 13 vague questions per minute before rate limiting starts. Fine for judges.

## Why the demo can't run out

1. **Summaries are saved to disk** (`data/been_there.summaries.json`). Run `python scripts/warm_cache.py`
   after the final data load and commit that file. Refreshes, restarts and redeploys then make **0 LLM calls**.
2. **Keyword fast-path:** "PhD", "quit", "major", "career change", "gap year" match with no LLM call.
3. **If the LLM fails or hits a limit:**
   - `/match` offers the 2 closest decision types (local embeddings, no LLM).
   - The report uses a code-only summary built from the extracted reasons and advice.
   - Counts and quotes never need the LLM.
4. **Embeddings are local** (`all-MiniLM-L6-v2`), with no API and no quota.

## Rules for tonight
- Don't run full extraction again tomorrow morning. If needed, use `--type` and `--limit` for small top-ups.
- Run tests with mock mode (`LLM_MOCK=1`, the default in tests), so they cost 0 tokens.
- Revoke and replace both Groq keys after the hackathon. They were pasted in chat.
