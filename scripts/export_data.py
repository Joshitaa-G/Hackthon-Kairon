"""
Export everything extracted so far for the team to read (safe to run while extraction runs).

Run:   python scripts/export_data.py
Output (data/export/, gitignored except summary.md):
  stories.csv      every kept story with its decision type, regret, quote, author and link
  stories.json     the same, as JSON
  skipped.csv      every post the LLM rejected and why
  summary.md       counts per type, regret split, per model, raw posts fetched
"""

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "export"

# which model wrote each output file (see EXTRACT_SHARD in extract.py)
FILE_MODEL = {"stories.shard0.jsonl": "qwen/qwen3.8-27b", "stories.shard1.jsonl": "openai/gpt-oss-120b",
              "stories.jsonl": "qwen/qwen3.8-27b",
              "extract_skipped.shard0.jsonl": "qwen/qwen3.8-27b",
              "extract_skipped.shard1.jsonl": "openai/gpt-oss-120b",
              "extract_skipped.jsonl": "qwen/qwen3.8-27b"}

COLUMNS = ["id", "decision_type", "fetched_as", "regret", "situation", "choice", "outcome", "main_reason",
           "advice", "years_later", "age_at_decision", "quote", "author", "source_url", "site", "license",
           "extracted_by"]


def read(pattern):
    rows = []
    for f in sorted(DATA.glob(pattern)):
        for line in f.open(encoding="utf-8"):
            if line.strip():
                r = json.loads(line)
                r["extracted_by"] = FILE_MODEL.get(f.name, "unknown")
                rows.append(r)
    return rows


def main():
    OUT.mkdir(exist_ok=True)
    stories = sorted(read("stories*.jsonl"), key=lambda r: (r["decision_type"], r["regret"], r["id"]))
    skipped = read("extract_skipped*.jsonl")
    raw = {f.stem: sum(1 for _ in f.open(encoding="utf-8")) for f in sorted((DATA / "raw").glob("*.jsonl"))}

    with (OUT / "stories.csv").open("w", newline="", encoding="utf-8-sig") as f:  # -sig: opens cleanly in Excel
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(stories)
    (OUT / "stories.json").write_text(json.dumps(stories, ensure_ascii=False, indent=1), encoding="utf-8")
    with (OUT / "skipped.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["id", "fetched_as", "reason", "llm_type", "source_url", "extracted_by"])
        for s in skipped:
            site, pid, kind = s["id"].split("-")[1:4]
            reason = "no personal outcome" if not s.get("outcome_story") else "off-topic"
            w.writerow([s["id"], s["decision_type"], reason, s.get("llm_type", ""),
                        f"https://{site}.stackexchange.com/{kind}/{pid}", s["extracted_by"]])

    by_type = defaultdict(Counter)
    for s in stories:
        by_type[s["decision_type"]][s["regret"]] += 1
    processed = len(stories) + len(skipped)
    lines = [
        "# Been There: extracted data summary", "",
        f"- Raw posts fetched: **{sum(raw.values())}** ({', '.join(f'{k} {v}' for k, v in raw.items())})",
        f"- Processed by the LLM so far: **{processed}** (kept {len(stories)}, skipped {len(skipped)}, "
        f"keep rate {len(stories) / processed:.0%})" if processed else "- Nothing processed yet",
        "", "## Stories per decision type", "",
        "| Type | Stories | Regret yes | Mixed | No | Ready (>= 30)? |", "|---|---|---|---|---|---|",
    ]
    for t, c in sorted(by_type.items(), key=lambda kv: -sum(kv[1].values())):
        n = sum(c.values())
        lines.append(f"| {t} | {n} | {c['yes']} | {c['mixed']} | {c['no']} | {'yes' if n >= 30 else 'not yet'} |")
    lines += ["", "## By model", ""]
    for m, n in Counter(s["extracted_by"] for s in stories).most_common():
        lines.append(f"- {m}: {n} stories")
    moved = sum(1 for s in stories if s.get("fetched_as") and s["fetched_as"] != s["decision_type"])
    lines += ["", f"- Stories reclassified to a different type than the search that found them: {moved}",
              f"- Stories with a verified verbatim quote: {sum(1 for s in stories if s['quote'])}"]
    (OUT / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\nWrote {OUT.relative_to(ROOT)}/stories.csv, stories.json, skipped.csv, summary.md")


if __name__ == "__main__":
    main()
