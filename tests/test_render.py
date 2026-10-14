"""Test សម្រាប់ pipeline/render.py.

Test ដែល render ពិតប្រើ `tests/fixtures/sample_5s.mp4` ហើយបន្ថយ resolution +
preset ultrafast (តាម monkeypatch) ដើម្បីឲ្យវារត់ក្នុងមួយវិនាទី។
"""

import pytest

import config
from pipeline import render as R
from pipeline.audio import FFmpegError
from pipeline.highlights import Clip
from tests.test_audio import FIXTURE


@pytest.fixture
def fast_render(monkeypatch):
    """ធ្វើឲ្យ render លឿនសម្រាប់ test (រូបតូច + preset លឿនបំផុត)."""
    monkeypatch.setattr(config, "OUT_WIDTH", 180)
    monkeypatch.setattr(config, "OUT_HEIGHT", 320)
    monkeypatch.setattr(config, "VIDEO_PRESET", "ultrafast")
    monkeypatch.setattr(config, "VIDEO_CRF", 30)


def sample_clip(start: float = 0.0, end: float = 5.0) -> Clip:
    return Clip(start=start, end=end, title="test clip", score=8)


# ---------- compute_crop ----------

def test_crop_from_16_9_keeps_full_height():
    """1920x1080 -> យកកម្ពស់ទាំងអស់, កាត់ទទឹងពីរខាង."""
    w, h, x, y = R.compute_crop(1920, 1080)
    assert (w, h) == (606, 1080)         # 1080 * 9/16 = 607.5 -> បង្គត់ចុះលេខគូ
    assert y == 0
    assert x == (1920 - 606) // 2        # កណ្តាល


def test_crop_from_9_16_is_almost_unchanged():
    """video ដែលជា 9:16 រួចហើយ (ឧ. clip_001.mp4) -> មិនត្រូវកាត់ច្រើន."""
    w, h, x, y = R.compute_crop(1080, 1920)
    assert (w, h) == (1080, 1920)
    assert (x, y) == (0, 0)


def test_crop_from_square_cuts_width():
    """ការ៉េ (1:1) ធាត់ជាង 9:16 -> កាត់ទទឹង រក្សាកម្ពស់ពេញ."""
    w, h, x, y = R.compute_crop(1000, 1000)
    assert (w, h) == (562, 1000)         # 1000 × 0.5625 = 562.5 -> បង្គត់ចុះលេខគូ
    assert (x, y) == (219, 0)            # កណ្តាលផ្ដេក


def test_crop_never_exceeds_source():
    """crop មិនត្រូវធំជាងរូបដើម (បើមិនដូច្នោះ FFmpeg បរាជ័យ)."""
    for width, height in [(640, 360), (1000, 1000), (480, 640), (1920, 1080), (720, 1280)]:
        w, h, x, y = R.compute_crop(width, height)
        assert w <= width and h <= height
        assert x + w <= width and y + h <= height


def test_crop_dimensions_are_even():
    """H.264 (yuv420p) តម្រូវលេខគូ."""
    for width, height in [(641, 361), (1920, 1080), (999, 777)]:
        w, h, _, _ = R.compute_crop(width, height)
        assert w % 2 == 0 and h % 2 == 0


def test_crop_is_centred():
    w, h, x, y = R.compute_crop(1920, 1080)
    assert abs((1920 - w - 2 * x)) <= 1      # ចន្លោះឆ្វេង ≈ ចន្លោះស្តាំ


# ---------- build_filter ----------

def test_build_filter_order_and_parts():
    f = R.build_filter((606, 1080, 657, 0), "clip_01.ass", out_width=1080, out_height=1920)
    assert f.startswith("crop=606:1080:657:0")
    assert "scale=1080:1920" in f
    assert "setsar=1" in f
    assert f.endswith("ass=clip_01.ass")     # burn ចុងក្រោយ (ក្រោយ scale)


def test_build_filter_without_subtitles():
    f = R.build_filter((606, 1080, 657, 0), None)
    assert "ass=" not in f


# ---------- probe ----------

def test_probe_dimensions_on_fixture():
    assert R.probe_dimensions(FIXTURE) == (320, 240)


def test_probe_dimensions_missing_file_raises():
    with pytest.raises(R.RenderError):
        R.probe_dimensions("គ្មាន_file.mp4")


# ---------- render ពិត ----------

def test_render_produces_playable_mp4(tmp_path, fast_render):
    out = R.render_clip(FIXTURE, sample_clip(), tmp_path / "clip_01.mp4")
    assert out.is_file() and out.stat().st_size > 0
    assert R.probe_dimensions(out) == (180, 320)      # 9:16


def test_render_duration_matches_clip(tmp_path, fast_render):
    clip = sample_clip(start=1.0, end=6.0)            # 5 វិនាទី (fixture មាន 5s)
    out = R.render_clip(FIXTURE, clip, tmp_path / "c.mp4")
    from pipeline.audio import probe_duration
    assert abs(probe_duration(out) - 4.0) < 0.6       # fixture ចប់ត្រឹម 5s -> បាន 4s


def test_render_uses_cache(tmp_path, fast_render):
    out1 = R.render_clip(FIXTURE, sample_clip(), tmp_path / "c.mp4")
    mtime = out1.stat().st_mtime_ns
    out2 = R.render_clip(FIXTURE, sample_clip(), tmp_path / "c.mp4")
    assert out2.stat().st_mtime_ns == mtime           # មិន render ម្តងទៀត


def test_render_force_re_renders(tmp_path, fast_render):
    out = R.render_clip(FIXTURE, sample_clip(), tmp_path / "c.mp4")
    out.write_bytes(b"broken")
    again = R.render_clip(FIXTURE, sample_clip(), tmp_path / "c.mp4", force=True)
    assert again.stat().st_size > 100


def test_render_with_subtitles(tmp_path, fast_render):
    """`.ass` ត្រូវ burn បាន (path មាន cwd trick)."""
    ass = tmp_path / "clip_01.ass"
    ass.write_text(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 180\nPlayResY: 320\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,"
        "100,100,0,0,1,2,0,2,10,10,20,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        "Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,hello\n",
        encoding="utf-8",
    )
    out = R.render_clip(FIXTURE, sample_clip(), tmp_path / "clip_01.mp4", ass)
    assert out.is_file() and out.stat().st_size > 0


def test_render_rejects_ass_in_other_folder(tmp_path, fast_render):
    """ការរចនារបស់យើងតម្រូវឲ្យ .ass នៅជាមួយ MP4 (ដើម្បីជៀស path escaping)."""
    other = tmp_path / "elsewhere"
    other.mkdir()
    ass = other / "c.ass"
    ass.write_text("[Script Info]\n", encoding="utf-8")
    with pytest.raises(R.RenderError, match="folder តែមួយ"):
        R.render_clip(FIXTURE, sample_clip(), tmp_path / "c.mp4", ass)


def test_render_missing_subtitle_raises(tmp_path, fast_render):
    with pytest.raises(R.RenderError, match="រកមិនឃើញ subtitle"):
        R.render_clip(FIXTURE, sample_clip(), tmp_path / "c.mp4", tmp_path / "គ្មាន.ass")


def test_render_missing_video_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        R.render_clip("គ្មាន.mp4", sample_clip(), tmp_path / "c.mp4")


# ---------- render_all + verify ----------

def test_render_all_numbers_files(tmp_path, fast_render):
    clips = [sample_clip(0.0, 5.0), sample_clip(0.0, 5.0)]
    seen = []
    paths = R.render_all(FIXTURE, clips, tmp_path,
                         on_progress=lambda i, total, clip: seen.append((i, total)))
    assert [p.name for p in paths] == ["clip_01.mp4", "clip_02.mp4"]
    assert seen == [(1, 2), (2, 2)]


def test_verify_clip_accepts_matching_duration(tmp_path, fast_render):
    clip = sample_clip(0.0, 5.0)
    out = R.render_clip(FIXTURE, clip, tmp_path / "c.mp4")
    assert R.verify_clip(out, clip) == pytest.approx(5.0, abs=0.5)


def test_verify_clip_raises_on_mismatch(tmp_path, fast_render):
    """ចាប់ bug ស្ងាត់ៗ ដូចជា `-ss`/`-t` ខុសកន្លែង."""
    out = R.render_clip(FIXTURE, sample_clip(0.0, 5.0), tmp_path / "c.mp4")
    wrong = Clip(start=0.0, end=60.0, title="ខុស", score=5)
    with pytest.raises(R.RenderError, match="រយៈពេលខុស"):
        R.verify_clip(out, wrong)
