# Deploying the backend on Render (free tier)

**It fits:** measured locally at ~235 MB running and ~270 MB peak, against Render's 512 MB free limit.
The local embedding model runs on fastembed (ONNX Runtime) instead of PyTorch. It uses the same
all-MiniLM-L6-v2 weights and produces identical vectors (cosine 1.0000 against the stored embeddings).

## Steps (about 10 minutes)
1. In Render: **New → Blueprint**, connect `Joshitaa-G/Hackthon-Kairon`. It reads `render.yaml`.
2. When asked, fill in the 3 secret values:
   - `LLM_API_KEY` and `REPORT_LLM_API_KEY`: the Groq key
   - `ALLOWED_ORIGIN`: the Vercel frontend URL (comma-separate several, e.g. add `http://localhost:5173`)
3. Deploy. The build installs packages and pre-downloads the embedding model (~2–3 min).
4. Check `https://<service>.onrender.com/health`. It should show `"mock_data": false` and the story counts.
5. Run the smoke test against the real data locally (`python scripts/smoke_test.py`) before judging.

## Things to know for the demo
- **Free instances sleep after 15 minutes idle,** and the first request then takes ~30–60 s.
  **Open `/health` about 2 minutes before judging,** and again if the demo is far from your slot.
- **Summaries don't need the LLM:** `data/been_there.summaries.json` is committed, so reports make 0 calls.
- **Updating data:** rebuild the DB (`embed_load.py`), run `warm_cache.py`, commit both files, then push.
  Render redeploys on push.
- **Backup plan:** if Render fails, run locally with `uvicorn app.main:app --host 0.0.0.0 --port 8000`
  from `backend/` and point the frontend at your laptop's IP on the venue Wi-Fi.
