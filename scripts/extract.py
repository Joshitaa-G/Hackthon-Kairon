"""
Been There, step 4: one LLM call per raw post -> structured outcome story (CLAUDE.md §7).

Run:   python scripts/extract.py              # all types, resumes where it stopped
       python scripts/extract.py --limit 5    # quick test on the first 5 new posts
       python scripts/extract.py --models     # list model names your key can use
Needs: pip install openai pydantic, and LLM_* settings in .env
Output: data/stories.jsonl (kept stories), data/extract_skipped.jsonl (not outcome stories)
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app.decision_types import DECISION_TYPES  # noqa: E402
from app.llm import client, llm_json  # noqa: E402

RAW_DIR = ROOT / "data" / "raw"
STORIES = ROOT / "data" / "stories.jsonl"
SKIPPED = ROOT / "data" / "extract_skipped.jsonl"
MAX_BODY_CHARS = 4000  # keeps each call around 1,000 input tokens

LABELS = {t: v["about"] for t, v in DECISION_TYPES.items()}


class Extraction(BaseModel):
    is_outcome_story: bool
    situation: str = ""
    choice: str = ""
    outcome: str = ""
    regret: Optional[Literal["yes", "mixed", "no"]] = None
    main_reason: str = ""
    advice: str = ""
    years_later: Optional[float] = None
    age_at_decision: Optional[int] = None
    quote: str = ""


SYSTEM = """You extract structured outcomes from a single forum post.
Set is_outcome_story true ONLY if the author describes a decision they personally made about {label} AND what happened afterward. Advice without a personal outcome, hypotheticals, other people's stories, and questions are false. A decision on a different topic is false.
If false, return {{"is_outcome_story": false}} and nothing else.
If true, fill every field:
- situation, choice, outcome, main_reason, advice: short plain sentences (max 25 words each), in the third person, based only on the post.
- regret: "yes" if they say they regret it or wish they had chosen differently, "no" if they say they are glad or don't regret it, "mixed" otherwise.
- years_later: number of years between the decision and the time of writing, or null if not stated.
- age_at_decision: their age when they decided, or null if not stated.
- quote: one or two sentences copied EXACTLY, character for character, from the post that best show the outcome (max 300 characters), or "" if none.
Never invent details. Use null for anything not stated.
JSON keys: is_outcome_story, situation, choice, outcome, regret, main_reason, advice, years_later, age_at_decision, quote."""


def read_jsonl(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()]


def append_jsonl(path, row):
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def build_user(post):
    body = post["body"][:MAX_BODY_CHARS]
    title = f"Question title: {post['title']}\n" if post.get("title") else ""
    return f"{title}Post:\n{body}"


def to_story(post, ex):
    quote = ex["quote"].strip()
    if quote and quote not in post["body"]:
        quote = ""  # not verbatim: drop the quote, keep the story (CLAUDE.md §7)
    years = ex["years_later"]
    return {
        "id": post["id"],
        "decision_type": post["decision_type"],
        "is_outcome_story": True,
        "situation": ex["situation"],
        "choice": ex["choice"],
        "outcome": ex["outcome"],
        "regret": ex["regret"] or "mixed",
        "main_reason": ex["main_reason"],
        "advice": ex["advice"],
        "years_later": int(years) if years is not None else None,
        "age_at_decision": ex["age_at_decision"],
        "quote": quote,
        "source_url": post["source_url"],
        "author": post["author"],
        "site": post["site"],
        "license": post["license"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after N new posts")
    ap.add_argument("--models", action="store_true", help="list available models and exit")
    args = ap.parse_args()

    if args.models:
        c, model = client()
        print(f"Configured: {model}")
        for m in sorted(x.id for x in c.models.list()):
            print(" ", m)
        return

    rpm = float(os.environ.get("LLM_RPM", "25"))
    done = {r["id"] for r in read_jsonl(STORIES)} | {r["id"] for r in read_jsonl(SKIPPED)}
    posts = [p for f in sorted(RAW_DIR.glob("*.jsonl")) for p in read_jsonl(f)]
    todo, seen = [], set(done)
    for p in posts:
        if p["id"] not in seen and p["decision_type"] in LABELS:
            todo.append(p)
            seen.add(p["id"])  # a post fetched under two types is extracted once
    if args.limit:
        todo = todo[:args.limit]
    print(f"{len(done)} already done, {len(todo)} to extract")

    kept = skipped = failed = 0
    for i, post in enumerate(todo, 1):
        t0 = time.time()
        try:
            ex = llm_json(SYSTEM.format(label=LABELS[post["decision_type"]]), build_user(post), Extraction)
        except Exception as e:  # noqa: BLE001
            if "per day" in str(e).lower() or "(tpd)" in str(e).lower() or "(rpd)" in str(e).lower():
                print(f"\nDaily limit reached after {i - 1} posts. Switch LLM_* in .env and rerun; it resumes.")
                break
            failed += 1
            print(f"[{i}/{len(todo)}] {post['id']} FAILED: {str(e)[:150]}")
            continue
        if ex["is_outcome_story"] and ex["outcome"]:
            story = to_story(post, ex)
            append_jsonl(STORIES, story)
            kept += 1
            print(f"[{i}/{len(todo)}] {post['id']} KEEP regret={story['regret']} quote={'yes' if story['quote'] else 'no'}")
        else:
            append_jsonl(SKIPPED, {"id": post["id"], "decision_type": post["decision_type"]})
            skipped += 1
            print(f"[{i}/{len(todo)}] {post['id']} skip")
        time.sleep(max(0, 60 / rpm - (time.time() - t0)))

    print(f"\nThis run: kept {kept}, skipped {skipped}, failed {failed} (failed posts retry on the next run)")
    by_type = {}
    for s in read_jsonl(STORIES):
        by_type.setdefault(s["decision_type"], {"yes": 0, "mixed": 0, "no": 0})[s["regret"]] += 1
    print("Stories so far:")
    for t, r in sorted(by_type.items()):
        print(f"  {t:14} {sum(r.values()):>4}  regret yes/mixed/no = {r['yes']}/{r['mixed']}/{r['no']}")


if __name__ == "__main__":
    main()
