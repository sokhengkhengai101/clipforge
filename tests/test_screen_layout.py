"""Layout `screen`: អេក្រង់/slide ខាងលើ + មនុស្សក្នុង webcam ខាងក្រោម (How-AI-agents)."""
import pytest

import config
from pipeline import captions, reframe as R


@pytest.fixture(autouse=True)
def portrait():
    config.apply_aspect("9:16")
    yield
    config.apply_aspect("9:16")


def face(cx, cy=150, w=38, h=47):
    return R.Face(x=int(cx - w / 2), y=int(cy - h / 2), w=w, h=h, score=0.9)


# មុខ webcam ពិតពី How-AI-agents (640x360): x 42 និង 574, កម្ពស់ 47
LEFT, RIGHT = face(61), face(593)


def test_geometry_slide_on_top_people_below():
    one = R.panel_rects("screen1")
    two = R.panel_rects("screen2")
    assert one == [(0, 0, 1080, 864), (0, 864, 1080, 1056)]
    assert two == [(0, 0, 1080, 864), (0, 864, 540, 1056), (540, 864, 540, 1056)]


def test_no_screen_geometry_on_landscape():
    config.apply_aspect("16:9")
    assert R.panel_rects("screen2") == []


def test_webcam_face_is_small_and_at_the_edge():
    assert R.is_webcam_face(LEFT, 640, 360) and R.is_webcam_face(RIGHT, 640, 360)
    assert not R.is_webcam_face(face(320), 640, 360)               # កណ្តាល = close-up / two-shot
    assert not R.is_webcam_face(face(60, h=150), 640, 360)          # ធំពេក = close-up


def test_region_between_the_tiles_and_slide_box_fills_it():
    region = R.screen_region([LEFT, RIGHT], 640)
    assert region == (114, 539)
    box = R.slide_box(region, 640, 360, 1080 / 864)
    assert abs(box.x - 114) <= 2 and box.w >= 420                   # ទទឹង slide ទាំងមូល
    assert R.screen_region([LEFT], 640) == (114, 640)               # webcam តែមួយ


def test_webcam_box_stays_inside_the_tile():
    box = R.webcam_box(LEFT, 640, 360, 540 / 1056)
    tile = LEFT.w * config.SCREEN_TILE_RATIO
    assert box.w <= tile + 2
    assert box.x <= LEFT.x and box.x + box.w >= LEFT.x + LEFT.w     # មុខនៅក្នុងប្រអប់


@pytest.mark.parametrize("motion, kind", [(0.1, "screen2"), (5.0, "screen2"), (55.0, None)])
def test_screen_layout_needs_a_still_screen(monkeypatch, motion, kind):
    import pipeline.subjects as S
    monkeypatch.setattr(S, "motion_level", lambda *a, **k: motion)
    layout = R.screen_layout(None, 0, 10, (640, 360), [LEFT, RIGHT], LEFT)
    assert (layout.kind if layout else None) == kind
    if layout:
        assert len(layout.panels) == 3 and layout.box is not None


def test_screen_layout_one_person_and_refusals(monkeypatch):
    import pipeline.subjects as S
    monkeypatch.setattr(S, "motion_level", lambda *a, **k: 0.1)
    assert R.screen_layout(None, 0, 10, (640, 360), [RIGHT], RIGHT).kind == "screen1"
    # two-shot ធម្មតា (មុខនៅ 30% / 70%) និងពីរនាក់ម្ខាងតែមួយ = មិនមែន screen
    assert R.screen_layout(None, 0, 10, (640, 360), [face(190), face(450)], None) is None
    assert R.screen_layout(None, 0, 10, (640, 360), [face(40), face(100)], None) is None


def test_parse_layouts_and_auto():
    assert "screen" in R.parse_layouts("auto")
    assert R.parse_layouts("screen") == frozenset({"screen"})
    assert R.parse_layouts("screenshare,fill") == frozenset({"screen", "single"})


def test_captions_sit_on_the_slide_seam():
    assert captions.last_seam("screen2") == 864
    assert captions.line_positions(1, "screen2") == [864]
    assert captions.line_positions(2, "screen1")[0] < 864 < captions.line_positions(2, "screen1")[1]


def test_screen_layout_needs_a_webcam_tile_edge(monkeypatch):
    """wide shot: មុខតូចនៅគែម បន្ទប់ស្ងៀម តែគ្មានគែមប្រអប់ -> មិនមែន screen (Vercel 42:59)."""
    import numpy as np
    import pipeline.subjects as S
    monkeypatch.setattr(S, "motion_level", lambda *a, **k: 0.1)
    room = np.full((360, 640, 3), 90, np.uint8)
    assert R.screen_layout(None, 0, 10, (640, 360), [LEFT, RIGHT], LEFT, room) is None
    tiles = room.copy()
    tiles[60:300, :110] = 200          # ប្រអប់ webcam ឆ្វេង: គែមនៅ x 110, ខ្ពស់ 240 = 5 ដងមុខ
    tiles[60:300, 545:] = 200          # ស្តាំ: គែមនៅ x 545
    assert R.screen_layout(None, 0, 10, (640, 360), [LEFT, RIGHT], LEFT, tiles).kind == "screen2"
    assert R.tile_edge(tiles, LEFT, 640) > config.SCREEN_TILE_EDGE > R.tile_edge(room, LEFT, 640)
