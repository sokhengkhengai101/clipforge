"""Interface តែមួយសម្រាប់ LLM ទាំងពីរ: Ollama (local, default) និង Anthropic API (optional).

ហេតុអ្វីត្រូវមាន interface រួម? `highlights.py` មិនគួរដឹងថាវានិយាយទៅ Ollama ឬ API ទេ។
វាគ្រាន់តែហៅ `complete_json(prompt)` ហើយទទួល `dict` មកវិញ។ ថ្ងៃក្រោយបើយើងប្តូរ backend
កូដ highlights មិនត្រូវកែទេ។
"""

import json
import os
import re
from typing import Any

import config


class LLMError(RuntimeError):
    """LLM មិនឆ្លើយ ឬឆ្លើយមិនមែន JSON."""


def _extract_json(text: str) -> Any:
    """ទាញ JSON ចេញពីចម្លើយ LLM ដែលអាចមានអក្សរលើសជុំវិញ.

    Model តូចៗច្រើនតែឆ្លើយបែបនេះ:
        ```json
        {"clips": []}
        ```
        Hope this helps!
    ដូច្នេះយើងលុប code fence រួចយក { ... } ដំបូងដល់ចុងក្រោយ។
    """
    text = text.strip()

    # លុប ```json ... ``` បើមាន
    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # ព្យាយាមម្តងទៀត: យកពី { ដំបូង ដល់ } ចុងក្រោយ (ឬ [ ... ])
    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start, end = text.find(open_ch), text.rfind(close_ch)
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                continue

    raise LLMError(f"LLM ឆ្លើយមិនមែន JSON:\n{text[:400]}")


def _complete_ollama(prompt: str, system: str | None, model: str,
                     temperature: float, max_tokens: int) -> str:
    """ហៅ Ollama ក្នុងម៉ាស៊ីន (http://127.0.0.1:11434)."""
    try:
        import ollama
    except ImportError as e:
        raise LLMError("package `ollama` មិនទាន់ install: pip install ollama") from e

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    try:
        client = ollama.Client(host=config.OLLAMA_HOST)
        response = client.chat(
            model=model,
            messages=messages,
            format="json",          # Ollama បង្ខំ output ឲ្យជា valid JSON
            options={"temperature": temperature, "num_predict": max_tokens},
        )
    except Exception as e:
        raise LLMError(
            f"ហៅ Ollama មិនបាន ({config.OLLAMA_HOST}, model={model}): {e}\n"
            f"ពិនិត្យ: ollama list   |   ollama pull {model}"
        ) from e

    return response["message"]["content"]


def _complete_anthropic(prompt: str, system: str | None, model: str,
                        temperature: float, max_tokens: int) -> str:
    """ហៅ Anthropic API (ត្រូវការ ANTHROPIC_API_KEY).

    ចំណាំ: path នេះមិនទាន់បានតេស្តលើម៉ាស៊ីននេះទេ ព្រោះយើងគ្មាន API key។
    Ollama ជា default របស់ project (local-first)។
    """
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise LLMError("គ្មាន ANTHROPIC_API_KEY ក្នុង environment")
    try:
        import anthropic
    except ImportError as e:
        raise LLMError("package `anthropic` មិនទាន់ install: pip install anthropic") from e

    client = anthropic.Anthropic(api_key=key)
    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        kwargs["system"] = system

    try:
        response = client.messages.create(**kwargs)
    except Exception as e:
        raise LLMError(f"ហៅ Anthropic API មិនបាន: {e}") from e

    return "".join(block.text for block in response.content if getattr(block, "type", "") == "text")


def complete_json(
    prompt: str,
    *,
    system: str | None = None,
    backend: str | None = None,
    model: str | None = None,
    temperature: float = None,
    max_tokens: int = None,
) -> Any:
    """ផ្ញើ prompt ទៅ LLM ហើយត្រឡប់ JSON ដែល parse រួច (dict ឬ list).

    `backend` = "ollama" (default) ឬ "anthropic"។ បើមិនបញ្ជាក់ យកពី config។
    """
    backend = backend or config.LLM_BACKEND
    temperature = config.LLM_TEMPERATURE if temperature is None else temperature
    max_tokens = config.LLM_MAX_TOKENS if max_tokens is None else max_tokens

    if backend == "ollama":
        raw = _complete_ollama(prompt, system, model or config.OLLAMA_MODEL, temperature, max_tokens)
    elif backend == "anthropic":
        raw = _complete_anthropic(prompt, system, model or config.ANTHROPIC_MODEL, temperature, max_tokens)
    else:
        raise LLMError(f"backend មិនស្គាល់: {backend!r} (ត្រូវជា 'ollama' ឬ 'anthropic')")

    return _extract_json(raw)
