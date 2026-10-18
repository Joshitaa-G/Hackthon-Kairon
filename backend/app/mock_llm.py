"""
Offline stand-in for the LLM (LLM_MOCK=1). Same input/output schemas as the real calls,
deterministic, no key. Used for tests and for building the frontend before keys exist.
"""

import json
from collections import Counter

from .decision_types import DECISION_TYPES

calls = Counter()  # tests read this to prove caching / the keyword fast-path work

BOGUS_ID = "mock-bogus"  # returned on purpose: report.py must drop unknown IDs


def respond(schema, system, user) -> dict:
    name = schema.__name__
    calls[name] += 1
    if name == "MatchOut":
        return _match(user)
    if name == "SummaryOut":
        return _summary(user)
    raise NotImplementedError(f"mock_llm has no stand-in for {name}; use a real key for extraction")


def _match(text):
    from .retrieval import nearest_types  # semantic guess, like a small LLM would make
    t = nearest_types(text, n=1)[0]
    return {"type": t, "confidence": 0.75, "restated": DECISION_TYPES[t]["label"]}


def _summary(user):
    stories = json.loads(user[user.index("["):])
    reasons = Counter(s["main_reason"] for s in stories if s.get("main_reason"))
    advice = Counter(s["advice"] for s in stories if s.get("advice"))
    no_regret = [s for s in stories if s["regret"] == "no"]
    return {
        "top_reasons": [r for r, _ in reasons.most_common(3)],
        "top_advice": [a for a, _ in advice.most_common(3)],
        "no_regret_pattern": f"People who didn't regret it often said: {no_regret[0]['advice']}" if no_regret else "",
        "quote_ids": [s["id"] for s in stories[:3]] + [BOGUS_ID],
    }
