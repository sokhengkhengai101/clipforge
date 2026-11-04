"""--timeframe: AI អានតែពាក្យក្នុងចន្លោះ ហើយចន្លោះថ្មីមិនប្រើ cache ចាស់."""
import pytest

from pipeline import highlights
from pipeline.boundaries import snap_boundaries
from pipeline.highlights import (Clip, cached_timeframe, chunk_transcript, find_highlights,
                                 full_video_clip, parse_timeframe, save_clips, window_transcript)
from pipeline.transcribe import Segment, Transcript, Word
from server import jobs


def spoken(seconds: int) -> Transcript:
    """មួយប្រយោគរៀងរាល់ 5 s, មួយពាក្យក្នុងមួយវិនាទី."""
    segments = []
    for start in range(0, seconds, 5):
        words = [Word(f" w{at}{'.' if at == start + 4 else ''}", at, at + 0.9) for at in range(start, start + 5)]
        segments.append(Segment(start // 5, start, start + 4.9, "".join(w.word for w in words).strip(), words))
    return Transcript("en", 1.0, float(seconds), "medium", "cuda", segments)


def test_parse_timeframe():
    assert parse_timeframe("60,300", 600) == (60.0, 300.0)
    assert parse_timeframe("all", 600) is None
    assert parse_timeframe("0,599.5", 600) is None      # ស្ទើរពេញ = វីដេអូទាំងមូល
    assert parse_timeframe("60,9999", 600) == (60.0, 600)
    for bad in ("60,100", "abc", "1,2,3"):
        with pytest.raises(ValueError):
            parse_timeframe(bad, 600)


def test_full_video_clip_takes_a_window_shorter_than_a_minute():
    assert parse_timeframe("10,30", 600, minimum=1) == (10.0, 30.0)
    clip = full_video_clip(600, "t", (10.0, 30.0))
    assert (clip.start, clip.end) == (10.0, 30.0)
    whole = full_video_clip(600, "t")
    assert (whole.start, whole.end) == (0.0, 600)


def test_window_keeps_source_times_and_cuts_words_at_the_edges():
    window = window_transcript(spoken(600), (62.0, 180.0))
    assert window.segments[0].start == 62
    assert window.segments[0].text == "w62 w63 w64."
    assert window.segments[-1].words[-1].end <= 180
    assert window.duration == 180
    assert window_transcript(spoken(60), None).duration == 60


def test_chunks_start_at_the_window_not_at_zero():
    chunks = chunk_transcript(window_transcript(spoken(1200), (600.0, 900.0)), start=600.0)
    assert chunks[0].start == 600
    assert [c.index for c in chunks] == list(range(len(chunks)))
    assert all(600 <= s.start and s.end <= 900 for c in chunks for s in c.segments)


def test_llm_sees_only_the_window_and_the_cache_records_it(tmp_path, monkeypatch):
    prompts = []

    def answer(prompt, **_):
        prompts.append(prompt)
        return {"clips": []}

    monkeypatch.setattr(highlights, "complete_json", answer)
    cache = tmp_path / "highlights.json"
    find_highlights(window_transcript(spoken(1200), (600.0, 700.0)), cache_path=cache, timeframe=(600.0, 700.0))
    assert len(prompts) == 2    # ស្គាល់ genre + chunk មួយ
    assert all("w600" in prompt and "w595" not in prompt and "w700" not in prompt for prompt in prompts)
    assert cached_timeframe(cache) == (600.0, 700.0)


def test_a_clip_asked_outside_the_window_snaps_inside():
    window = window_transcript(spoken(600), (100.0, 200.0))
    clip = Clip(start=80, end=130, title="t", hook="h", type="insight", score=9, reason="r")
    final = snap_boundaries([clip], window)
    assert final and final[0].start >= 99.5 and final[0].end <= 200.5


def test_changed_timeframe_is_not_reported_as_cached(tmp_path):
    save_clips([], tmp_path / "highlights.json", model="m", prompt="p", timeframe=(60.0, 300.0))
    assert jobs.timeframe_changes(tmp_path, "60,300") is False
    assert jobs.timeframe_changes(tmp_path, "60,400") is True
    assert jobs.timeframe_changes(tmp_path, "all") is True
    assert jobs.timeframe_changes(tmp_path, None) is False    # render ម្តងទៀត: រក្សាជម្រើស
