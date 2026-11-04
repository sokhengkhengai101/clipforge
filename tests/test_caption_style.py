"""Flag style caption (screen Subtitles): វាកំណត់តម្លៃ config តែប៉ុណ្ណោះ."""

import pytest

import config
from pipeline import captions as C
from pipeline.captions import Cue


@pytest.fixture(autouse=True)
def restore_style(monkeypatch):
    """apply_caption_style ប្តូរ config សកល — monkeypatch ទុកតម្លៃដើម ហើយដាក់វិញក្រោយ test."""
    for name in ("CAPTION_FONT_SIZE", "CAPTION_LINE_GAP", "CAPTION_OUTLINE",
                 "CAPTION_UPPERCASE", "CAPTION_MARGIN_V", "CAPTION_POSITION"):
        monkeypatch.setattr(config, name, getattr(config, name))
    config.apply_aspect("9:16")
    yield
    config.apply_aspect("9:16")


def test_defaults_change_nothing():
    before = (config.CAPTION_FONT_SIZE, config.CAPTION_MARGIN_V, config.CAPTION_OUTLINE)
    config.apply_caption_style()
    assert (config.CAPTION_FONT_SIZE, config.CAPTION_MARGIN_V, config.CAPTION_OUTLINE) == before
    assert config.CAPTION_UPPERCASE is True
    assert config.CAPTION_POSITION == "auto"


def test_size_scales_font_and_line_gap():
    config.apply_caption_style(size_percent=80)
    assert config.CAPTION_FONT_SIZE == 88                  # 110 * 0.8
    assert config.CAPTION_LINE_GAP == int(88 * 0.82)


def test_case_and_outline():
    config.apply_caption_style(outline=0, case="original")
    assert config.CAPTION_OUTLINE == 0
    assert config.CAPTION_UPPERCASE is False


def test_positions_move_the_block():
    lower_third = config.CAPTION_MARGIN_V
    config.apply_caption_style(position="middle")
    middle = config.CAPTION_MARGIN_V
    config.apply_aspect("9:16")
    config.apply_caption_style(position="top")
    top = config.CAPTION_MARGIN_V
    # MarginV = ចម្ងាយពីបាត: ខ្ពស់ជាង = នៅលើជាង
    assert lower_third < middle < top
    block = config.CAPTION_MAX_LINES * config.CAPTION_FONT_SIZE * 1.1
    # កំពូលប្លុក top នៅក្រោមតំបន់ UI ខាងលើរបស់ platform
    assert config.OUT_HEIGHT - top - block >= config.OUT_HEIGHT * config.CAPTION_SAFE_TOP


def test_forced_position_ignores_the_split_seam():
    """auto ដាក់ cue លើស្នាម split; top/middle/bottom ប្រើកន្លែងតែមួយគ្រប់ layout."""
    class Layout:
        kind = "split"

    class Segment:
        start, end, layout = 0.0, 10.0, Layout()

    cue = Cue(start=1.0, end=2.0)
    assert C.anchor_for(cue, 0.0, [Segment()]) == "split"
    config.apply_caption_style(position="bottom")
    assert C.anchor_for(cue, 0.0, [Segment()]) == "normal"


@pytest.mark.parametrize("kwargs", [
    {"size_percent": 69}, {"size_percent": 121}, {"outline": 13},
    {"case": "title"}, {"position": "left"},
])
def test_rejects_out_of_range(kwargs):
    with pytest.raises(ValueError):
        config.apply_caption_style(**kwargs)
