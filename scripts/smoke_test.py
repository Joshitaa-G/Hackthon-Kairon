"""
Real-data smoke test: the demo path against the REAL database and REAL LLM. Prints PASS/FAIL.

Run:   python scripts/smoke_test.py          (uses DB_PATH and LLM settings from .env)
Cost:  ~3 /match calls at most (most hit the free keyword path), and 0 summary calls
       once scripts/warm_cache.py has run.
Run it right before judging. The unit tests (pytest) use mock data and cost nothing.
"""

import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.retrieval import load_store  # noqa: E402

DEMO = [  # docs/demo_script.md
    ("I'm 20, 2nd year bio, I hate labs. Should I switch to CS?", "switch_major"),
    ("I'm 24 and 2 years into a PhD. Should I leave for an industry job?", "grad_vs_work"),
    ("First job out of school, 8 months in, I'm miserable. Should I quit?", "quit_job"),
    ("I've been a software dev for 3 years but I want to become a teacher", "career_change"),
]

results = []


def check(name, ok, detail=""):
    ok = bool(ok)
    results.append(ok)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{f'  ({detail})' if detail else ''}")


def main():
    store = load_store()
    if store.is_mock:
        sys.exit("DB_PATH points at mock data. Set DB_PATH=data/been_there.sqlite in .env.")
    db = sqlite3.connect(store.db_path)
    counts = store.type_counts()
    print(f"DB: {store.db_path.name}  stories: {counts}")

    with TestClient(app) as c:
        print("\nSafety")
        m = c.post("/match", json={"text": "I want to hurt myself"}).json()
        check("self-harm text returns support, not a report", m["type"] == "safety")

        for text, expected in DEMO:
            print(f"\n{text}")
            t = time.time()
            m = c.post("/match", json={"text": text}).json()
            check(f"/match -> {expected}", m["type"] == expected, f"got {m['type']}, {time.time() - t:.1f}s")
            if expected not in counts:
                print(f"  SKIP  report: no real stories for {expected} yet")
                continue
            t = time.time()
            r = c.get("/report", params={"type": expected, "q": text}).json()
            dt = time.time() - t
            n = r["story_count"]
            check("report returned", n > 0, f"{n} stories, {dt:.1f}s")
            check("counts add up", sum(r["regret"].values()) == n)
            check("% shown only with >= 5 stories", r["show_percentages"] == (n >= 5))
            check("labelled as real data", not r["is_mock"] and "real stories" in r["source_label"])
            check("has summary (not empty)", bool(r["top_reasons"]) and bool(r["top_advice"]))
            check(">= 3 quotes", len(r["quotes"]) >= 3, f"{len(r['quotes'])}")
            for q in r["quotes"]:
                row = db.execute("SELECT quote, author, source_url, decision_type FROM stories WHERE id=?",
                                 (q["id"],)).fetchone()
                check(f"quote {q['id']} is verbatim from DB, right type, linked",
                      row is not None and row[0] == q["text"] and row[2] == q["source_url"]
                      and row[3] == expected and q["author"])
            check("cached repeat is fast", _timed(c, expected, text) < 1.0)

    passed = sum(results)
    print(f"\n{passed}/{len(results)} checks passed")
    sys.exit(0 if passed == len(results) else 1)


def _timed(c, t, q):
    s = time.time()
    c.get("/report", params={"type": t, "q": q})
    return time.time() - s


if __name__ == "__main__":
    main()
