"""Test សម្រាប់ pipeline/highlights.py និង pipeline/llm.py.

គ្មាន test ណាហៅ LLM ពិតទេ — យើងជំនួស `complete_json` ដោយ function សាកល្បង (mocking)
ដូច្នេះ suite នេះរត់ក្នុងមួយវិនាទី ទោះបើ Ollama មិនរត់ក៏ដោយ។
"""

import json

import pytest
from pydantic import ValidationError

import config
from pipeline import highlights as H
from pipeline import llm as L
from pipeline.transcribe import Segment, Transcript


def make_transcript(n_segments: int = 40, seg_len: float = 10.0) -> Transcript:
    """transcript សាកល្បង: segment ច្រើន តម្រៀបតៗគ្នា."""
    segments = [
        Segment(id=i, start=i * seg_len, end=(i + 1) * seg_len, text=f"sentence {i}")
        for i in range(n_segments)
    ]
    return Transcript(
        language="en", language_probability=1.0, duration=n_segments * seg_len,
        model="test", device="cpu", segments=segments,
    )


def make_clip(start: float, end: float, score: float = 5.0, title: str = "t") -> H.Clip:
    return H.Clip(start=start, end=end, title=title, score=score)


# ---------- Clip validation (pydantic) ----------

def test_clip_coerces_types():
    """LLM ឆ្លើយជា string -> pydantic បម្លែងទៅលេខ."""
    clip = H.Clip(start="12", end="45.5", title="  a   b  ", score="8", type="How-To")
    assert clip.start == 12.0 and clip.end == 45.5
    assert clip.title == "a b"          # ដកឃ្លាលើសត្រូវលុប
    assert clip.score == 8.0
    assert clip.type == "howto"         # "How-To" -> "howto"


def test_clip_unknown_type_becomes_insight():
    assert H.Clip(start=0, end=20, title="x", type="banana").type == "insight"


def test_clip_score_is_clamped():
    assert H.Clip(start=0, end=20, title="x", score=99).score == 10.0
    assert H.Clip(start=0, end=20, title="x", score=-5).score == 1.0
    assert H.Clip(start=0, end=20, title="x", score="មិនមែនលេខ").score == 5.0


def test_clip_rejects_end_before_start():
    with pytest.raises(ValidationError):
        H.Clip(start=50, end=10, title="x")


def test_clip_rejects_too_short_and_too_long():
    with pytest.raises(ValidationError):
        H.Clip(start=0, end=1, title="x")          # ខ្លីពេក
    with pytest.raises(ValidationError):
        H.Clip(start=0, end=9999, title="x")       # វែងពេក


def test_clip_rejects_empty_title():
    with pytest.raises(ValidationError):
        H.Clip(start=0, end=30, title="   ")


def test_clip_duration():
    assert make_clip(10, 40).duration == 30


# ---------- chunking ----------

def test_chunks_overlap_correctly():
    transcript = make_transcript(n_segments=40, seg_len=10.0)   # 400s
    chunks = H.chunk_transcript(transcript, chunk_sec=100, overlap_sec=20)

    assert [(c.start, c.end) for c in chunks] == [
        (0.0, 100.0), (80.0, 180.0), (160.0, 260.0), (240.0, 340.0), (320.0, 400.0)
    ]
    # chunk ទី ២ ត្រូវចាប់ផ្តើមមុន chunk ទី ១ ចប់ 20 វិនាទី
    assert chunks[1].start == chunks[0].end - 20


def test_chunk_segments_are_shared_across_overlap():
    """segment ក្នុងតំបន់ត្រួតគ្នាត្រូវលេចក្នុង chunk ទាំងពីរ."""
    transcript = make_transcript(n_segments=20, seg_len=10.0)
    chunks = H.chunk_transcript(transcript, chunk_sec=100, overlap_sec=30)
    ids_first = {s.id for s in chunks[0].segments}
    ids_second = {s.id for s in chunks[1].segments}
    assert ids_first & ids_second, "តំបន់ត្រួតគ្នាត្រូវមាន segment រួម"


def test_chunk_empty_transcript():
    empty = Transcript(language="en", language_probability=1.0, duration=0.0,
                       model="t", device="cpu", segments=[])
    assert H.chunk_transcript(empty) == []


def test_chunk_overlap_must_be_smaller_than_chunk():
    with pytest.raises(ValueError):
        H.chunk_transcript(make_transcript(), chunk_sec=60, overlap_sec=60)


def test_chunk_prompt_text_format():
    transcript = make_transcript(n_segments=2, seg_len=10.0)
    chunk = H.chunk_transcript(transcript, chunk_sec=100, overlap_sec=10)[0]
    assert chunk.as_prompt_text() == "[0.0 - 10.0] sentence 0\n[10.0 - 20.0] sentence 1"


# ---------- prompt ----------

def test_load_prompt_returns_system_and_user():
    system, user = H.load_prompt()
    assert "video editor" in system
    assert "{{TRANSCRIPT}}" in user
    assert "Changelog" not in user        # ផ្នែក changelog មិនត្រូវចូល prompt


def test_load_prompt_missing_section_raises(tmp_path, monkeypatch):
    bad = tmp_path / "bad.md"
    bad.write_text("## System\nhello\n", encoding="utf-8")
    monkeypatch.setattr(config, "PROMPTS_DIR", tmp_path)
    with pytest.raises(H.HighlightsError, match="ខ្វះផ្នែក"):
        H.load_prompt("bad.md")


def test_build_prompt_fills_placeholders_and_keeps_json_braces():
    transcript = make_transcript(n_segments=1, seg_len=20.0)
    chunk = H.chunk_transcript(transcript, chunk_sec=100, overlap_sec=10)[0]
    _, user = H.load_prompt()
    prompt = H.build_prompt(chunk, user, clips_per_chunk=3)

    assert "{{TRANSCRIPT}}" not in prompt and "{{MAX_CLIPS}}" not in prompt
    assert "[0.0 - 20.0] sentence 0" in prompt
    assert '"clips"' in prompt            # JSON example នៅដដែល (មិនត្រូវ crash ដូច .format)


# ---------- parse_clips ----------

def test_parse_clips_from_dict_and_list():
    raw = {"clips": [{"start": 10, "end": 40, "title": "a"}]}
    assert len(H.parse_clips(raw, 100.0)) == 1
    # model ខ្លះឆ្លើយ list ត្រង់ៗ
    assert len(H.parse_clips([{"start": 10, "end": 40, "title": "a"}], 100.0)) == 1


def test_parse_clips_skips_invalid_and_warns():
    warnings = []
    raw = {"clips": [
        {"start": 10, "end": 40, "title": "ល្អ"},
        {"start": 50, "end": 20, "title": "ខូច"},        # end < start
        {"start": 0, "end": 1, "title": "ខ្លីពេក"},
        "មិនមែន dict",
    ]}
    clips = H.parse_clips(raw, 100.0, on_warning=warnings.append)
    assert len(clips) == 1 and clips[0].title == "ល្អ"
    assert len(warnings) == 2            # ២ clip ខុស (string មិនរាប់)


def test_parse_clips_clamps_end_to_video_duration():
    clips = H.parse_clips({"clips": [{"start": 80, "end": 150, "title": "x"}]}, 100.0)
    assert clips[0].end == 100.0


def test_parse_clips_drops_clip_starting_after_video_ends():
    warnings = []
    clips = H.parse_clips({"clips": [{"start": 500, "end": 540, "title": "x"}]}, 100.0,
                          on_warning=warnings.append)
    assert clips == []
    assert "លើសវីដេអូ" in warnings[0]


def test_parse_clips_handles_garbage():
    assert H.parse_clips("មិនមែន JSON object", 100.0) == []
    assert H.parse_clips({"អ្វីផ្សេង": 1}, 100.0) == []


# ---------- dedupe ----------

def test_overlap_seconds():
    assert H.overlap_seconds(make_clip(0, 30), make_clip(20, 50)) == 10
    assert H.overlap_seconds(make_clip(0, 30), make_clip(40, 60)) == 0


def test_dedupe_keeps_higher_score():
    a = make_clip(0, 30, score=6, title="ទាប")
    b = make_clip(5, 35, score=9, title="ខ្ពស់")      # ត្រួតគ្នាច្រើន
    kept = H.dedupe_overlaps([a, b])
    assert len(kept) == 1 and kept[0].title == "ខ្ពស់"


def test_dedupe_keeps_separate_clips():
    kept = H.dedupe_overlaps([make_clip(0, 30), make_clip(100, 130)])
    assert len(kept) == 2


def test_dedupe_allows_small_overlap():
    """ត្រួតតិច (ក្រោម 30%) មិនមែនស្ទួនទេ."""
    kept = H.dedupe_overlaps([make_clip(0, 30, score=9), make_clip(27, 57, score=8)])
    assert len(kept) == 2


# ---------- cache ----------

def test_save_then_load_clips(tmp_path):
    clips = [make_clip(0, 30, score=8, title="a"), make_clip(60, 95, score=6, title="b")]
    path = H.save_clips(clips, tmp_path / "highlights.json", model="m", prompt="p")

    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["model"] == "m" and data["prompt"] == "p"
    assert H.load_clips(path) == clips


def test_load_clips_missing_or_corrupt(tmp_path):
    assert H.load_clips(tmp_path / "គ្មាន.json") is None
    bad = tmp_path / "bad.json"
    bad.write_text("មិនមែន JSON", encoding="utf-8")
    assert H.load_clips(bad) is None


def test_load_clips_old_version(tmp_path):
    path = H.save_clips([make_clip(0, 30)], tmp_path / "h.json", model="m", prompt="p")
    data = json.loads(path.read_text(encoding="utf-8"))
    data["cache_version"] = 999
    path.write_text(json.dumps(data), encoding="utf-8")
    assert H.load_clips(path) is None


# ---------- find_highlights (LLM ត្រូវ mock) ----------

def fake_llm_response(*args, **kwargs):
    """ចម្លើយ LLM សាកល្បង: clip ២ ក្នុងមួយ chunk."""
    return {"clips": [
        {"start": 10, "end": 45, "title": "clip ទី ១", "score": 7, "type": "story"},
        {"start": 200, "end": 240, "title": "clip ទី ២", "score": 9, "type": "insight"},
    ]}


def test_find_highlights_sorts_and_limits(tmp_path, monkeypatch):
    monkeypatch.setattr(H, "complete_json", fake_llm_response)
    clips = H.find_highlights(make_transcript(), max_clips=2,
                              cache_path=tmp_path / "highlights.json")

    assert len(clips) == 2
    assert clips[0].score >= clips[1].score        # តម្រៀបតាម score
    assert (tmp_path / "highlights.json").is_file()  # cache ត្រូវបានសរសេរ


def test_find_highlights_uses_cache_without_llm(tmp_path, monkeypatch):
    cache = tmp_path / "highlights.json"
    H.save_clips([make_clip(0, 30, title="ពី cache")], cache, model="m", prompt="p")

    def must_not_be_called(*args, **kwargs):
        raise AssertionError("LLM ត្រូវបានហៅទោះជាមាន cache!")

    monkeypatch.setattr(H, "complete_json", must_not_be_called)
    clips = H.find_highlights(make_transcript(), cache_path=cache)
    assert clips[0].title == "ពី cache"


def test_find_highlights_force_ignores_cache(tmp_path, monkeypatch):
    cache = tmp_path / "highlights.json"
    H.save_clips([make_clip(0, 30, title="ចាស់")], cache, model="m", prompt="p")
    monkeypatch.setattr(H, "complete_json", fake_llm_response)

    clips = H.find_highlights(make_transcript(), cache_path=cache, force=True, max_clips=5)
    assert all(c.title != "ចាស់" for c in clips)


def test_find_highlights_survives_some_chunk_failures(monkeypatch):
    """chunk ១ បរាជ័យ មិនត្រូវធ្វើឲ្យទាំងអស់ដាច់."""
    calls = {"n": 0}

    def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise L.LLMError("timeout សាកល្បង")
        return fake_llm_response()

    warnings = []
    monkeypatch.setattr(H, "complete_json", flaky)
    clips = H.find_highlights(make_transcript(), on_warning=warnings.append)

    assert clips, "ត្រូវនៅមាន clip ពី chunk ដែលជោគជ័យ"
    assert any("បរាជ័យ" in w for w in warnings)


def test_find_highlights_all_chunks_fail_raises(monkeypatch):
    def always_fail(*args, **kwargs):
        raise L.LLMError("Ollama មិនរត់")

    monkeypatch.setattr(H, "complete_json", always_fail)
    with pytest.raises(H.HighlightsError, match="LLM បរាជ័យលើ chunk"):
        H.find_highlights(make_transcript())


def test_find_highlights_progress_callback(monkeypatch):
    monkeypatch.setattr(H, "complete_json", fake_llm_response)
    seen = []
    H.find_highlights(make_transcript(), on_progress=lambda i, total: seen.append((i, total)))
    assert seen[0][0] == 0
    assert seen[-1][0] == seen[-1][1]      # ចុងក្រោយ = 100%


# ---------- llm._extract_json ----------

def test_extract_json_plain():
    assert L._extract_json('{"a": 1}') == {"a": 1}


def test_extract_json_with_code_fence():
    text = 'ខាងក្រោមជា JSON:\n```json\n{"clips": []}\n```\nអរគុណ!'
    assert L._extract_json(text) == {"clips": []}


def test_extract_json_with_surrounding_text():
    assert L._extract_json('Here you go: {"a": [1, 2]} hope that helps') == {"a": [1, 2]}


def test_extract_json_list():
    assert L._extract_json("[1, 2, 3]") == [1, 2, 3]


def test_extract_json_raises_on_garbage():
    with pytest.raises(L.LLMError, match="មិនមែន JSON"):
        L._extract_json("ខ្ញុំមិនយល់សំណួរទេ")


def test_complete_json_rejects_unknown_backend():
    with pytest.raises(L.LLMError, match="backend មិនស្គាល់"):
        L.complete_json("hi", backend="gemini")
