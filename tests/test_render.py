"""Test សម្រាប់ pipeline/render.py.

Test ដែល render ពិតប្រើ `tests/fixtures/sample_5s.mp4` ហើយបន្ថយ resolution +
preset ultrafast (តាម monkeypatch) ដើម្បីឲ្យវារត់ក្នុងមួយវិនាទី។
"""

import subprocess

import pytest

import config
from pipeline import render as R
from pipeline.audio import FFmpegError
from pipeline.highlights import Clip
from pipeline.reframe import Box, Layout, Segment, panel_inner
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


# ---------- filtergraph តាម layout ----------

def layout_split() -> Layout:
    return Layout(kind="split",
                  panels=[Box(x=0, y=0, w=600, h=534),
                          Box(x=600, y=0, w=600, h=534)])


def test_build_layout_filter_split_has_stack():
    f = R.build_layout_filter(layout_split(), out_width=1080, out_height=1920)
    assert f.startswith("[0:v]split=2[p0_0][p0_1];")      # label មានលេខ ដើម្បីកុំជាន់គ្នា
    assert "crop=600:534:0:0" in f and "crop=600:534:600:0" in f
    inner_w, inner_h = panel_inner((0, 0, 1080, 960))
    assert f"scale={inner_w}:{inner_h}" in f   # ផ្ទាំងនីមួយៗខ្ពស់ពាក់កណ្តាល
    assert "vstack=inputs=2" in f
    assert f.endswith("[v]")


def test_build_layout_filter_single():
    layout = Layout(kind="single", box=Box(x=100, y=0, w=606, h=1080))
    f = R.build_layout_filter(layout, out_width=1080, out_height=1920)
    assert "split=2" not in f
    assert "crop=606:1080:100:0" in f and "scale=1080:1920" in f


def test_build_layout_filter_with_subtitles():
    f = R.build_layout_filter(layout_split(), "clip_01.ass")
    assert ",ass=clip_01.ass[v]" in f     # burn ក្រោយ vstack


def test_build_layout_filter_without_box_raises():
    with pytest.raises(R.RenderError, match="គ្មានប្រអប់"):
        R.build_layout_filter(Layout(kind="single"))


# ---------- render ច្រើន segment ----------

def two_segments(start: float, end: float) -> list[Segment]:
    """segment ២: center រួច split (ធ្វើត្រាប់តាមការកាត់ camera)."""
    middle = (start + end) / 2
    return [
        Segment(start=start, end=middle,
                layout=Layout(kind="center", box=Box(x=40, y=0, w=180, h=240))),
        Segment(start=middle, end=end, layout=Layout(
            kind="split",
            panels=[Box(x=0, y=0, w=160, h=142),
                    Box(x=160, y=0, w=160, h=142)])),
    ]


def test_render_with_segments_joins_them(tmp_path, fast_render):
    clip = sample_clip(0.0, 5.0)
    out = R.render_clip(FIXTURE, clip, tmp_path / "c.mp4", segments=two_segments(0.0, 5.0))

    assert out.is_file()
    assert R.probe_dimensions(out) == (180, 320)
    from pipeline.audio import probe_duration
    assert abs(probe_duration(out) - 5.0) < 0.6


def test_render_with_segments_leaves_no_temp_files(tmp_path, fast_render):
    """encode តែម្តង -> មិនមាន file អន្តរកាលទេ."""
    R.render_clip(FIXTURE, sample_clip(0.0, 5.0), tmp_path / "c.mp4",
                  segments=two_segments(0.0, 5.0))
    assert sorted(p.name for p in tmp_path.iterdir()) == ["c.mp4"]


def test_render_with_segments_keeps_every_frame(tmp_path, fast_render):
    """bug ពិត: ការ concat MP4 ដាច់ៗបាត់ frame ១ ក្នុងមួយកន្លែងភ្ជាប់."""
    out = R.render_clip(FIXTURE, sample_clip(0.0, 5.0), tmp_path / "c.mp4",
                        segments=two_segments(0.0, 5.0))
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "frame=pts_time", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True,
    )
    times = sorted(float(line.split(",")[0]) for line in result.stdout.splitlines()
                   if line.strip() and line.split(",")[0])
    gaps = [b - a for a, b in zip(times, times[1:])]
    assert gaps, "ត្រូវមាន frame ច្រើន"
    normal = min(gaps)
    assert max(gaps) < normal * 1.6, f"មានគម្លាតធំ (frame បាត់): {max(gaps):.3f}s"


def test_render_all_passes_plans_through(tmp_path, fast_render):
    clips = [sample_clip(0.0, 5.0)]
    paths = R.render_all(FIXTURE, clips, tmp_path, plans=[two_segments(0.0, 5.0)])
    assert paths[0].is_file()


def test_single_segment_filter_has_no_concat():
    """layout តែមួយ -> graph សាមញ្ញ គ្មាន trim/concat."""
    segments = [Segment(start=10.0, end=20.0,
                        layout=Layout(kind="center", box=Box(x=40, y=0, w=180, h=240)))]
    f = R.build_segments_filter(segments, 10.0)
    assert "concat=" not in f and "trim=" not in f


def test_trim_puts_the_cut_frame_in_the_new_shot():
    """Frame 152 នៅ 24000/1001 fps = 6.339667 s ជាការកាត់: វាត្រូវចូល shot ថ្មី.

    ពីមុន `6.340` (បង្គត់ឡើង) ទុក frame នោះជាមួយ crop ចាស់ -> លោត ១ frame ពេលប្តូរ shot។
    """
    cut = 152 * 1001 / 24000
    start = R.trim_time(cut)
    assert start <= cut < start + 1001 / 24000          # frame 152 >= start
    assert 151 * 1001 / 24000 < start                   # frame 151 នៅ shot មុន
    assert R.trim_time(0.0) == 0.0


def test_segments_filter_trims_relative_to_clip_start():
    """trim ត្រូវរាប់ពីដើម clip ព្រោះ `-ss` បានរំកិលពេលរួចហើយ."""
    segments = two_segments(100.0, 110.0)
    f = R.build_segments_filter(segments, 100.0)
    assert "trim=start=0.000000:end=4.999000" in f
    assert "trim=start=4.999000:end=9.999000" in f
    assert "setpts=PTS-STARTPTS" in f
    assert "concat=n=2:v=1:a=0" in f
    assert f.endswith("[v]")


def test_segments_filter_labels_do_not_collide():
    """chain ច្រើនក្នុង graph តែមួយ -> label ត្រូវខុសគ្នា."""
    segments = two_segments(0.0, 10.0)
    f = R.build_segments_filter(segments, 0.0)
    for label in ("[s0]", "[s1]", "[p0]", "[p1]", "[v0]", "[v1]", "[p1_0]", "[q1_1]"):
        assert f.count(label) >= 1


def test_segments_filter_burns_subtitles_after_concat():
    f = R.build_segments_filter(two_segments(0.0, 10.0), 0.0, "clip_01.ass")
    assert ",ass=clip_01.ass[v]" in f
    assert f.index("concat=") < f.index("ass=clip_01.ass")


def test_render_reruns_when_subtitles_are_newer(tmp_path, fast_render):
    """bug ពិត: caption ប្តូរ តែ MP4 ចាស់នៅ -> អ្នកទទួលលទ្ធផលចាស់ដោយមិនដឹង."""
    import os
    import time

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
    first = out.stat().st_mtime_ns

    # caption ត្រូវបានកែក្រោយ render
    time.sleep(0.05)
    os.utime(ass, (out.stat().st_mtime + 10, out.stat().st_mtime + 10))

    again = R.render_clip(FIXTURE, sample_clip(), tmp_path / "clip_01.mp4", ass)
    assert again.stat().st_mtime_ns != first, "ត្រូវ render ឡើងវិញពេល .ass ថ្មីជាង"


def test_render_keeps_cache_when_subtitles_unchanged(tmp_path, fast_render):
    out = R.render_clip(FIXTURE, sample_clip(), tmp_path / "c.mp4")
    first = out.stat().st_mtime_ns
    again = R.render_clip(FIXTURE, sample_clip(), tmp_path / "c.mp4")
    assert again.stat().st_mtime_ns == first


# ---------- ជម្រើស encoder ----------

def test_x264_args():
    name, args = R.encoder_args("x264")
    assert name == "x264"
    assert args[:2] == ["-c:v", "libx264"]
    assert "-crf" in args


def test_nvenc_args_when_gpu_works(monkeypatch):
    monkeypatch.setattr(R, "nvenc_works", lambda: True)
    name, args = R.encoder_args("nvenc")
    assert name == "nvenc"
    assert args[:2] == ["-c:v", "h264_nvenc"]
    assert "-cq" in args


def test_auto_prefers_gpu(monkeypatch):
    monkeypatch.setattr(R, "nvenc_works", lambda: True)
    assert R.encoder_args("auto")[0] == "nvenc"


def test_auto_falls_back_to_cpu(monkeypatch):
    monkeypatch.setattr(R, "nvenc_works", lambda: False)
    assert R.encoder_args("auto")[0] == "x264"


def test_explicit_nvenc_falls_back_when_gpu_missing(monkeypatch):
    """សុំ GPU តែវាមិនដំណើរការ -> មិនត្រូវដាច់ទេ."""
    monkeypatch.setattr(R, "nvenc_works", lambda: False)
    assert R.encoder_args("nvenc")[0] == "x264"


def test_nvenc_detection_is_cached(monkeypatch):
    """ការសាក encode ចំណាយពេល -> ត្រូវធ្វើតែម្តង."""
    R._nvenc_available.clear()
    calls = []

    def fake_run(*args, **kwargs):
        calls.append(1)
        class Result:
            returncode = 0
        return Result()

    monkeypatch.setattr(R.subprocess, "run", fake_run)
    R.nvenc_works()
    R.nvenc_works()
    assert len(calls) == 1
    R._nvenc_available.clear()


def test_render_uses_the_selected_encoder(tmp_path, fast_render, monkeypatch):
    monkeypatch.setattr(config, "VIDEO_ENCODER", "x264")
    out = R.render_clip(FIXTURE, sample_clip(), tmp_path / "c.mp4")
    assert out.is_file()


def test_long_filtergraph_goes_through_a_script_file(tmp_path, fast_render, monkeypatch):
    """bug ពិត: 47 នាទី -> 360 shots -> filtergraph 55KB -> WinError 206."""
    monkeypatch.setattr(R, "FILTER_INLINE_LIMIT", 10)     # បង្ខំផ្លូវ script
    seen = {}
    real_run = R._run_ffmpeg

    def spy(cmd, cwd, what):
        seen["cmd"] = cmd
        return real_run(cmd, cwd, what)

    monkeypatch.setattr(R, "_run_ffmpeg", spy)
    out = R.render_clip(FIXTURE, sample_clip(0.0, 5.0), tmp_path / "c.mp4",
                        segments=two_segments(0.0, 5.0))
    assert "-/filter_complex" in seen["cmd"]
    assert out.is_file()
    assert not list(tmp_path.glob(".*_filter.txt")), "file filtergraph ត្រូវលុបចោល"


def test_short_filtergraph_stays_inline(tmp_path, fast_render, monkeypatch):
    seen = {}
    real_run = R._run_ffmpeg
    monkeypatch.setattr(R, "_run_ffmpeg",
                        lambda cmd, cwd, what: (seen.update(cmd=cmd), real_run(cmd, cwd, what))[1])
    R.render_clip(FIXTURE, sample_clip(0.0, 5.0), tmp_path / "c.mp4",
                  segments=two_segments(0.0, 5.0))
    assert "-filter_complex" in seen["cmd"] and "-/filter_complex" not in seen["cmd"]


def test_moving_crop_expression_survives_the_filtergraph():
    """crop ដែលរំកិលត្រូវនៅក្នុង quote — បើអត់ FFmpeg អាន comma ជាសញ្ញាបែង filter."""
    expression = "if(lt(t,1.000),100+(t-0.000)*50.00,300)"
    segments = [Segment(start=10.0, end=20.0, layout=Layout(
        kind="single", box=Box(x=200, y=0, w=180, h=240, x_expr=expression)))]
    f = R.build_segments_filter(segments, 10.0)
    assert f"x='({expression})*" in f
    # comma នៃ expression ត្រូវនៅក្នុង quote; ក្រោយ quote គឺ y ហើយមិនមែន filter ថ្មីខុសទេ
    assert f.startswith("[0:v]scale=")
    assert f.split("'")[2].startswith(":y=")


def test_moving_crop_scales_first_so_the_pan_is_smooth():
    """Crop ដែលរំកិល: scale មុន crop -> ជំហាននៅលើ pixel output (មិនលោត 2 px ដើមគុណ 2.67)."""
    box = Box(x=200, y=0, w=404, h=720, x_expr="200+t*12")
    f = R.moving_crop(box, 1080, 1920)
    assert f.index("scale=") < f.index("crop=")
    assert "crop=1080:1920:x='(200+t*12)*2.666667':y=0:exact=1" in f


def test_static_crop_still_crops_first():
    """ប្រអប់នឹងមិនញ័រទេ -> crop មុន (ថោក) ដូចដើម."""
    f = R.build_layout_filter(Layout(kind="single", box=Box(x=200, y=0, w=404, h=720)))
    assert f.index("crop=") < f.index("scale=")


def test_moving_crop_moves_every_frame(tmp_path):
    """Render ពិត: រូបនឹង + crop រំកិល 12 px/s — គ្មាន frame នៅនឹងរួចលោតទៀតទេ.

    មុនការកែ: 75% នៃ frame នៅនឹង ហើយរាល់ frame ទី 4 លោត ~4.8 px (output)។
    """
    import numpy as np
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc2=size=1280x720:rate=24", "-frames:v", "1", str(tmp_path / "s.png")],
                   check=True)
    out = tmp_path / "pan.mp4"
    chain = R.moving_crop(Box(x=200, y=0, w=404, h=720, x_expr="200+t*12"), 1080, 1920)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "24",
                    "-i", str(tmp_path / "s.png"), "-t", "2", "-vf",
                    f"format=yuv420p,{chain},scale=270:480,format=gray",
                    "-f", "rawvideo", str(out)], check=True)
    frames = np.frombuffer(out.read_bytes(), np.uint8).reshape(-1, 480, 270).astype(float)
    # ការរំកិលតាម column: frame ពីរដូចគ្នាបេះបិទ = នៅនឹង
    unchanged = sum(np.abs(a - b).mean() < 0.05 for a, b in zip(frames, frames[1:]))
    assert len(frames) >= 47
    assert unchanged <= 2                  # មុនការកែ 35 / 47


def test_sharpen_runs_after_scaling_and_before_captions():
    """unsharp ត្រូវនៅក្រោយ scale (ដើម្បីសម្អិតរូបដែលពង្រីក) និងមុន ass."""
    layout = Layout(kind="center", box=Box(x=0, y=0, w=180, h=240))
    f = R.build_layout_filter(layout, "c.ass")
    assert f.index("scale=") < f.index("unsharp") < f.index("ass=")


def test_sharpen_applied_once_for_many_segments():
    segments = two_segments(0.0, 10.0)
    assert R.build_segments_filter(segments, 0.0, "c.ass").count("unsharp") == 1


def test_sharpen_can_be_turned_off(monkeypatch):
    monkeypatch.setattr(config, "SHARPEN", "")
    layout = Layout(kind="center", box=Box(x=0, y=0, w=180, h=240))
    assert "unsharp" not in R.build_layout_filter(layout, "c.ass")


def test_three_panels_are_one_big_and_two_small():
    layout = Layout(kind="three", panels=[Box(x=i * 100, y=0, w=300, h=200) for i in range(3)])
    f = R.build_layout_filter(layout)
    assert "[0:v]split=3" in f
    big_w, big_h = panel_inner((0, 0, 1080, 1280))
    small_w, small_h = panel_inner((0, 0, 540, 640))
    assert f"scale={big_w}:{big_h}" in f           # ផ្ទាំងធំខាងលើ
    assert f.count(f"scale={small_w}:{small_h}") == 2   # ពីរតូចខាងក្រោម
    assert "xstack=inputs=3:layout=0_0|0_1280|540_1280" in f


def test_four_panels_use_a_grid():
    layout = Layout(kind="four", panels=[Box(x=i * 100, y=0, w=300, h=200) for i in range(4)])
    f = R.build_layout_filter(layout)
    assert "xstack=inputs=4:layout=0_0|540_0|0_960|540_960" in f
    inner_w, inner_h = panel_inner((0, 0, 540, 960))
    assert f.count(f"scale={inner_w}:{inner_h}") == 4


def test_panel_gap_leaves_a_background_border(monkeypatch):
    """រចនា card: រូបតូចជាងផ្ទាំង ហើយ `pad` បំពេញគម្លាត."""
    monkeypatch.setattr(config, "PANEL_GAP", 24)
    monkeypatch.setattr(config, "PANEL_BACKGROUND", "white")
    layout = Layout(kind="split", panels=[Box(x=0, y=0, w=600, h=534),
                                          Box(x=600, y=0, w=600, h=534)])
    f = R.build_layout_filter(layout, out_width=1080, out_height=1920)
    assert "scale=1056:936" in f
    assert f.count("pad=1080:960:12:12:color=white") == 2


def test_no_gap_means_no_padding(monkeypatch):
    monkeypatch.setattr(config, "PANEL_GAP", 0)
    layout = Layout(kind="split", panels=[Box(x=0, y=0, w=600, h=534),
                                          Box(x=600, y=0, w=600, h=534)])
    f = R.build_layout_filter(layout, out_width=1080, out_height=1920)
    assert "pad=" not in f
    assert "scale=1080:960" in f


# ---------- ជ្រុងមូល (card style) ----------

def test_background_rgb_names_and_hex():
    assert R.background_rgb("white") == (255, 255, 255)
    assert R.background_rgb("#1A2B3C") == (0x1A, 0x2B, 0x3C)
    assert R.background_rgb("0xff0000") == (255, 0, 0)


def test_corner_mask_is_skipped_without_a_radius(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "PANEL_CORNER_RADIUS", 0)
    assert R.corner_mask("three", tmp_path / "m.png") is None


def test_corner_mask_rounds_the_panel_corners(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "PANEL_CORNER_RADIUS", 28)
    monkeypatch.setattr(config, "PANEL_GAP", 24)
    path = R.corner_mask("split", tmp_path / "m.png")
    assert path is not None and path.stat().st_size > 0

    import numpy as np
    raw = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
         "-pix_fmt", "rgba", "-f", "rawvideo", "-"], capture_output=True).stdout
    mask = np.frombuffer(raw, dtype=np.uint8).reshape(config.OUT_HEIGHT, config.OUT_WIDTH, 4)
    # ជ្រុងផ្ទាំង = ស្រទាប់ស (លាប), កណ្តាលផ្ទាំង = ថ្លា (មិនប៉ះរូប)
    assert mask[12, 12, 3] == 255
    assert mask[480, 540, 3] == 0


def test_mask_kinds_needs_both_gap_and_radius(monkeypatch):
    segments = [Segment(start=0, end=5, layout=Layout(
        kind="three", panels=[Box(x=0, y=0, w=300, h=200)] * 3))]
    monkeypatch.setattr(config, "PANEL_CORNER_RADIUS", 28)
    monkeypatch.setattr(config, "PANEL_GAP", 24)
    assert R.mask_kinds(segments) == ["three"]
    monkeypatch.setattr(config, "PANEL_GAP", 0)
    assert R.mask_kinds(segments) == []


def test_mask_input_is_split_per_segment_that_uses_it():
    """input មួយប្រើបានតែម្តងក្នុង filtergraph -> ត្រូវ `split` តាមចំនួនប្រើ."""
    panels = [Box(x=0, y=0, w=300, h=200)] * 3
    segments = [Segment(start=0, end=5, layout=Layout(kind="three", panels=panels)),
                Segment(start=5, end=10, layout=Layout(kind="single",
                                                       box=Box(x=0, y=0, w=300, h=500))),
                Segment(start=10, end=15, layout=Layout(kind="three", panels=panels))]
    f = R.build_segments_filter(segments, 0.0, "c.ass", masks={"three": 1})
    assert "[1:v]split=2" in f
    assert f.count("overlay=0:0") == 2
    # caption ត្រូវដុតក្រោយ overlay ដើម្បីកុំឲ្យ mask កាត់អក្សរ
    assert f.index("overlay=0:0") < f.index("ass=c.ass")


def test_fit_keeps_the_whole_frame_over_a_blurred_copy():
    """Slide មិនត្រូវកាត់ទេ — រូបពេញនៅកណ្តាល ផ្ទៃខាងក្រោយជាច្បាប់ចម្លងព្រិល."""
    f = R.build_layout_filter(Layout(kind="fit"), "c.ass")
    assert "crop=1080:1920" in f            # crop លើ **ផ្ទៃខាងក្រោយ** ប៉ុណ្ណោះ
    assert "boxblur" in f
    assert "overlay=(W-w)/2:(H-h)/2" in f
    assert "force_original_aspect_ratio=increase" in f
    assert f.index("overlay") < f.index("ass=c.ass")


def test_fit_needs_no_crop_box():
    """Layout `fit` គ្មានប្រអប់ — វាមិនត្រូវបោះ error ទេ."""
    assert R.build_layout_filter(Layout(kind="fit")).endswith("[v]")


def test_keyframes_every_two_seconds_for_both_encoders(monkeypatch):
    """NVENC ដាក់ keyframe រៀងរាល់ ២៥០ frames (10.4 s) — seek ក្នុង app យឺត 101-249 ms ហើយ
    WebView2 បង្ហាញរូបខូច. keyframe តាមពេល (2 s) ដូចគ្នាគ្រប់ fps; NVENC ត្រូវការ forced-idr."""
    for name in ("x264", "nvenc"):
        monkeypatch.setattr(R, "encoder_args", lambda encoder=None, name=name: (name, ["-c:v", name]))
        args = R._encode_args(20, "medium")
        assert args[args.index("-force_key_frames") + 1] == f"expr:gte(t,n_forced*{config.KEYFRAME_SEC})"
        assert ("-forced-idr" in args) == (name == "nvenc")
