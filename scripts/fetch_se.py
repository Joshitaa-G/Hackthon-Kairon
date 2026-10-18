"""
Been There, step 3: pull raw outcome-candidate posts from Stack Exchange.

Run:   python scripts/fetch_se.py                  # pass 1: keyword x outcome phrase
       python scripts/fetch_se.py --first-person   # pass 2: "I quit my job" etc., merged in
Needs: Python 3 only (standard library). Uses SE_API_KEY from .env or the environment if set.
Output: data/raw/{decision_type}.jsonl, one post per line.

How it works:
  1. For each decision type, search keyword x outcome phrase with /search/excerpts
     (returns questions and answers) and collect post ids, answers first.
  2. Fetch full bodies in batches of 100 with filter=withbody.
  3. Strip HTML and save with author, link, site, score and date (CC BY-SA attribution).
"""

import argparse
import gzip
import html
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

API = "https://api.stackexchange.com/2.3"
ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
MAX_PER_TYPE = 150
MAX_NEW_FIRST_PERSON = 200

OUTCOME_PHRASES = [
    '"looking back"',
    '"in hindsight"',
    '"I regret"',
    '"don\'t regret"',
    '"years later"',
    '"I did the same"',
]

# Only the types that passed the data check (CLAUDE.md §4, §6 step 1).
# "major" alone matches "major revision" etc., so switch_major uses narrower keywords.
DECISIONS = {
    "switch_major":  ("academia",  ["change major", "switch major", "change field", "switch program"]),
    "grad_vs_work":  ("academia",  ["PhD industry", "leave PhD", "master's job"]),
    "quit_job":      ("workplace", ["quit job", "resign"]),
    "career_change": ("workplace", ["career change", "switch careers"]),
}

# Pass 2 (--first-person): exact first-person phrases. Far more of these hits are someone
# telling what THEY did, which is what extraction keeps. Results merge into the same files.
FIRST_PERSON = {
    "switch_major":  ("academia",  ['"I switched majors"', '"I changed my major"', '"switched my major"',
                                    '"I changed fields"', '"I switched fields"', '"I switched to"']),
    "grad_vs_work":  ("academia",  ['"I left my PhD"', '"I quit my PhD"', '"I left academia"',
                                    '"I dropped out of my PhD"', '"I went to industry"', '"I left the PhD"']),
    "quit_job":      ("workplace", ['"I quit my job"', '"when I quit"', '"I resigned"', '"I left my job"',
                                    '"I handed in my notice"', '"after I quit"']),
    "career_change": ("workplace", ['"I changed careers"', '"I switched careers"', '"my career change"',
                                    '"I made a career change"', '"changed careers"', '"I retrained"']),
}
FIRST_PERSON_PAGES = 2


def load_env():
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def get(path, **params):
    key = os.environ.get("SE_API_KEY")
    if key:
        params["key"] = key
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                raw = resp.read()
            break
        except urllib.error.HTTPError as e:
            body = e.read()
            if body[:2] == b"\x1f\x8b":
                body = gzip.decompress(body)
            print(f"  HTTP {e.code}: {body[:200]!r}")
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    data = json.loads(raw)
    if data.get("backoff"):
        print(f"  backoff {data['backoff']}s")
        time.sleep(data["backoff"])
    time.sleep(0.3)
    return data


class _TextExtractor(HTMLParser):
    BLOCK = {"p", "br", "li", "div", "blockquote", "pre", "h1", "h2", "h3", "h4", "tr"}

    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def strip_html(body):
    p = _TextExtractor()
    p.feed(body)
    text = html.unescape("".join(p.parts))
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def collect_ids(site, queries, pages=1):
    """Return ordered unique (item_type, id) pairs, answers before questions."""
    answers, questions = {}, {}
    for q in queries:
        for page in range(1, pages + 1):
            data = get("/search/excerpts", q=q, site=site, page=page,
                       pagesize=100, sort="relevance", order="desc")
            for item in data.get("items", []):
                if item.get("item_type") == "answer":
                    answers.setdefault(item["answer_id"], None)
                else:
                    questions.setdefault(item["question_id"], None)
            print(f"  {q} p{page}: {len(data.get('items', []))} hits "
                  f"(running: {len(answers)} answers, {len(questions)} questions)")
            if not data.get("has_more"):
                break
    return [("answer", i) for i in answers] + [("question", i) for i in questions]


def fetch_bodies(site, kind, ids):
    out = []
    for start in range(0, len(ids), 100):
        batch = ";".join(str(i) for i in ids[start:start + 100])
        data = get(f"/{kind}s/{batch}", site=site, filter="withbody", pagesize=100)
        out.extend(data.get("items", []))
    return out


def to_record(site, kind, item, decision_type, query_kind):
    pid = item[f"{kind}_id"]
    short = "a" if kind == "answer" else "q"
    owner = item.get("owner", {})
    return {
        "id": f"se-{site}-{pid}-{short}",
        "decision_type": decision_type,
        "site": site,
        "item_type": kind,
        "post_id": pid,
        "question_id": item.get("question_id"),
        "title": html.unescape(item.get("title", "")),
        "author": html.unescape(owner.get("display_name", "anonymous")),
        "source_url": f"https://{site}.stackexchange.com/{short}/{pid}",
        "score": item.get("score", 0),
        "creation_date": item.get("creation_date"),
        "body": strip_html(item.get("body", "")),
        "license": "CC BY-SA 4.0",
        "query_kind": query_kind,  # "first_person" posts are extracted first
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--first-person", action="store_true",
                    help="pass 2: exact first-person phrases, merged into the existing files")
    args = ap.parse_args()
    load_env()
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    if args.first_person:
        plan = {t: (site, qs, FIRST_PERSON_PAGES, "first_person") for t, (site, qs) in FIRST_PERSON.items()}
        cap = MAX_NEW_FIRST_PERSON
    else:
        plan = {t: (site, [f"{kw} {ph}" for kw in kws for ph in OUTCOME_PHRASES], 1, "outcome_phrase")
                for t, (site, kws) in DECISIONS.items()}
        cap = MAX_PER_TYPE

    for decision_type, (site, queries, pages, kind_tag) in plan.items():
        print(f"\n== {decision_type} ({site}, {kind_tag})")
        path = RAW_DIR / f"{decision_type}.jsonl"
        existing = {}
        if args.first_person and path.exists():
            existing = {r["id"]: r for r in map(json.loads, path.open(encoding="utf-8"))}
        short = {"answer": "a", "question": "q"}
        pairs = [(k, i) for k, i in collect_ids(site, queries, pages)
                 if f"se-{site}-{i}-{short[k]}" not in existing][:cap]
        answer_ids = [i for k, i in pairs if k == "answer"]
        question_ids = [i for k, i in pairs if k == "question"]
        items = [("answer", it) for it in fetch_bodies(site, "answer", answer_ids)]
        items += [("question", it) for it in fetch_bodies(site, "question", question_ids)]

        new = [to_record(site, kind, item, decision_type, kind_tag) for kind, item in items]
        new = [r for r in new if len(r["body"]) >= 200]  # too short to hold a story
        rows = list(existing.values()) + new
        with path.open("w", encoding="utf-8") as f:
            for rec in rows:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"  +{len(new)} new, {len(rows)} total -> {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
