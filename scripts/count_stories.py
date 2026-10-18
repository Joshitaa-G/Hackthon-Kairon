"""
Been There, step 1 data check: how many outcome stories exist per decision type?

Run:   python scripts/count_stories.py
Needs: Python 3 only (standard library). Uses SE_API_KEY from the environment if set.
Quota: about 60 requests. Without a key the daily limit is about 300.
"""

import gzip
import json
import os
import time
import urllib.parse
import urllib.request

API = "https://api.stackexchange.com/2.3/search/excerpts"
KEEP_THRESHOLD = 30

# Phrases that usually mean someone is describing what actually happened (CLAUDE.md §4)
OUTCOME_PHRASES = [
    '"looking back"',
    '"in hindsight"',
    '"I regret"',
    '"don\'t regret"',
    '"years later"',
    '"I did the same"',
]

# decision type id -> (sites, topic keyword)
DECISIONS = {
    "switch_major":    (["academia"], "major"),
    "grad_vs_work":    (["academia"], "PhD industry"),
    "gap_year":        (["academia"], "gap year"),
    "quit_job":        (["workplace"], "quit job"),
    "career_change":   (["workplace"], "career change"),
    "take_debt":       (["money"], "student loan"),
    "move_abroad":     (["expatriates", "academia"], "moving abroad"),
    "confront_friend": (["interpersonal"], "confront friend"),
}


def count(site, query):
    params = {"q": query, "site": site, "filter": "total"}
    key = os.environ.get("SE_API_KEY")
    if key:
        params["key"] = key
    url = f"{API}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=20) as resp:
        raw = resp.read()
    if raw[:2] == b"\x1f\x8b":  # the API usually gzips responses
        raw = gzip.decompress(raw)
    data = json.loads(raw)
    if data.get("backoff"):
        time.sleep(data["backoff"])
    return data.get("total", 0)


def main():
    print(f"{'Decision':16} {'Site':14} {'Topic posts':>11} {'Outcome posts':>14}")
    print("-" * 62)
    totals = {}
    for decision, (sites, topic) in DECISIONS.items():
        for site in sites:
            topic_total = count(site, topic)
            time.sleep(0.3)
            outcome_total = 0
            for phrase in OUTCOME_PHRASES:
                outcome_total += count(site, f"{topic} {phrase}")
                time.sleep(0.3)
            totals[decision] = totals.get(decision, 0) + outcome_total
            print(f"{decision:16} {site:14} {topic_total:>11} {outcome_total:>14}")

    print("\nKeep (>= %d outcome posts across sites):" % KEEP_THRESHOLD)
    for decision, n in sorted(totals.items(), key=lambda kv: -kv[1]):
        flag = "KEEP" if n >= KEEP_THRESHOLD else "drop"
        print(f"  {flag:4}  {decision:16} {n:>6}")
    print("\nOutcome posts can double-count (one post can match two phrases), so treat")
    print("them as an upper estimate and spot-check about 10 posts per kept type.")


if __name__ == "__main__":
    main()
