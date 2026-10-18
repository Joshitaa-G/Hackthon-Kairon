"""Shared settings: repo root, .env loading, DB path."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_loaded = False


def load_env():
    """Read .env once. Real environment variables win over the file."""
    global _loaded
    if _loaded:
        return
    _loaded = True
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def db_path() -> Path:
    load_env()
    p = Path(os.environ.get("DB_PATH", "data/been_there.sqlite"))
    return p if p.is_absolute() else ROOT / p


def retrieve_k() -> int:
    load_env()
    return int(os.environ.get("RETRIEVE_K", "40"))
