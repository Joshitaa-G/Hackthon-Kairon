"""Pydantic schemas for API responses and LLM outputs (CLAUDE.md §7)."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---- LLM outputs (validated in llm_json) ----

class MatchOut(BaseModel):
    type: str
    confidence: float = 0.0
    restated: str = ""


class SummaryOut(BaseModel):
    top_reasons: list[str] = []
    top_advice: list[str] = []
    no_regret_pattern: str = ""
    quote_ids: list[str] = []


# ---- API ----

class SafetyResponse(BaseModel):
    type: Literal["safety"] = "safety"
    message: str
    resources: list[dict]


class MatchRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class MatchResponse(BaseModel):
    type: str
    confidence: float
    restated: str
    alternatives: list[str] = []
    safety: Optional[SafetyResponse] = None


class RegretSplit(BaseModel):
    yes: int = 0
    mixed: int = 0
    no: int = 0


class Quote(BaseModel):
    id: str
    text: str
    author: str
    source_url: str
    regret: str


class NationalComparison(BaseModel):
    text: str
    source: str


class Report(BaseModel):
    type: str
    label: str
    story_count: int
    source_label: str
    is_mock: bool
    regret: RegretSplit
    show_percentages: bool
    top_reasons: list[str]
    top_advice: list[str]
    no_regret_pattern: str
    quotes: list[Quote]
    national_comparison: Optional[NationalComparison] = None
    people_like_you: Optional[dict] = None
