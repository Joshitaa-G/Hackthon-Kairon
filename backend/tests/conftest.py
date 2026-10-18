import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MOCK_DB = ROOT / "data" / "mock" / "been_there_mock.sqlite"
MOCK_STORIES = ROOT / "data" / "mock" / "mock_stories.jsonl"

# Tests always run offline against the mock data, whatever .env says.
os.environ["DB_PATH"] = str(MOCK_DB)
os.environ["LLM_MOCK"] = "1"
os.environ["RETRIEVE_K"] = "40"
os.environ["RATE_LIMIT"] = "1000/minute"
sys.path.insert(0, str(ROOT / "backend"))

if not MOCK_DB.exists():
    spec = importlib.util.spec_from_file_location("embed_load", ROOT / "scripts" / "embed_load.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.build(MOCK_STORIES, MOCK_DB, "mock")
