"""Preview ផ្ទាល់លើ screen Subtitles: clip គ្មាន caption (`--clean-only`) + cue ពី captions.py."""

import os
import time

import pytest

import config
from pipeline import render as R
from pipeline.highlights import Clip, save_clips
from pipeline.transcribe import Segment, Transcript, Word, save_transcript
from server import clips as SC
from server import media


def make_project(folder):
    """project តូចមួយ: clip ១ (10-20 s) និងពាក្យ ១០ ក្នុងវា (ម្តងមួយវិនាទី)."""
    words = [Word(word=f" word{i}", start=10.0 + i, end=10.8 + i) for i in range(10)]
    transcript = Transcript(language="en", language_probability=1.0, duration=60.0,
                            model="t", device="cpu",
                            segments=[Segment(id=0, start=10.0, end=20.0,
                                              text=" ".join(w.word for w in words), words=words)])
    save_transcript(transcript, folder / "transcript.json")
    save_clips([Clip(start=10.0, end=20.0, title="t")], folder / "clips.json", model="m", prompt="p")
    return folder


def test_render_all_writes_the_clean_copy_beside_the_real_clip(tmp_path, monkeypatch):
    written = []
    monkeypatch.setattr(R, "render_clip",
                        lambda video, clip, out, ass, **k: written.append((out.name, ass)) or out)
    clips = [Clip(start=0, end=20, title="a"), Clip(start=30, end=50, title="b")]
    R.render_all(tmp_path / "v.mp4", clips, tmp_path, None, suffix="_clean")
    assert written == [("clip_01_clean.mp4", None), ("clip_02_clean.mp4", None)]


def test_clean_copy_is_listed_until_the_clips_are_picked_again(tmp_path):
    folder = make_project(tmp_path)
    (folder / "clips").mkdir()
    clean = folder / "clips" / "clip_01_clean.mp4"
    clean.write_bytes(b"x")
    assert "clean" in SC.clips_of_project(folder)[0]["files"]
    # AI ជ្រើសម្តងទៀត (clips.json ថ្មីជាង) -> clip_01 អាចជា clip ផ្សេង -> preview ចាស់
    later = time.time() + 10
    os.utime(folder / "clips.json", (later, later))
    assert "clean" not in SC.clips_of_project(folder)[0]["files"]


def test_the_clean_copy_is_served_but_never_exported(tmp_path):
    clean = tmp_path / "clip_01_clean.mp4"
    clean.write_bytes(b"x")
    found = media.clip_file([{"index": 1, "files": {"clean": str(clean)}}], 1, "clean")
    assert found == (clean, "video/mp4")
    assert "clean" not in media.EXPORTABLE


def test_preview_cues_follow_the_real_wrapping(tmp_path):
    folder = make_project(tmp_path)
    five = SC.preview_cues(folder, 1, words=5)
    three = SC.preview_cues(folder, 1, words=3)
    count = lambda result: sum(len(line["words"]) for cue in result["cues"] for line in cue["lines"])
    assert count(five) == count(three) == 10                 # គ្មានពាក្យបាត់
    assert max(len(c["lines"][0]["words"]) + sum(len(l["words"]) for l in c["lines"][1:])
               for c in three["cues"]) <= 3
    assert len(three["cues"]) > len(five["cues"])
    first = five["cues"][0]
    assert first["start"] == 0.0                              # ពេលធៀបនឹងដើម clip
    assert first["lines"][0]["words"][0]["text"] == "word0"   # display_word: គ្មាន space
    assert five["width"] == 1080 and five["height"] == 1920


def test_preview_cues_position_and_size_without_leaking_config(tmp_path):
    folder = make_project(tmp_path)
    before = (config.CAPTION_FONT_SIZE, config.CAPTION_MARGIN_V, config.CAPTION_POSITION)
    bottom = SC.preview_cues(folder, 1, position="bottom")
    top = SC.preview_cues(folder, 1, position="top")
    small = SC.preview_cues(folder, 1, size=80)
    small_again = SC.preview_cues(folder, 1, size=80)
    assert top["cues"][0]["lines"][0]["y"] < bottom["cues"][0]["lines"][0]["y"]
    assert small["font_size"] == small_again["font_size"] == 88   # មិនគុណបន្តគ្នាទេ
    assert (config.CAPTION_FONT_SIZE, config.CAPTION_MARGIN_V, config.CAPTION_POSITION) == before


@pytest.mark.parametrize("kwargs", [{"words": 1}, {"size": 200}, {"position": "left"}])
def test_preview_cues_reject_bad_values(tmp_path, kwargs):
    folder = make_project(tmp_path)
    with pytest.raises(ValueError):
        SC.preview_cues(folder, 1, **kwargs)


def test_preview_cues_without_a_clip(tmp_path):
    folder = make_project(tmp_path)
    assert SC.preview_cues(folder, 9) is None


def test_auto_puts_preview_cues_on_the_split_seam_like_the_render(tmp_path):
    """shot ជា split -> caption លើស្នាមកណ្តាល (y ជុំវិញ 960), មិនមែនលើមុខមនុស្សទីពីរ."""
    import json
    folder = make_project(tmp_path)
    plain = SC.preview_cues(folder, 1)
    assert plain["layout_known"] is False
    (folder / "clips").mkdir()
    (folder / "clips" / "clip_01_layout.json").write_text(json.dumps(
        {"dominant": "split", "shots": [{"start": 10.0, "end": 20.0, "kind": "split"}]}), encoding="utf-8")
    split = SC.preview_cues(folder, 1)
    forced = SC.preview_cues(folder, 1, position="bottom")
    ys = [line["y"] for line in split["cues"][0]["lines"]]
    assert split["layout_known"] is True
    assert abs(sum(ys) / len(ys) - 960) < 60                 # កណ្តាលអេក្រង់ 1920
    assert forced["cues"][0]["lines"][0]["y"] == plain["cues"][0]["lines"][0]["y"]  # ទីតាំងបង្ខំ


def test_layout_summary_is_written_from_the_plan(tmp_path):
    import json
    from pipeline.reframe import Box, Layout, Segment, save_layout_summary
    box = Box(x=0, y=0, w=10, h=10)
    segments = [Segment(0.0, 4.0, Layout(kind="single", panels=[box])),
                Segment(4.0, 10.0, Layout(kind="split", panels=[box, box]))]
    path = save_layout_summary(segments, tmp_path / "clips" / "clip_01_layout.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["dominant"] == "split"
    assert [shot["kind"] for shot in data["shots"]] == ["single", "split"]


def test_a_single_shot_inside_a_split_clip_stays_in_the_lower_third(tmp_path):
    """Taylor clip 1: ភាគច្រើន split តែ shot មុខម្នាក់ធ្លាប់បាន caption ជិតមាត់ (y ~1060)."""
    import json
    folder = make_project(tmp_path)
    lower = SC.preview_cues(folder, 1)["cues"][0]["lines"][0]["y"]   # គ្មាន layout = lower third
    (folder / "clips").mkdir()
    (folder / "clips" / "clip_01_layout.json").write_text(json.dumps(
        {"dominant": "split", "shots": [{"start": 10.0, "end": 15.0, "kind": "single"},
                                        {"start": 15.0, "end": 20.0, "kind": "split"}]}), encoding="utf-8")
    cues = SC.preview_cues(folder, 1)["cues"]
    assert cues[0]["lines"][0]["y"] == lower                  # cue ដំបូង (10-14.8 s) នៅក្នុង shot single
    assert cues[-1]["lines"][0]["y"] < lower                  # cue ចុងក្រោយនៅក្នុង split -> លើស្នាម
