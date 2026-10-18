"""
Pre-build each decision type's report summary (1 LLM call per type) before the demo.

Run:   python scripts/warm_cache.py
Uses DB_PATH and REPORT_LLM_* / LLM_* from .env. Writes <db>.summaries.json; commit it so the
deployed app starts with every summary ready and judges never wait on (or spend) an LLM call.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app.report import build_report  # noqa: E402
from app.retrieval import load_store  # noqa: E402


def main():
    store = load_store()
    print(f"DB: {store.db_path.name} ({'MOCK' if store.is_mock else 'real'} data)")
    for t, n in sorted(store.type_counts().items(), key=lambda kv: -kv[1]):
        r = build_report(t)
        ok = "LLM summary" if r.top_reasons else "EMPTY (LLM failed? rerun)"
        print(f"  {t:14} {n:>4} stories  {ok}  | quotes: {len(r.quotes)}")
    print(f"Saved: {store.db_path.with_suffix('.summaries.json')}")


if __name__ == "__main__":
    main()
