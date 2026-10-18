"""
Been There, step 5: embed each story and load everything into SQLite.

Run:   python scripts/embed_load.py
       python scripts/embed_load.py --input data/mock/mock_stories.jsonl \
           --db data/mock/been_there_mock.sqlite --source mock
Needs: pip install sentence-transformers numpy
Input: data/stories.jsonl   Output: data/been_there.sqlite (rebuilt from scratch each run)
"""

import argparse
import json
import sqlite3
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

ROOT = Path(__file__).resolve().parent.parent
STORIES = ROOT / "data" / "stories.jsonl"
DB = ROOT / "data" / "been_there.sqlite"
MODEL = "all-MiniLM-L6-v2"

SCHEMA = """
CREATE TABLE stories (
    id TEXT PRIMARY KEY,
    decision_type TEXT NOT NULL,
    situation TEXT, choice TEXT, outcome TEXT,
    regret TEXT NOT NULL CHECK (regret IN ('yes', 'mixed', 'no')),
    main_reason TEXT, advice TEXT,
    years_later INTEGER, age_at_decision INTEGER,
    quote TEXT,
    source_url TEXT NOT NULL, author TEXT NOT NULL, site TEXT, license TEXT,
    source TEXT NOT NULL DEFAULT 'stackexchange',
    embedding BLOB NOT NULL
);
CREATE INDEX idx_stories_type ON stories (decision_type);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""

COLUMNS = ["id", "decision_type", "situation", "choice", "outcome", "regret", "main_reason",
           "advice", "years_later", "age_at_decision", "quote", "source_url", "author", "site",
           "license", "source"]


def story_text(s):
    """The text we embed for a story. Queries are embedded raw (retrieval.py)."""
    return f"{s['situation']}. {s['choice']}. {s['outcome']}."


def build(input_path=STORIES, db_path=DB, source="stackexchange"):
    input_path, db_path = Path(input_path), Path(db_path)
    if source == "mock" and db_path.resolve() == DB.resolve():
        raise SystemExit("Refusing to load mock stories into the real database.")

    stories = [json.loads(line) for line in input_path.open(encoding="utf-8") if line.strip()]
    stories = list({s["id"]: s for s in stories}.values())
    for s in stories:
        s.setdefault("source", source)
    print(f"Embedding {len(stories)} stories with {MODEL}...")

    model = SentenceTransformer(MODEL)
    vecs = model.encode([story_text(s) for s in stories], normalize_embeddings=True,
                        show_progress_bar=False).astype(np.float32)

    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.unlink(missing_ok=True)
    con = sqlite3.connect(db_path)
    con.executescript(SCHEMA)
    con.executemany(
        f"INSERT INTO stories ({', '.join(COLUMNS)}, embedding) VALUES ({', '.join('?' * (len(COLUMNS) + 1))})",
        [[s.get(c) for c in COLUMNS] + [v.tobytes()] for s, v in zip(stories, vecs)],
    )
    con.executemany("INSERT INTO meta VALUES (?, ?)",
                    [("embedding_model", MODEL), ("embedding_dim", str(vecs.shape[1])), ("source", source)])
    con.commit()

    print(f"\nWrote {db_path}")
    for t, n, y, m, no in con.execute(
        "SELECT decision_type, COUNT(*), SUM(regret='yes'), SUM(regret='mixed'), SUM(regret='no') "
        "FROM stories GROUP BY decision_type ORDER BY 2 DESC"):
        print(f"  {t:14} {n:>4}  regret yes/mixed/no = {y}/{m}/{no}")
    con.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=str(STORIES))
    ap.add_argument("--db", default=str(DB))
    ap.add_argument("--source", default="stackexchange", help="stackexchange | form | mock")
    args = ap.parse_args()
    build(args.input, args.db, args.source)


if __name__ == "__main__":
    main()
