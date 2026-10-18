"""/match: turn a young adult's free text into one decision type from the fixed list."""

import re

from . import safety
from .decision_types import DECISION_TYPES
from .llm import llm_json
from .models import MatchOut, MatchResponse
from .retrieval import nearest_types

LOW_CONFIDENCE = 0.6
_KEYWORDS = {t: [re.compile(p, re.I) for p in v["keywords"]] for t, v in DECISION_TYPES.items()}

SYSTEM = (
    "A young adult is considering a decision. Classify it into exactly one of these types:\n"
    + "\n".join(f"- {t}: {v['label']}" for t, v in DECISION_TYPES.items())
    + '\nIf none fit, type = "other". If the text mentions self-harm, suicide, abuse, or danger, '
    'type = "safety".\nReturn JSON {"type": ..., "confidence": 0-1, "restated": short restatement}.'
)


def keyword_types(text: str) -> list[str]:
    return [t for t, pats in _KEYWORDS.items() if any(p.search(text) for p in pats)]


def classify(text: str) -> MatchResponse:
    if safety.is_unsafe(text):
        return MatchResponse(type="safety", confidence=1.0, restated="", safety=safety.response())

    hits = keyword_types(text)
    if len(hits) == 1:  # free fast-path: one clear keyword hit, no LLM call
        t = hits[0]
        return MatchResponse(type=t, confidence=0.95, restated=DECISION_TYPES[t]["label"])

    out = llm_json(SYSTEM, text, MatchOut, role="match", max_tokens=100)
    t = out["type"]
    if t == "safety":
        return MatchResponse(type="safety", confidence=1.0, restated="", safety=safety.response())
    if t not in DECISION_TYPES:  # fixed list only: anything else is "other"
        t = "other"
    conf = min(max(float(out["confidence"]), 0.0), 1.0)
    alternatives = nearest_types(text, n=2) if t == "other" or conf < LOW_CONFIDENCE else []
    restated = DECISION_TYPES[t]["label"] if t in DECISION_TYPES else ""
    return MatchResponse(type=t, confidence=conf, restated=restated, alternatives=alternatives)
