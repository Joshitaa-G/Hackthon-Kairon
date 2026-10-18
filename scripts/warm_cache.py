"""
Pre-build each decision type's report summary (1 LLM call per type) before the demo.

Run:   python scripts/warm_cache.py
Uses DB_PATH and REPORT_LLM_* / LLM_* from .env. Writes <db>.summaries.json; commit it so the
deployed app starts with every summary ready and judges never wait on (or spend) an LLM call.
Exits with an error if any type is missing its LLM summary, so a failure can't go unnoticed.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app.report import build_report, has_llm_summary  # noqa: E402
from app.retrieval import load_store  # noqa: E402


def main():
    store = load_store()
    print(f"DB: {store.db_path.name} ({'MOCK' if store.is_mock else 'real'} data)")
    missing = []
    for t, n in sorted(store.type_counts().items(), key=lambda kv: -kv[1]):
        r = build_report(t)
        if has_llm_summary(store, t):
            status = "LLM summary saved"
        else:
            status = "NOT SAVED: LLM failed, reports use the code fallback. Rerun."
            missing.append(t)
        print(f"  {t:14} {n:>4} stories  {status}  | quotes: {len(r.quotes)}")
    print(f"\nCache file: {store.db_path.with_suffix('.summaries.json')}")
    if missing:
        sys.exit(f"{len(missing)} type(s) missing an LLM summary: {', '.join(missing)}")
    print("All decision types have a saved LLM summary. Commit the cache file.")


if __name__ == "__main__":
    main()
