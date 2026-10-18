"""Safety route: some messages get support resources instead of a report (CLAUDE.md §9)."""

import re

from .models import SafetyResponse

_PATTERNS = [
    r"suicid", r"kill (my ?self|me)", r"end (my|it all)\b", r"\bend my life\b", r"want to die",
    r"don'?t want to (live|be alive)", r"self[- ]?harm", r"hurt(ing)? my ?self", r"cut(ting)? my ?self",
    r"overdos", r"\babus(e|ed|ing|ive)\b", r"\b(hits|hit|beats|beat) me\b", r"\bnot safe at home\b",
]
_RE = re.compile("|".join(_PATTERNS), re.I)

MESSAGE = (
    "It sounds like you might be going through something really hard. "
    "You don't have to figure it out alone, and talking to someone can help right now."
)

RESOURCES = [
    {"name": "9-8-8 Suicide Crisis Helpline", "contact": "Call or text 9-8-8", "detail": "Any age, 24/7, Canada"},
    {"name": "Kids Help Phone", "contact": "Call 1-800-668-6868 or text 686868", "detail": "Young people, 24/7"},
    {"name": "Emergency", "contact": "Call 9-1-1", "detail": "If you are in immediate danger"},
]


def is_unsafe(text: str) -> bool:
    return bool(_RE.search(text or ""))


def response() -> SafetyResponse:
    return SafetyResponse(message=MESSAGE, resources=RESOURCES)
