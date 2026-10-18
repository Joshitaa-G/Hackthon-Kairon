"""
Retrieval: filter by decision type, THEN vector search inside that type.

We classify the decision first and only search stories of that same type, so the
regret percentage is never mixed across different decisions. At a few hundred to a
few thousand stories a linear NumPy scan is ~1 ms; no vector DB needed.
"""

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .config import db_path, retrieve_k
from .decision_types import DECISION_TYPES

STORY_FIELDS = ["id", "decision_type", "situation", "choice", "outcome", "regret", "main_reason",
                "advice", "years_later", "age_at_decision", "quote", "source_url", "author", "site",
                "license", "source"]


@dataclass
class Store:
    db_path: Path
    model_name: str
    stories: list[dict]
    vecs: np.ndarray          # (n, dim) float32, rows L2-normalized at ingestion
    types: np.ndarray         # (n,) decision_type per row
    by_id: dict = field(default_factory=dict)

    @property
    def is_mock(self) -> bool:
        return bool(self.stories) and all(s.get("source") == "mock" for s in self.stories)

    def type_counts(self) -> dict:
        names, counts = np.unique(self.types, return_counts=True)
        return {str(n): int(c) for n, c in zip(names, counts)}


_stores: dict = {}
_models: dict = {}
_type_vecs: dict = {}


def load_store(path=None) -> Store:
    """Load all stories + embeddings into memory once per DB file."""
    path = Path(path or db_path()).resolve()
    if path in _stores:
        return _stores[path]
    if not path.exists():
        raise FileNotFoundError(f"No database at {path}. Run scripts/embed_load.py first.")
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    meta = dict(con.execute("SELECT key, value FROM meta").fetchall())
    rows = con.execute(f"SELECT {', '.join(STORY_FIELDS)}, embedding FROM stories").fetchall()
    con.close()

    dim = int(meta["embedding_dim"])
    stories = [{k: r[k] for k in STORY_FIELDS} for r in rows]
    vecs = (np.vstack([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])
            if rows else np.zeros((0, dim), dtype=np.float32))
    store = Store(path, meta["embedding_model"], stories, vecs,
                  np.array([s["decision_type"] for s in stories]), {s["id"]: s for s in stories})
    _stores[path] = store
    return store


def _model(name):
    """fastembed runs the same all-MiniLM-L6-v2 weights on ONNX Runtime instead of PyTorch:
    identical vectors (cosine 1.0 vs sentence-transformers) at ~390 MB instead of ~560 MB,
    which fits Render's 512 MB free tier."""
    if name not in _models:
        from fastembed import TextEmbedding  # load lazily
        repo = name if "/" in name else f"sentence-transformers/{name}"
        _models[name] = TextEmbedding(repo)
    return _models[name]


def embed(texts, model_name) -> np.ndarray:
    """Embed with the SAME model the stories were embedded with (read from DB meta)."""
    vecs = np.array(list(_model(model_name).embed(list(texts))), dtype=np.float32)
    return vecs / np.linalg.norm(vecs, axis=1, keepdims=True)


def search(query: str, decision_type: str, k: int = None, store: Store = None) -> list[tuple[dict, float]]:
    """Top-k stories of `decision_type` ranked by cosine similarity to `query`."""
    store = store or load_store()
    k = k or retrieve_k()
    idx = np.flatnonzero(store.types == decision_type)       # 1. filter by type
    if idx.size == 0:
        return []
    if not query.strip():                                     # no query: keep DB order
        order = idx[:k]
        return [(store.stories[i], 0.0) for i in order]
    q = embed([query], store.model_name)[0]
    scores = store.vecs[idx] @ q                              # 2. cosine (vectors are normalized)
    top = np.argsort(-scores, kind="stable")[:k]              # 3. top-k
    return [(store.stories[idx[j]], float(scores[j])) for j in top]


def nearest_types(text: str, n: int = 2, store: Store = None) -> list[str]:
    """Closest decision types by embedding the type descriptions (no LLM)."""
    store = store or load_store()
    if store.model_name not in _type_vecs:
        ids = list(DECISION_TYPES)
        _type_vecs[store.model_name] = (ids, embed([DECISION_TYPES[t]["description"] for t in ids],
                                                   store.model_name))
    ids, vecs = _type_vecs[store.model_name]
    scores = vecs @ embed([text], store.model_name)[0]
    return [ids[i] for i in np.argsort(-scores)[:n]]
