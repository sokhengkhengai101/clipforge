"""ផ្ទាំង Captions › Font / Effects: font, ពណ៌, italic/underline, shadow, keyword highlighter, បន្ទាត់."""
import sys

import pytest

import config
from pipeline import captions
from pipeline.transcribe import Word

LOOK = ("CAPTION_FONT", "CAPTION_TEXT_COLOR", "CAPTION_OUTLINE_COLOR", "CAPTION_ITALIC", "CAPTION_UNDERLINE",
        "CAPTION_SHADOW_XY_BLUR", "CAPTION_SHADOW_COLOR", "CAPTION_KEYWORD_HIGHLIGHT", "CAPTION_KEYWORD_COLORS",
        "CAPTION_MAX_LINES", "CAPTION_OUTLINE")


@pytest.fixture(autouse=True)
def restore(monkeypatch):
    config.apply_aspect("9:16")
    for name in LOOK:
        monkeypatch.setattr(config, name, getattr(config, name))


def style_line():
    return next(line for line in captions.ass_header("F").splitlines() if line.startswith("Style:"))


def test_the_default_look_writes_the_same_style_as_before():
    assert ",&H80000000,-1,0,0,0,100,100,0,0,1," in style_line()
    assert captions.shadow_tags() == ""


def test_look_flags_reach_the_style_and_tags():
    config.apply_caption_look("Montserrat Black", "#ffe600", "#1E3A8A", italic=True, underline=True,
                              shadow="6,6,5,#FF0000", lines=1)
    line = style_line()
    assert config.CAPTION_FONT == "Montserrat Black" and config.CAPTION_TEXT_COLOR == "#FFE600"
    assert ",-1,-1,-1,0,100,100," in line                         # bold, italic, underline
    assert "&H800000FF" in line                                   # shadow ពណ៌ក្រហម alpha ពាក់កណ្តាល
    assert captions.shadow_tags() == r"\xshad6\yshad6\blur5"
    assert config.CAPTION_MAX_LINES == 1


@pytest.mark.parametrize("bad", [dict(text_color="red"), dict(shadow="1,1"), dict(lines=4),
                                 dict(keyword_colors="#FFFFFF")])
def test_bad_look_values_are_refused(bad):
    with pytest.raises(ValueError):
        config.apply_caption_look(**bad)


def test_keywords_keep_their_colour_while_another_word_is_spoken():
    config.CAPTION_KEYWORD_HIGHLIGHT = True
    words = [Word(" between", 0.0, 0.4), Word(" the", 0.4, 0.6)]
    cue = captions.Cue(start=0.0, end=0.6, lines=[words])
    marked = captions.keyword_colours(cue, 0)
    text = captions.render_line(words, words[1], marked)
    assert r"\c&H0027F804&}BETWEEN" in text                        # ពណ៌ទី ១ (ពាក្យសំខាន់)
    assert list(captions.keyword_colours(cue, 1).values()) == ["#FFFD03"]   # cue បន្ទាប់ = ពណ៌ទី ២


@pytest.mark.skipif(sys.platform != "win32", reason="registry Fonts មានតែលើ Windows")
def test_fonts_are_found_by_their_real_name_not_only_the_file_name():
    assert captions.find_font_file("Arial Black").name.lower() == "ariblk.ttf"
    assert captions.find_font_file("No Such Font 123") is None
