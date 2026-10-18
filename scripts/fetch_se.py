"""
Been There, step 3: pull raw outcome-candidate posts from Stack Exchange.

Run:   python scripts/fetch_se.py
Needs: Python 3 only (standard library). Uses SE_API_KEY from .env or the environment if set.
Output: data/raw/{decision_type}.jsonl, one post per line.

How it works:
  1. For each decision type, search keyword x outcome phrase with /search/excerpts
     (returns questions and answers) and collect post ids, answers first.
  2. Fetch full bodies in batches of 100 with filter=withbody.
  3. Strip HTML and save with author, link, site, score and date (CC BY-SA attribution).
"""

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


def collect_ids(site, keywords):
    """Return ordered unique (item_type, id) pairs, answers before questions."""
    answers, questions = {}, {}
    for kw in keywords:
        for phrase in OUTCOME_PHRASES:
            data = get("/search/excerpts", q=f"{kw} {phrase}", site=site,
                       pagesize=100, sort="relevance", order="desc")
            for item in data.get("items", []):
                if item.get("item_type") == "answer":
                    answers.setdefault(item["answer_id"], None)
                else:
                    questions.setdefault(item["question_id"], None)
            print(f"  {kw!r} {phrase}: {len(data.get('items', []))} hits "
                  f"(running: {len(answers)} answers, {len(questions)} questions)")
    return [("answer", i) for i in answers] + [("question", i) for i in questions]


def fetch_bodies(site, kind, ids):
    out = []
    for start in range(0, len(ids), 100):
        batch = ";".join(str(i) for i in ids[start:start + 100])
        data = get(f"/{kind}s/{batch}", site=site, filter="withbody", pagesize=100)
        out.extend(data.get("items", []))
    return out


def to_record(site, kind, item, decision_type):
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
    }


def main():
    load_env()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for decision_type, (site, keywords) in DECISIONS.items():
        print(f"\n== {decision_type} ({site})")
        pairs = collect_ids(site, keywords)[:MAX_PER_TYPE]
        answer_ids = [i for k, i in pairs if k == "answer"]
        question_ids = [i for k, i in pairs if k == "question"]
        items = [("answer", it) for it in fetch_bodies(site, "answer", answer_ids)]
        items += [("question", it) for it in fetch_bodies(site, "question", question_ids)]

        path = RAW_DIR / f"{decision_type}.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for kind, item in items:
                rec = to_record(site, kind, item, decision_type)
                if len(rec["body"]) >= 200:  # too short to hold a story
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        n = sum(1 for _ in path.open(encoding="utf-8"))
        print(f"  saved {n} posts -> {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
