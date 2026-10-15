"""Test សម្រាប់ pipeline/reframe.py.

Test ភាគច្រើនមិនប៉ះ video ទេ — យើងបង្កើត `Face` ដោយដៃ ហើយ monkeypatch ការចាប់មុខ។
មានតែ `detect_cuts` ប៉ុណ្ណោះដែលត្រូវការ video ពិត ហើយយើងសាងវាក្នុង test (៣ វិនាទី)។
"""

import subprocess

import pytest

import config
from pipeline import reframe as R
from pipeline.highlights import Clip

SIZE = (1920, 1080)


def face(cx: float, cy: float = 400, w: int = 100, h: int = 170, score: float = 0.9) -> R.Face:
    """មុខនៅទីតាំងកណ្តាល (cx, cy) — ងាយសរសេរជាង x/y."""
    return R.Face(x=int(cx - w / 2), y=int(cy - h / 2), w=w, h=h, score=score,
                  landmarks=[0.0] * 10)


# ---------- shots ----------

def test_split_into_shots_basic():
    shots = R.split_into_shots(100.0, 130.0, [110.0, 120.0])
    assert shots == [(100.0, 110.0), (110.0, 120.0), (120.0, 130.0)]


def test_split_into_shots_merges_short_ones():
    """scene detection ចាប់ចលនាលឿនជាការកាត់ខុស -> shot ខ្លីត្រូវបញ្ចូលទៅមុន."""
    shots = R.split_into_shots(0.0, 20.0, [5.0, 5.3, 5.6, 12.0], min_shot_sec=1.0)
    # 5.0-5.3 និង 5.3-5.6 ខ្លីពេក -> ត្រូវបានបញ្ចូលទៅ shot ដំបូង (0.0-5.6)
    assert shots == [(0.0, 5.6), (5.6, 12.0), (12.0, 20.0)]


def test_split_into_shots_ignores_cuts_outside_range():
    assert R.split_into_shots(10.0, 20.0, [5.0, 15.0, 25.0]) == [(10.0, 15.0), (15.0, 20.0)]


def test_split_into_shots_without_cuts():
    assert R.split_into_shots(0.0, 30.0, []) == [(0.0, 30.0)]


def test_sample_times_inside_range():
    times = R.sample_times(10.0, 20.0, 3)
    assert len(times) == 3
    assert all(10.0 < t < 20.0 for t in times)
    assert times == sorted(times)


# ---------- ប្រអប់ ----------

def test_center_box_is_9_16_and_centred():
    box = R.center_box(1920, 1080)
    assert (box.w, box.h) == (606, 1080)
    assert abs(box.x - (1920 - 606) // 2) <= 2


def test_single_box_follows_face():
    """close-up ដែលមុខនៅខាងស្តាំ -> ប្រអប់ត្រូវរំកិលទៅស្តាំ."""
    left = R.single_box(face(cx=500), 1920, 1080)
    right = R.single_box(face(cx=1400), 1920, 1080)
    assert left.x < right.x
    assert abs((left.x + left.w / 2) - 500) <= 4


def test_boxes_stay_inside_frame():
    for cx in (0, 50, 960, 1900, 1920):
        for box in (R.single_box(face(cx=cx), 1920, 1080),
                    R.panel_box(face(cx=cx), 1920, 1080)):
            assert box.x >= 0 and box.y >= 0
            assert box.x + box.w <= 1920
            assert box.y + box.h <= 1080


def test_boxes_are_even():
    """H.264 (yuv420p) តម្រូវលេខគូ."""
    for box in (R.center_box(1921, 1081), R.single_box(face(cx=777), 1921, 1081),
                R.panel_box(face(cx=777), 1921, 1081)):
        assert box.w % 2 == 0 and box.h % 2 == 0
        assert box.x % 2 == 0 and box.y % 2 == 0


def test_panel_box_aspect_is_9_8():
    box = R.panel_box(face(cx=960, h=170), 1920, 1080)
    assert abs(box.w / box.h - config.PANEL_ASPECT) < 0.05


def test_panel_zoom_controls_tightness():
    """zoom តូច = ប្រអប់តូច = មុខធំក្នុងផ្ទាំង."""
    loose = R.panel_box(face(cx=960), 1920, 1080, zoom=4.5)
    tight = R.panel_box(face(cx=960), 1920, 1080, zoom=2.0)
    assert tight.h < loose.h


def test_box_as_filter():
    assert R.Box(x=10, y=20, w=300, h=400).as_filter() == "crop=300:400:10:20"


# ---------- embedding ----------

def test_cosine_similarity():
    assert R.cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert R.cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)
    assert R.cosine_similarity([], [1.0]) == 0.0


def test_average_embedding():
    assert R._average_embedding([[1.0, 3.0], [3.0, 5.0]]) == [2.0, 4.0]
    assert R._average_embedding([[], [2.0]]) == [2.0]
    assert R._average_embedding([]) == []


def seats_with(left_emb, right_emb) -> R.Seats:
    return R.Seats(left=face(cx=430), right=face(cx=1430),
                   left_embedding=left_emb, right_embedding=right_emb)


def test_identify_matches_the_closer_person(monkeypatch):
    monkeypatch.setattr(R, "face_embedding", lambda frame, f: [1.0, 0.0])
    seats = seats_with([0.98, 0.2], [0.0, 1.0])
    assert R.identify(object(), face(cx=900), seats) == "left"


def test_identify_returns_none_below_threshold(monkeypatch):
    """មនុស្សទីបី (ឬមុខមិនច្បាស់) មិនត្រូវរាប់ជាអ្នកណាម្នាក់ទេ."""
    monkeypatch.setattr(R, "face_embedding", lambda frame, f: [0.0, 1.0])
    seats = seats_with([1.0, 0.0], [0.99, 0.1])
    assert R.identify(object(), face(cx=900), seats) is None


def test_identify_without_seats():
    assert R.identify(object(), face(cx=900), None) is None


# ---------- plan_shot ----------

def fake_detection(frames_to_faces):
    """ជំនួស grab_frame + detect_faces_in_frame ដោយលទ្ធផលថេរ."""
    def grab(video, t, size):
        return "frame"

    def detect(frame, size):
        return frames_to_faces

    return grab, detect


def test_plan_shot_two_faces_gives_split(monkeypatch):
    grab, detect = fake_detection([face(cx=430), face(cx=1430)])
    monkeypatch.setattr(R, "grab_frame", grab)
    monkeypatch.setattr(R, "detect_faces_in_frame", detect)

    layout = R.plan_shot("v.mp4", 0.0, 5.0, SIZE)
    assert layout.kind == "split"
    assert layout.top is not None and layout.bottom is not None
    assert layout.top.x < layout.bottom.x          # ឆ្វេងនៅលើតាម default


def test_plan_shot_faces_too_close_is_not_split(monkeypatch):
    """មុខ ២ ជិតគ្នា (ឧ. មនុស្សអង្គុយជិតគ្នា) -> មិនមែន two-shot ទេ."""
    grab, detect = fake_detection([face(cx=900), face(cx=1000)])
    monkeypatch.setattr(R, "grab_frame", grab)
    monkeypatch.setattr(R, "detect_faces_in_frame", detect)
    assert R.plan_shot("v.mp4", 0.0, 5.0, SIZE).kind == "single"


def test_plan_shot_one_face_gives_single(monkeypatch):
    grab, detect = fake_detection([face(cx=800, w=280, h=390)])
    monkeypatch.setattr(R, "grab_frame", grab)
    monkeypatch.setattr(R, "detect_faces_in_frame", detect)
    monkeypatch.setattr(R, "identify", lambda frame, f, seats: "right")

    layout = R.plan_shot("v.mp4", 0.0, 5.0, SIZE)
    assert layout.kind == "single" and layout.person == "right"


def test_plan_shot_no_face_gives_center(monkeypatch):
    grab, detect = fake_detection([])
    monkeypatch.setattr(R, "grab_frame", grab)
    monkeypatch.setattr(R, "detect_faces_in_frame", detect)
    assert R.plan_shot("v.mp4", 0.0, 5.0, SIZE).kind == "center"


def test_plan_shot_force_center_skips_detection(monkeypatch):
    def explode(*args, **kwargs):
        raise AssertionError("មិនត្រូវចាប់មុខពេល force=center")

    monkeypatch.setattr(R, "grab_frame", explode)
    assert R.plan_shot("v.mp4", 0.0, 5.0, SIZE, force="center").kind == "center"


# ---------- លំដាប់ផ្ទាំង ----------

def segment(start, end, kind, person=None) -> R.Segment:
    layout = R.Layout(kind=kind, person=person)
    if kind == "split":
        layout.top = R.panel_box(face(cx=430), *SIZE)
        layout.bottom = R.panel_box(face(cx=1430), *SIZE)
    else:
        layout.box = R.center_box(*SIZE)
    return R.Segment(start=start, end=end, layout=layout)


def test_person_with_more_closeup_time_goes_on_top():
    """ច្បាប់ OpusClip: អ្នកនិយាយនៅលើ។ close-up = អ្នកកាត់តបានជ្រើសអ្នកនិយាយរួចហើយ."""
    seats = seats_with([1.0, 0.0], [0.0, 1.0])
    segments = [
        segment(0, 10, "single", person="right"),      # ស្តាំ 10s
        segment(10, 14, "single", person="left"),      # ឆ្វេង 4s
        segment(14, 20, "split"),
    ]
    ordered = R.order_split_panels(segments, SIZE, seats)
    split = [s for s in ordered if s.layout.kind == "split"][0]
    assert split.layout.top.x > split.layout.bottom.x   # ស្តាំឡើងលើ


def test_tie_keeps_left_on_top():
    seats = seats_with([1.0, 0.0], [0.0, 1.0])
    segments = [segment(0, 5, "single", person="left"),
                segment(5, 10, "single", person="right"),
                segment(10, 15, "split")]
    split = [s for s in R.order_split_panels(segments, SIZE, seats)
             if s.layout.kind == "split"][0]
    assert split.layout.top.x < split.layout.bottom.x


def test_split_top_config_overrides(monkeypatch):
    monkeypatch.setattr(config, "SPLIT_TOP", "right")
    seats = seats_with([1.0, 0.0], [0.0, 1.0])
    segments = [segment(0, 10, "single", person="left"), segment(10, 15, "split")]
    split = [s for s in R.order_split_panels(segments, SIZE, seats)
             if s.layout.kind == "split"][0]
    assert split.layout.top.x > split.layout.bottom.x


# ---------- សង្ខេប ----------

def test_describe_and_dominant_kind():
    segments = [segment(0, 10, "single"), segment(10, 14, "split"), segment(14, 16, "center")]
    text = R.describe(segments)
    assert text.startswith("single 10s")
    assert R.dominant_kind(segments) == "single"


def test_dominant_kind_empty():
    assert R.dominant_kind([]) == "center"


# ---------- detect_cuts លើ video ពិត ----------

@pytest.fixture
def three_shot_video(tmp_path):
    """video ៣ វិនាទី ដែលមាន ២ ការកាត់ច្បាស់.

    ប្រើខ្មៅ/ស/ខ្មៅ ព្រោះ FFmpeg គណនា scene score លើពន្លឺ (luma)។ ក្រហម និងបៃតង
    មានពន្លឺជិតគ្នាពេក ហើយការកាត់រវាងវាមិនត្រូវបានចាប់ទេ (យើងសាកឃើញផ្ទាល់)។
    """
    pieces = []
    for index, colour in enumerate(("black", "white", "black")):
        piece = tmp_path / f"p{index}.mp4"
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-f", "lavfi", "-i", f"color={colour}:s=320x180:rate=10", "-t", "1",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", str(piece)],
            check=True,
        )
        pieces.append(piece)

    listing = tmp_path / "list.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in pieces), encoding="utf-8")
    joined = tmp_path / "joined.mp4"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat",
         "-safe", "0", "-i", str(listing), "-c", "copy", str(joined)],
        check=True, cwd=str(tmp_path),
    )
    return joined


def test_detect_cuts_finds_colour_changes(three_shot_video):
    cuts = R.detect_cuts(three_shot_video, 0.0, 3.0)
    assert len(cuts) == 2
    assert cuts[0] == pytest.approx(1.0, abs=0.3)
    assert cuts[1] == pytest.approx(2.0, abs=0.3)


def test_detect_cuts_empty_on_static_video(three_shot_video):
    """ក្នុង shot តែមួយ (0-0.9s) មិនត្រូវមានការកាត់ទេ."""
    assert R.detect_cuts(three_shot_video, 0.0, 0.9) == []


def test_plan_clip_center_mode_skips_detection(monkeypatch):
    def explode(*args, **kwargs):
        raise AssertionError("layout_mode=center មិនត្រូវចាប់មុខ")

    monkeypatch.setattr(R, "detect_cuts", explode)
    clip = Clip(start=0.0, end=30.0, title="x", score=8)
    segments = R.plan_clip("v.mp4", clip, SIZE, layout_mode="center")
    assert len(segments) == 1 and segments[0].layout.kind == "center"


# ---------- ភាពរលូន ----------

def split_segment(start, end, with_fallback=True) -> R.Segment:
    layout = R.Layout(kind="split",
                      top=R.panel_box(face(cx=430), *SIZE),
                      bottom=R.panel_box(face(cx=1430), *SIZE))
    if with_fallback:
        layout.box = R.single_box(face(cx=430), *SIZE)
    return R.Segment(start=start, end=end, layout=layout)


def single_segment(start, end, cx=900) -> R.Segment:
    return R.Segment(start=start, end=end,
                     layout=R.Layout(kind="single", box=R.single_box(face(cx=cx), *SIZE)))


def test_short_split_becomes_single():
    """split ៣ វិនាទីកណ្តាល clip មើលទៅដូចកំហុស — បន្ទាបទៅ single."""
    segments = [single_segment(0, 10), split_segment(10, 13), single_segment(13, 25)]
    smoothed = R.smooth_segments(segments, min_split_sec=4.0)
    assert all(s.layout.kind == "single" for s in smoothed)


def test_long_split_is_kept():
    segments = [single_segment(0, 10), split_segment(10, 20)]
    smoothed = R.smooth_segments(segments, min_split_sec=4.0)
    assert [s.layout.kind for s in smoothed] == ["single", "split"]


def test_short_split_without_fallback_box_is_kept():
    """គ្មានប្រអប់បម្រុង -> កុំខ្ចីប្រអប់ពី shot ផ្សេង (នឹង crop ខុសកន្លែង)."""
    segments = [split_segment(0, 2, with_fallback=False)]
    assert R.smooth_segments(segments, min_split_sec=4.0)[0].layout.kind == "split"


def test_identical_neighbours_are_merged():
    """segment ជាប់គ្នាដែលដូចបេះបិទ -> បញ្ចូលគ្នា (filtergraph ខ្លីជាង)."""
    segments = [single_segment(0, 5, cx=900), single_segment(5, 9, cx=900)]
    smoothed = R.smooth_segments(segments)
    assert len(smoothed) == 1
    assert (smoothed[0].start, smoothed[0].end) == (0, 9)


def test_different_boxes_are_not_merged():
    segments = [single_segment(0, 5, cx=400), single_segment(5, 9, cx=1400)]
    assert len(R.smooth_segments(segments)) == 2


def test_smoothing_preserves_total_time():
    segments = [single_segment(0, 5), split_segment(5, 7), single_segment(7, 20)]
    smoothed = R.smooth_segments(segments, min_split_sec=4.0)
    assert smoothed[0].start == 0 and smoothed[-1].end == 20
    for a, b in zip(smoothed, smoothed[1:]):
        assert a.end == b.start        # គ្មានរន្ធពេលវេលា


def test_short_first_shot_merges_forward():
    """shot ដំបូងគ្មាន shot មុន -> ត្រូវបញ្ចូលទៅ shot បន្ទាប់ (clip មិនចាប់ផ្តើមភ្លឹបភ្លែត)."""
    shots = R.split_into_shots(0.0, 20.0, [1.0, 8.0], min_shot_sec=2.0)
    assert shots[0] == (0.0, 8.0)
    assert len(shots) == 2


def test_single_short_shot_is_kept():
    """clip ខ្លីទាំងមូល -> នៅតែត្រូវមាន shot មួយ មិនត្រូវបាត់."""
    assert R.split_into_shots(0.0, 1.0, [], min_shot_sec=2.0) == [(0.0, 1.0)]


def test_real_camera_shots_survive_the_default_merge():
    """bug ពិត: MIN_SHOT_SEC=2.0 បញ្ចូល close-up 1.4s ទៅ shot wide ហើយប្រអប់កៅអី
    ត្រូវបានដាក់លើ camera angle ខុស -> ផ្ទាំង split បង្ហាញតែជញ្ជាំង។
    """
    shots = R.split_into_shots(0.0, 20.0, [5.7, 7.1])      # ប្រើ config default
    assert len(shots) == 3, "shot 1.4s ត្រូវតែរស់ ដើម្បីទទួល layout ផ្ទាល់ខ្លួន"
    assert shots[1] == (5.7, 7.1)
