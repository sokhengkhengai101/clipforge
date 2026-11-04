"""Ollama ត្រូវទទួល num_ctx, ហើយ prompt ដែលត្រូវកាត់ ត្រូវក្លាយជាកំហុស (មិនមែន 0 clips ស្ងាត់)."""
import sys
import types

import pytest

import config
from pipeline import llm


def fake_ollama(monkeypatch, prompt_tokens, output_tokens=100):
    seen = {}

    class Client:
        def __init__(self, host):
            pass

        def chat(self, **kwargs):
            seen.update(kwargs["options"])
            return {"message": {"content": '{"clips": []}'},
                    "prompt_eval_count": prompt_tokens, "eval_count": output_tokens}

    monkeypatch.setitem(sys.modules, "ollama", types.SimpleNamespace(Client=Client))
    return seen


def test_context_size_is_sent(monkeypatch):
    seen = fake_ollama(monkeypatch, prompt_tokens=4188)
    assert llm.complete_json("x", backend="ollama") == {"clips": []}
    assert seen["num_ctx"] == config.OLLAMA_NUM_CTX


def test_full_context_is_an_error(monkeypatch):
    fake_ollama(monkeypatch, prompt_tokens=config.OLLAMA_NUM_CTX - 50, output_tokens=50)
    with pytest.raises(llm.LLMError, match="context"):
        llm.complete_json("x", backend="ollama")
