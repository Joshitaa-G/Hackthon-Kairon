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
import zlib
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app.decision_types import DECISION_TYPES  # noqa: E402
from app.llm import client, llm_json  # noqa: E402

RAW_DIR = ROOT / "data" / "raw"
# EXTRACT_SHARD="0/2" lets two processes (e.g. two models with separate rate limits) split
# the posts; each writes its own files, and embed_load.py reads data/stories*.jsonl.
SHARD = os.environ.get("EXTRACT_SHARD", "")
_SUFFIX = f".shard{SHARD.split('/')[0]}" if SHARD else ""
STORIES = ROOT / "data" / f"stories{_SUFFIX}.jsonl"
SKIPPED = ROOT / "data" / f"extract_skipped{_SUFFIX}.jsonl"
MAX_BODY_CHARS = 3000  # ~800 input tokens; Groq free tier allows 8,000 tokens/min

LABELS = {t: v["about"] for t, v in DECISION_TYPES.items()}  # types we fetched posts for


class Extraction(BaseModel):
    is_outcome_story: bool
    decision_type: str = "other"
    situation: str = ""
    choice: str = ""
    outcome: str = ""
    regret: Optional[Literal["yes", "mixed", "no"]] = None
    main_reason: str = ""
    advice: str = ""
    years_later: Optional[float] = None
    age_at_decision: Optional[int] = None
    quote: str = ""


TYPE_LIST = "\n".join(f"- {t}: {v['about']}" for t, v in DECISION_TYPES.items())

SYSTEM = """You extract structured outcomes from a single forum post. Answer two separate questions first.
1. is_outcome_story: true ONLY if the author describes a decision they personally made AND what happened afterward. Advice without a personal outcome, hypotheticals, other people's stories, and questions are false.
2. decision_type: which decision the author's personal story is about. Pick exactly one id:
""" + TYPE_LIST + """
- other: any other decision (working hours, a project, a bug, a manager, a hobby), even if it mentions careers or jobs.
Rules for picking decision_type:
- Leaving a PhD or master's program before finishing, or choosing grad school vs a job, is grad_vs_work.
- Leaving an academic career (postdoc, lecturer, professor) after finishing a degree, for industry or another field, is career_change.
- Leaving one employer while staying in the same line of work is quit_job.
- Small or everyday choices (what to do with notes, which paper to write, how to answer an email) are other, even if the post mentions a big decision.
- The choice field must describe the big decision itself, not a side detail.
If is_outcome_story is false or decision_type is "other", return {"is_outcome_story": ..., "decision_type": ...} and nothing else.
Otherwise fill every field:
- situation, choice, outcome, main_reason, advice: short plain sentences (max 25 words each), in the third person, always referring to the author as "they", based only on the post.
- regret: "yes" if they say they regret it or wish they had chosen differently, "no" if they say they are glad or don't regret it, "mixed" otherwise.
- years_later: number of years between the decision and the time of writing, or null if not stated.
- age_at_decision: their age when they decided, or null if not stated.
- quote: one or two sentences copied EXACTLY, character for character, from the post that best show the outcome (max 300 characters), or "" if none.
Never invent details. Use null for anything not stated.
JSON keys: is_outcome_story, decision_type, situation, choice, outcome, regret, main_reason, advice, years_later, age_at_decision, quote."""


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
        "decision_type": ex["decision_type"],  # the LLM's pick, not the search that found it
        "fetched_as": post["decision_type"],
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
    ap.add_argument("--type", help="only this decision type")
    ap.add_argument("--models", action="store_true", help="list available models and exit")
    args = ap.parse_args()

    if args.models:
        c, model = client()
        print(f"Configured: {model}")
        for m in sorted(x.id for x in c.models.list()):
            print(" ", m)
        return

    rpm = float(os.environ.get("LLM_RPM", "25"))
    data_dir = ROOT / "data"
    done = {r["id"] for f in data_dir.glob("stories*.jsonl") for r in read_jsonl(f)}
    done |= {r["id"] for f in data_dir.glob("extract_skipped*.jsonl") for r in read_jsonl(f)}
    posts = [p for f in sorted(RAW_DIR.glob("*.jsonl")) for p in read_jsonl(f)]
    todo, seen = [], set(done)
    for p in posts:
        if p["id"] not in seen and p["decision_type"] in LABELS and (not args.type or p["decision_type"] == args.type):
            todo.append(p)
            seen.add(p["id"])  # a post fetched under two types is extracted once
    todo.sort(key=lambda p: p.get("query_kind") != "first_person")  # higher-yield posts first
    if SHARD:
        i_shard, n_shard = map(int, SHARD.split("/"))
        todo = [p for p in todo if zlib.crc32(p["id"].encode()) % n_shard == i_shard]
    if args.limit:
        todo = todo[:args.limit]
    print(f"{len(done)} already done, {len(todo)} to extract")

    kept = skipped = failed = 0
    for i, post in enumerate(todo, 1):
        t0 = time.time()
        try:
            ex = llm_json(SYSTEM, build_user(post), Extraction)
        except Exception as e:  # noqa: BLE001
            if "per day" in str(e).lower() or "(tpd)" in str(e).lower() or "(rpd)" in str(e).lower():
                print(f"\nDaily limit reached after {i - 1} posts. Switch LLM_* in .env and rerun; it resumes.")
                break
            failed += 1
            print(f"[{i}/{len(todo)}] {post['id']} FAILED: {str(e)[:150]}")
            continue
        if ex["is_outcome_story"] and ex["decision_type"] in DECISION_TYPES and ex["outcome"]:
            story = to_story(post, ex)
            append_jsonl(STORIES, story)
            kept += 1
            moved = f" (fetched as {post['decision_type']})" if story["decision_type"] != post["decision_type"] else ""
            print(f"[{i}/{len(todo)}] {post['id']} KEEP {story['decision_type']}{moved} regret={story['regret']} quote={'yes' if story['quote'] else 'no'}")
        else:
            append_jsonl(SKIPPED, {"id": post["id"], "decision_type": post["decision_type"],
                                   "outcome_story": ex["is_outcome_story"], "llm_type": ex["decision_type"]})
            skipped += 1
            why = "off-topic" if ex["is_outcome_story"] else "no outcome"
            print(f"[{i}/{len(todo)}] {post['id']} skip ({why})")
        time.sleep(max(0, 60 / rpm - (time.time() - t0)))

    print(f"\nThis run: kept {kept}, skipped {skipped}, failed {failed} (failed posts retry on the next run)")
    by_type = {}
    for s in (r for f in sorted((ROOT / "data").glob("stories*.jsonl")) for r in read_jsonl(f)):
        by_type.setdefault(s["decision_type"], {"yes": 0, "mixed": 0, "no": 0})[s["regret"]] += 1
    print("Stories so far:")
    for t, r in sorted(by_type.items()):
        print(f"  {t:14} {sum(r.values()):>4}  regret yes/mixed/no = {r['yes']}/{r['mixed']}/{r['no']}")


if __name__ == "__main__":
    main()
