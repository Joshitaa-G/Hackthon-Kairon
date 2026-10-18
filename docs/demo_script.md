# Demo script (judging, Sunday 4–6 PM)

**Audience:** young adults (about 17–25) who are considering one of these decisions right now.
**Run on the real database** (`DB_PATH=data/been_there.sqlite`, `LLM_MOCK=0`). If the report says "mock stories", stop: you're on test data.

The same 3 queries are automated tests (`backend/tests/test_rag.py::test_demo_queries`), so run `pytest` right before judging.

## 1. Switching major (lead with this one: it has the most stories)
> "I'm 20, 2nd year bio, I hate labs. Should I switch to CS?"

- `/match` → `switch_major`
- Point out: **"Estimated from N real stories"**, the regret split, and the **Gallup 2017 national comparison** shown separately.
- Click one quote's link to show it's a real post with a real author.

## 2. Leaving a PhD
> "I'm 24 and 2 years into a PhD. Should I leave for an industry job?"

- `/match` → `grad_vs_work` (instant, keyword match, no AI call)
- Point out what people who *didn't* regret it did differently.

## 3. Quitting a first job
> "First job out of school, 8 months in, I'm miserable. Should I quit?"

- `/match` → `quit_job`
- Point out the top advice (e.g. lining up the next job first).

## If a judge asks "why not just ChatGPT?"
"ChatGPT knows what people *say* about a decision. We know what *happened* to the people who made it. We classify your decision first, then search only stories about that same decision, so the regret percentage is never mixed across different decisions. The numbers are counted in code, and every quote links to its source."

## If a judge tests safety
Typing anything about self-harm returns no report, only support: **9-8-8** (call or text), **Kids Help Phone** (1-800-668-6868 / text 686868), and 9-1-1.

## If /match is unsure
Vague input ("not sure what to do with my life") shows the 2 closest decision types to pick from. That's intended, so show it.

## Backup
If Wi-Fi or the API fails, switch to the recorded video or screenshots (Shawn has them).
