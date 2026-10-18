"""
/report: the Hindsight Report.

  1-3. retrieval.search(): stories of this decision type only, ranked by similarity, top-k
  4.   count regret yes/mixed/no in Python over those top-k
  5.   one LLM call per decision type summarizes reasons/advice and picks quote IDs,
       saved to <db>.summaries.json so the demo makes ~1 call per type in total
  6.   quotes are pulled from the DB by ID; IDs the LLM made up are dropped

The LLM never writes a number or a quote.
"""

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from .decision_types import DECISION_TYPES
from .llm import llm_json
from .models import NationalComparison, Quote, RegretSplit, Report, SummaryOut
from .retrieval import Store, load_store, search

MIN_FOR_PERCENT = 5
MAX_QUOTES = 5
MIN_QUOTES = 3
SUMMARY_MAX = 60  # stories sent to the summary call (~4K tokens)
SUMMARY_FIELDS = ["id", "choice", "outcome", "regret", "main_reason", "advice"]

SYSTEM = (
    "You are given real stories from people who made a decision, as JSON with ids. "
    "Write the 3 most common reasons for regret or no regret, the 3 most common pieces of advice, "
    "and one sentence on what people who didn't regret it did differently. Use only these stories. "
    "Return quote_ids (3-5) of the most representative stories. "
    "Do not write numbers or percentages. Do not quote text yourself.\n"
    "Each list item is one plain sentence (max 20 words). Return exactly this shape:\n"
    '{"top_reasons": ["...", "...", "..."], "top_advice": ["...", "...", "..."], '
    '"no_regret_pattern": "...", "quote_ids": ["id1", "id2", "id3"]}'
)

NATIONAL = {
    "switch_major": NationalComparison(
        text="National survey: 36% of U.S. adults with post-secondary education would change their major",
        source="Gallup, 2017"),
}

_summary_cache: dict = {}
_NUMBERS = re.compile(r"\d+\s*%|\bpercent\b|\b\d+ (of|out of)\b", re.I)


def build_report(decision_type: str, q: str = "", filters: dict = None, store: Store = None,
                 k: int = None) -> Report:
    if decision_type not in DECISION_TYPES:
        raise ValueError(f"Unknown decision type: {decision_type}")
    store = store or load_store()
    stories = [s for s, _ in search(q, decision_type, k=k, store=store)]  # filters: stub until stories have traits

    counts = Counter(s["regret"] for s in stories)
    n = len(stories)
    summary = _summary(store, decision_type) if n else SummaryOut().model_dump()

    kind = "mock stories (test data)" if store.is_mock else "real stories"
    return Report(
        type=decision_type,
        label=DECISION_TYPES[decision_type]["label"],
        story_count=n,
        source_label=f"Estimated from {n} {kind}",
        is_mock=store.is_mock,
        regret=RegretSplit(yes=counts["yes"], mixed=counts["mixed"], no=counts["no"]),
        show_percentages=n >= MIN_FOR_PERCENT,
        top_reasons=_no_numbers(summary["top_reasons"])[:3],
        top_advice=_no_numbers(summary["top_advice"])[:3],
        no_regret_pattern=" ".join(_no_numbers([summary["no_regret_pattern"]])),
        quotes=_quotes(summary["quote_ids"], stories),
        national_comparison=NATIONAL.get(decision_type),
    )


def _summary(store, decision_type) -> dict:
    """Reasons/advice for the whole decision type: one LLM call per type, saved to disk.

    Counts and quotes stay per-question (top-k); the summary describes the decision overall,
    so judges refreshing or a server restart never trigger new LLM calls.
    """
    stories = _summary_stories(store, decision_type)
    key = summary_key(store, decision_type)
    cache = _disk_cache(store)
    if key in cache:
        return cache[key]
    payload = json.dumps([{f: s[f] for f in SUMMARY_FIELDS} for s in stories], ensure_ascii=False)
    try:
        out = llm_json(SYSTEM, f"Stories about {DECISION_TYPES[decision_type]['about']}:\n{payload}",
                       SummaryOut, role="report", max_tokens=400)
    except Exception as e:  # noqa: BLE001  keep the demo alive if the LLM is down
        print(f"summary LLM failed, using code fallback: {e}")
        return _fallback_summary(stories)  # not cached, so the next request retries the LLM
    cache[key] = out
    _cache_file(store).write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


def _summary_stories(store, decision_type):
    return [s for s in store.stories if s["decision_type"] == decision_type][:SUMMARY_MAX]


def summary_key(store, decision_type) -> str:
    ids = sorted(s["id"] for s in _summary_stories(store, decision_type))
    return f"{decision_type}|{hashlib.sha1('|'.join(ids).encode()).hexdigest()[:12]}"  # new data = new key


def has_llm_summary(store, decision_type) -> bool:
    """True if this type's LLM summary is saved (False means reports use the code fallback)."""
    return summary_key(store, decision_type) in _disk_cache(store)


def _cache_file(store) -> Path:
    return store.db_path.with_suffix(".summaries.json")


def _disk_cache(store) -> dict:
    path = str(store.db_path)
    if path not in _summary_cache:
        f = _cache_file(store)
        _summary_cache[path] = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    return _summary_cache[path]


def _fallback_summary(stories) -> dict:
    """Grounded without an LLM: the most common extracted reasons and advice."""
    reasons = Counter(s["main_reason"] for s in stories if s["main_reason"])
    advice = Counter(s["advice"] for s in stories if s["advice"])
    return {"top_reasons": [r for r, _ in reasons.most_common(3)],
            "top_advice": [a for a, _ in advice.most_common(3)],
            "no_regret_pattern": "", "quote_ids": []}


def _quotes(ids, stories) -> list[Quote]:
    """LLM-picked IDs first (only ones we actually retrieved), topped up in rank order."""
    with_quote = {s["id"]: s for s in stories if s["quote"]}
    chosen = list(dict.fromkeys(i for i in ids if i in with_quote))[:MAX_QUOTES]
    for s in stories:
        if len(chosen) >= MIN_QUOTES:
            break
        if s["id"] in with_quote and s["id"] not in chosen:
            chosen.append(s["id"])
    return [Quote(id=i, text=with_quote[i]["quote"], author=with_quote[i]["author"],
                  source_url=with_quote[i]["source_url"], regret=with_quote[i]["regret"]) for i in chosen]


def _no_numbers(items) -> list[str]:
    """Drop any LLM line that sneaks in a statistic; numbers only come from our counts."""
    return [x.strip() for x in items if x and x.strip() and not _NUMBERS.search(x)]


def clear_cache(delete_files=False):
    if delete_files:
        for path in _summary_cache:
            Path(path).with_suffix(".summaries.json").unlink(missing_ok=True)
    _summary_cache.clear()
