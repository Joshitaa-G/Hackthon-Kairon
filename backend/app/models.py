"""Pydantic schemas for API responses and LLM outputs (CLAUDE.md §7)."""

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


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

    @field_validator("top_reasons", "top_advice", "quote_ids", mode="before")
    @classmethod
    def _flatten(cls, v):
        """Small models sometimes nest lists in dicts ({"regret": [...]}); flatten to strings."""
        out = []

        def walk(x):
            if isinstance(x, dict):
                for item in x.values():
                    walk(item)
            elif isinstance(x, list):
                for item in x:
                    walk(item)
            elif x is not None:
                out.append(str(x))
        walk(v)
        return out

    @field_validator("no_regret_pattern", mode="before")
    @classmethod
    def _join(cls, v):
        return " ".join(v) if isinstance(v, list) else (v or "")


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
