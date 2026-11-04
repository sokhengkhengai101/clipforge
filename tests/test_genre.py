"""AI ស្គាល់ genre: គ្មាន test ណាហៅ LLM ពិតទេ."""

import json

from pipeline import highlights as H
from pipeline.llm import LLMError
from pipeline.transcribe import Segment, Transcript


def transcript(seconds: int = 600) -> Transcript:
    segments = [Segment(id=t, start=float(t), end=float(t + 10), text=f"w{t}", words=[])
                for t in range(0, seconds, 10)]
    return Transcript(language="en", language_probability=1.0, duration=float(seconds),
                      model="test", device="cpu", segments=segments)


def test_sample_reads_three_parts_of_a_long_video_and_all_of_a_short_one():
    long = H.genre_sample(transcript(1000))
    assert long.count("[...]") == 2
    assert "w100" in long and "w450" in long and "w800" in long
    assert "w0 " not in long and "w300" not in long
    short = H.genre_sample(transcript(100))
    assert "[...]" not in short and "w0" in short and "w90" in short


def test_a_video_can_have_two_genres_but_not_more(monkeypatch):
    answer = {"genres": [" QA ", "podcast", "qa", "webinar"], "reason": "two  hosts"}
    monkeypatch.setattr(H, "complete_json", lambda *a, **k: answer)
    assert H.detect_genre(transcript()) == (["qa", "podcast"], "two hosts")


def test_detect_never_stops_the_job(monkeypatch):
    monkeypatch.setattr(H, "complete_json", lambda *a, **k: {"genres": "podcast"})
    assert H.detect_genre(transcript())[0] == ["podcast"]

    monkeypatch.setattr(H, "complete_json", lambda *a, **k: {"genres": ["cooking", "other"]})
    assert H.detect_genre(transcript())[0] == ["other"]

    def fail(*a, **k):
        raise LLMError("down")
    warnings: list[str] = []
    monkeypatch.setattr(H, "complete_json", fail)
    assert H.detect_genre(transcript(), on_warning=warnings.append) == (["other"], "")
    assert len(warnings) == 1


def test_both_hints_reach_every_chunk_and_the_genres_are_saved(monkeypatch, tmp_path):
    prompts: list[str] = []

    def answer(prompt, **kwargs):
        prompts.append(prompt)
        return {"genres": ["qa", "podcast"], "reason": "questions"} if len(prompts) == 1 else {"clips": []}

    monkeypatch.setattr(H, "complete_json", answer)
    cache = tmp_path / "highlights.json"
    H.find_highlights(transcript(), cache_path=cache)
    assert len(prompts) >= 3
    assert all(H.GENRE_HINTS["qa"] in p and H.GENRE_HINTS["podcast"] in p for p in prompts[1:])
    assert "{{GENRE_HINT}}" not in prompts[1]
    assert H.cached_genres(cache) == (["qa", "podcast"], "questions")
    assert json.loads(cache.read_text(encoding="utf-8"))["genres"] == ["qa", "podcast"]


def test_other_adds_no_hint():
    chunk = H.Chunk(index=0, start=0, end=10)
    assert H.build_prompt(chunk, "[{{GENRE_HINT}}]", 1, ["other"]) == "[]"


def test_a_cache_from_before_genres_reads_as_none(tmp_path):
    cache = tmp_path / "highlights.json"
    cache.write_text('{"clips": []}', encoding="utf-8")
    assert H.cached_genres(cache) is None
    assert H.cached_genres(tmp_path / "missing.json") is None
