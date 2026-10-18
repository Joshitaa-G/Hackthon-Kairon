"""RAG pipeline tests: offline, mock data + mock LLM (see conftest.py)."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import match as match_mod
from app import mock_llm, report
from app.main import app
from app.match import classify
from app.report import build_report
from app.retrieval import load_store, search

client = TestClient(app)

DEMO = [  # docs/demo_script.md
    ("I'm 20, 2nd year bio, I hate labs. Should I switch to CS?", "switch_major"),
    ("I'm 24 and 2 years into a PhD. Should I leave for an industry job?", "grad_vs_work"),
    ("First job out of school, 8 months in, I'm miserable. Should I quit?", "quit_job"),
]

RECALL = [  # query, type, story that should come back in the top 5
    ("I left my PhD for an industry job", "grad_vs_work", "mock-gw01"),
    ("I hate labs in biology, should I switch to computer science?", "switch_major", "mock-sm01"),
    ("my parents want me to stay in engineering", "switch_major", "mock-sm02"),
    ("should I quit my job without another one lined up", "quit_job", "mock-qj02"),
    ("my manager is toxic, should I quit", "quit_job", "mock-qj03"),
    ("should I do a coding bootcamp to get out of marketing", "career_change", "mock-cc01"),
    ("should I take a pay cut to become a chef", "career_change", "mock-cc03"),
    ("should I do a master's in a field with few jobs if it means debt", "grad_vs_work", "mock-gw08"),
]


@pytest.fixture(autouse=True)
def fresh():
    report.clear_cache()
    mock_llm.calls.clear()


# ---- retrieval ----

def test_retrieval_recall_at_5():
    hits = sum(exp in [s["id"] for s, _ in search(q, t, k=5)] for q, t, exp in RECALL)
    assert hits >= 7, f"recall@5 = {hits}/8"


def test_retrieval_only_returns_requested_type():
    # mock-cc11 (career_change) is a near-duplicate of a PhD-leaver story
    results = search("I left my PhD to start a software career", "grad_vs_work")
    assert results and all(s["decision_type"] == "grad_vs_work" for s, _ in results)
    assert "mock-cc11" not in [s["id"] for s, _ in results]


def test_retrieval_scores_sorted_and_k_respected():
    results = search("should I quit", "quit_job", k=4)
    scores = [sc for _, sc in results]
    assert len(results) == 4 and scores == sorted(scores, reverse=True)


# ---- counting ----

def test_counts_are_over_retrieved_top_k():
    q = "should I quit my job"
    for k in (40, 5):
        r = build_report("quit_job", q, k=k)
        top = [s for s, _ in search(q, "quit_job", k=k)]
        assert r.story_count == len(top) == min(k, 10)
        assert r.regret.model_dump() == {v: sum(s["regret"] == v for s in top) for v in ("yes", "mixed", "no")}


def test_counts_match_database_when_k_covers_type():
    con = sqlite3.connect(load_store().db_path)
    expected = dict(con.execute("SELECT regret, COUNT(*) FROM stories WHERE decision_type='switch_major' "
                                "GROUP BY regret").fetchall())
    r = build_report("switch_major", "switch major")
    assert r.regret.model_dump() == {v: expected.get(v, 0) for v in ("yes", "mixed", "no")}


def test_under_five_stories_hides_percentages():
    r = build_report("gap_year", "should I take a gap year")
    assert r.story_count == 3 and r.show_percentages is False


# ---- citations ----

def test_quotes_come_from_db_and_unknown_ids_dropped():
    r = build_report("grad_vs_work", "leave my PhD")
    by_id = load_store().by_id
    assert report.MIN_QUOTES <= len(r.quotes) <= report.MAX_QUOTES
    for qt in r.quotes:
        assert qt.id != mock_llm.BOGUS_ID
        assert qt.text == by_id[qt.id]["quote"] and qt.author and qt.source_url



def test_llm_numbers_are_stripped(monkeypatch):
    monkeypatch.setattr(report, "llm_json", lambda *a, **k: {
        "top_reasons": ["71% regret it", "Lost their friend group"], "top_advice": ["9 out of 10 say wait"],
        "no_regret_pattern": "", "quote_ids": []})
    r = build_report("quit_job", "quit")
    assert r.top_reasons == ["Lost their friend group"] and r.top_advice == []


def test_mock_report_is_labelled_mock():
    r = build_report("quit_job", "quit")
    assert r.is_mock and "mock" in r.source_label


# ---- match ----

def test_keyword_fast_path_uses_no_llm():
    m = classify("should I leave my PhD?")
    assert m.type == "grad_vs_work" and mock_llm.calls["MatchOut"] == 0


def test_unknown_llm_type_becomes_other(monkeypatch):
    monkeypatch.setattr(match_mod, "llm_json", lambda *a, **k: {"type": "astronaut", "confidence": 0.9})
    m = classify("should I move to a new city")
    assert m.type == "other" and len(m.alternatives) == 2


def test_low_confidence_returns_two_alternatives(monkeypatch):
    monkeypatch.setattr(match_mod, "llm_json", lambda *a, **k: {"type": "quit_job", "confidence": 0.4})
    m = classify("not sure what to do with my life")
    assert len(m.alternatives) == 2 and all(a in report.DECISION_TYPES for a in m.alternatives)


# ---- safety ----

def test_safety_route():
    m = classify("I want to hurt myself")
    assert m.type == "safety" and any("9-8-8" in r["contact"] for r in m.safety.resources)
    res = client.get("/report", params={"type": "quit_job", "q": "I want to kill myself"}).json()
    assert res["type"] == "safety" and "story_count" not in res


# ---- cost ----

def test_summary_cached_across_queries():
    build_report("switch_major", "switch to CS")
    build_report("switch_major", "my parents want engineering")  # same top-40 set (type has 10)
    assert mock_llm.calls["SummaryOut"] == 1


# ---- demo path, end to end through the API ----

@pytest.mark.parametrize("text,expected", DEMO)
def test_demo_queries(text, expected):
    m = client.post("/match", json={"text": text}).json()
    assert m["type"] == expected
    r = client.get("/report", params={"type": m["type"], "q": text}).json()
    assert r["show_percentages"] and len(r["quotes"]) >= 3
    assert sum(r["regret"].values()) == r["story_count"]


def test_health_and_unknown_type():
    h = client.get("/health").json()
    assert h["ok"] and h["mock_data"] and h["stories"]["switch_major"] == 10
    assert client.get("/report", params={"type": "astronaut"}).status_code == 404
