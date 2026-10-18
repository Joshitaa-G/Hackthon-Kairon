"""
The one LLM entry point: llm_json(system, user, schema, role) -> dict.

Works with any OpenAI-compatible provider (Cerebras, Groq, Backboard, OpenAI...).
Switch providers with env vars only:
  LLM_BASE_URL, LLM_API_KEY, LLM_MODEL            used for everything by default
  MATCH_LLM_MODEL                                  optional small model for role="match"
  REPORT_LLM_BASE_URL, REPORT_LLM_API_KEY, ...     optional override when role="report"
  LLM_MOCK=1                                       offline stand-in (app/mock_llm.py), no key needed
"""

import json
import os
import re
import time

from openai import APIStatusError, BadRequestError, OpenAI, RateLimitError
from pydantic import BaseModel, ValidationError

from .config import load_env

_clients = {}


def _config(role):
    load_env()
    prefix = "REPORT_LLM_" if role == "report" and os.environ.get("REPORT_LLM_API_KEY") else "LLM_"
    base_url = os.environ.get(prefix + "BASE_URL")
    api_key = os.environ.get(prefix + "API_KEY")
    model = os.environ.get(prefix + "MODEL")
    if role == "match" and os.environ.get("MATCH_LLM_MODEL"):
        model = os.environ["MATCH_LLM_MODEL"]
    if not (base_url and api_key and model) or api_key.startswith("PASTE_"):
        raise RuntimeError(f"Set {prefix}BASE_URL, {prefix}API_KEY and {prefix}MODEL in .env")
    return base_url, api_key, model


def client(role="extract"):
    base_url, api_key, model = _config(role)
    if base_url not in _clients:
        _clients[base_url] = OpenAI(base_url=base_url, api_key=api_key, max_retries=0)
    return _clients[base_url], model


def is_mock() -> bool:
    load_env()
    return os.environ.get("LLM_MOCK") == "1"


def _parse_json(text):
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1)
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start:end + 1])


def llm_json(system, user, schema: type[BaseModel], role="extract", max_tokens=800) -> dict:
    """Ask for JSON, validate against `schema`, retry once on invalid JSON."""
    if is_mock():
        from . import mock_llm
        return schema.model_validate(mock_llm.respond(schema, system, user)).model_dump()

    c, model = client(role)
    messages = [
        {"role": "system", "content": system + "\nRespond with a single JSON object only."},
        {"role": "user", "content": user},
    ]
    last_err = None
    for attempt in range(2):
        resp = _call_with_rate_limit(c, model, messages, max_tokens)
        text = resp.choices[0].message.content or ""
        try:
            return schema.model_validate(_parse_json(text)).model_dump()
        except (ValueError, ValidationError) as e:
            last_err = e
            messages += [
                {"role": "assistant", "content": text},
                {"role": "user", "content": f"That was not valid JSON for the schema ({e}). Return only the corrected JSON object."},
            ]
    raise ValueError(f"LLM returned invalid JSON twice: {last_err}")


def _call_with_rate_limit(c, model, messages, max_tokens, tries=6):
    extra = {}
    if "gpt-oss" in model:
        # reasoning models spend hidden tokens thinking; keep it short and leave room for the JSON
        extra = {"extra_body": {"reasoning_effort": "low"}}
        max_tokens = max(max_tokens, 1500)
    json_mode = {"response_format": {"type": "json_object"}}
    for attempt in range(tries):
        try:
            return c.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0,
                max_tokens=max_tokens,
                **json_mode,
                **extra,
            )
        except BadRequestError as e:
            # Groq rejects output that fails its JSON check; retry once without JSON mode and
            # let _parse_json + Pydantic validate it instead
            if json_mode and "json" in str(e).lower():
                json_mode = {}
                continue
            raise
        except RateLimitError as e:
            wait = _retry_after(e) or min(60, 5 * 2 ** attempt)
            if _is_daily_limit(e):
                raise
            print(f"    rate limited, waiting {wait:.0f}s")
            time.sleep(wait)
        except APIStatusError as e:
            if e.status_code >= 500 and attempt < tries - 1:
                time.sleep(5)
                continue
            raise
    raise RuntimeError("Still rate limited after retries")


def _retry_after(e):
    try:
        return float(e.response.headers.get("retry-after"))
    except (TypeError, ValueError, AttributeError):
        return None


def _is_daily_limit(e):
    msg = str(e).lower()
    return "per day" in msg or "tokens per day" in msg or "requests per day" in msg or "(tpd)" in msg or "(rpd)" in msg
