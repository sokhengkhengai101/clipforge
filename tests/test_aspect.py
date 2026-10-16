"""Test សម្រាប់ config.apply_aspect() និង split តាមទិសដៅ.

Aspect ratio ប៉ះពាល់តម្លៃជាច្រើន (font, margin, សមាមាត្រផ្ទាំង, ទិស stack) ដូច្នេះ
test ទាំងនេះធានាថាការគណនាទាំងនោះនៅជាប់លាប់។
"""

import pytest

import config
from pipeline import reframe as R
from pipeline import render as Rn


@pytest.fixture(autouse=True)
def restore_aspect():
    """ត្រឡប់ទៅ 9:16 ក្រោយ test នីមួយៗ (apply_aspect ប្តូរ config សកល)."""
    yield
    config.apply_aspect("9:16")


@pytest.mark.parametrize("name,size", [
    ("9:16", (1080, 1920)),
    ("4:5", (1080, 1350)),
    ("1:1", (1080, 1080)),
    ("16:9", (1920, 1080)),
])
def test_presets_give_expected_size(name, size):
    assert config.apply_aspect(name) == size
    assert (config.OUT_WIDTH, config.OUT_HEIGHT) == size


def test_unknown_aspect_raises():
    with pytest.raises(ValueError, match="aspect មិនស្គាល់"):
        config.apply_aspect("3:2")


def test_portrait_stacks_vertically():
    for name in ("9:16", "4:5", "1:1"):
        config.apply_aspect(name)
        assert config.SPLIT_DIRECTION == "vertical"


def test_landscape_stacks_horizontally():
    """ផ្ទាំង 1920×540 នឹងវែងនិងរាក់ពេក -> 16:9 ត្រូវបែងចែកឆ្វេង/ស្តាំ."""
    config.apply_aspect("16:9")
    assert config.SPLIT_DIRECTION == "horizontal"


def test_panel_aspect_matches_half_of_output():
    config.apply_aspect("1:1")
    assert config.PANEL_ASPECT == pytest.approx(1080 / 540)
    config.apply_aspect("16:9")
    assert config.PANEL_ASPECT == pytest.approx(960 / 1080)


def test_caption_scales_with_width_until_the_height_cap():
    """អក្សរធ្វើមាត្រដ្ឋានតាមទទឹង តែដែន 30% នៃកម្ពស់ឈ្នះពេលរូបរាក់."""
    config.apply_aspect("9:16")
    assert config.CAPTION_FONT_SIZE == 110           # ទទឹង 1080, កម្ពស់គ្រប់គ្រាន់
    config.apply_aspect("4:5")
    assert config.CAPTION_FONT_SIZE == 110           # ទទឹងដដែល, នៅមិនទាន់ដល់ដែន
    config.apply_aspect("16:9")
    assert config.CAPTION_FONT_SIZE < 110            # ទទឹងធំជាង តែកម្ពស់រាក់ -> ដែនឈ្នះ


def test_caption_margin_scales_with_height():
    for name in ("9:16", "1:1"):
        config.apply_aspect(name)
        assert config.CAPTION_MARGIN_V == int(config.OUT_HEIGHT * 0.22)


def test_split_caption_sits_on_the_seam_for_portrait():
    config.apply_aspect("9:16")
    block = config.CAPTION_MAX_LINES * config.CAPTION_FONT_SIZE * 1.1
    centre = config.OUT_HEIGHT - config.CAPTION_MARGIN_V_SPLIT - block / 2
    assert centre == pytest.approx(config.OUT_HEIGHT / 2, abs=2)


def test_split_caption_uses_normal_margin_for_landscape():
    """16:9 គ្មានស្នាមផ្ដេក ដូច្នេះមិនត្រូវលើកអក្សរឡើងទេ."""
    config.apply_aspect("16:9")
    assert config.CAPTION_MARGIN_V_SPLIT == config.CAPTION_MARGIN_V


# ---------- filtergraph ----------

def split_layout() -> R.Layout:
    return R.Layout(kind="split",
                    panels=[R.Box(x=0, y=0, w=400, h=400),
                            R.Box(x=500, y=0, w=400, h=400)])


def test_filter_uses_vstack_for_portrait():
    config.apply_aspect("9:16")
    f = Rn.build_layout_filter(split_layout())
    assert "vstack=inputs=2" in f
    inner_w, inner_h = R.panel_inner((0, 0, 1080, 960))
    assert f"scale={inner_w}:{inner_h}" in f
    assert "pad=1080:960" in f


def test_filter_uses_hstack_for_landscape():
    config.apply_aspect("16:9")
    f = Rn.build_layout_filter(split_layout())
    assert "hstack=inputs=2" in f
    inner_w, inner_h = R.panel_inner((0, 0, 960, 1080))
    assert f"scale={inner_w}:{inner_h}" in f


def test_center_box_follows_aspect():
    config.apply_aspect("1:1")
    box = R.center_box(1920, 1080)
    assert box.w == box.h                      # ការ៉េ
    config.apply_aspect("16:9")
    box = R.center_box(1920, 1080)
    assert (box.w, box.h) == (1920, 1080)      # ដើម 16:9 រួចហើយ -> មិនកាត់


def test_caption_block_never_dominates_the_frame():
    """នៅ 16:9 ការធ្វើមាត្រដ្ឋានតាមទទឹងផ្តល់ font 195px = 54% នៃកម្ពស់ — ធំពេក."""
    for name in config.ASPECT_PRESETS:
        config.apply_aspect(name)
        block = config.CAPTION_MAX_LINES * config.CAPTION_FONT_SIZE * 1.1
        assert block <= config.OUT_HEIGHT * 0.31, f"{name}: ប្លុកអក្សរលេបរូប"


def test_landscape_font_is_capped_not_scaled():
    config.apply_aspect("16:9")
    assert config.CAPTION_FONT_SIZE < int(110 * 1920 / 1080)


# ---------- ជម្រើស caption ពី CLI ----------

@pytest.mark.parametrize("value,expected", [
    ("green", "#00E054"),
    ("YELLOW", "#FFD23F"),
    ("  cyan  ", "#00E5FF"),
    ("#00E054", "#00E054"),
    ("00e054", "#00E054"),       # គ្មាន # ក៏ទទួល
    ("#abcdef", "#ABCDEF"),
])
def test_resolve_caption_color(value, expected):
    assert config.resolve_caption_color(value) == expected


@pytest.mark.parametrize("value", ["banana", "#12345", "#GGGGGG", ""])
def test_resolve_caption_color_rejects_junk(value):
    with pytest.raises(ValueError, match="ពណ៌មិនស្គាល់"):
        config.resolve_caption_color(value)


def test_every_preset_is_valid_hex():
    for name, hex_value in config.CAPTION_COLOR_PRESETS.items():
        assert config.resolve_caption_color(name) == hex_value
        assert len(hex_value) == 7 and hex_value.startswith("#")
