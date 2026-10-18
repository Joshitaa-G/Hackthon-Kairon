"""
Been There API.

Run from backend/:  uvicorn app.main:app --reload     then open http://127.0.0.1:8000/docs
"""

import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from . import safety
from .config import load_env
from .decision_types import DECISION_TYPES
from .llm import is_mock
from .match import classify
from .models import MatchRequest, MatchResponse, Report, SafetyResponse
from .report import build_report
from .retrieval import load_store

load_env()
RATE = os.environ.get("RATE_LIMIT", "30/minute")

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Been There API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "http://localhost:5173").split(",")],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    store = load_store()
    return {"ok": True, "db": store.db_path.name, "mock_data": store.is_mock, "mock_llm": is_mock(),
            "stories": store.type_counts(), "types": {t: v["label"] for t, v in DECISION_TYPES.items()}}


@app.post("/match", response_model=MatchResponse)
@limiter.limit(RATE)
def match(request: Request, body: MatchRequest):
    return classify(body.text)


@app.get("/report", response_model=Report | SafetyResponse)
@limiter.limit(RATE)
def report(request: Request, type: str, q: str = "", filters: str | None = None):
    if safety.is_unsafe(q):
        return safety.response()
    if type not in DECISION_TYPES:
        raise HTTPException(404, f"Unknown decision type '{type}'. Use one of: {', '.join(DECISION_TYPES)}")
    parsed = dict(f.split(":", 1) for f in filters.split(",") if ":" in f) if filters else None
    return build_report(type, q, parsed)
