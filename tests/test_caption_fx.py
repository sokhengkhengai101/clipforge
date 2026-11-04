"""ចលនា caption (Captions › Effects › Animation): ក្រុម A (ពេល cue លេច) + baby_steps."""
import pytest

import config
from pipeline import caption_fx, captions
from pipeline.transcribe import Word


@pytest.fixture(autouse=True)
def nine_sixteen(monkeypatch):
    config.apply_aspect("9:16")
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "pop")


@pytest.mark.parametrize("kind, has", [
    ("slide_left", r"\move(621,800,540,800,0,200)"),
    ("blur_in", r"\blur20\alpha&HFF&\t(0,220,\blur0\alpha&H00&)"),
    ("soft_landing", r"\move(540,742,540,800,0,260)"),
    ("grow", r"\fscx0\fscy0\t(0,250,0.6,\fscx100\fscy100)"),
])
def test_entrances(kind, has):
    assert has in caption_fx.intro_tags(540, 800, 0, kind)
    # event ក្រោយក្នុង cue ដដែល: ពេលដកថយ, ហើយក្រោយចលនាចប់ គ្មាន tag ទៀតទេ
    assert "-100," in caption_fx.intro_tags(540, 800, 100, kind)
    assert caption_fx.intro_tags(540, 800, 400, kind) == r"\an5\pos(540,800)"


def test_every_listed_animation_is_known():
    for kind in config.CAPTION_ANIMATIONS:
        caption_fx.intro_tags(540, 800, 0, kind)             # មិនបោះ error
    assert set(caption_fx.ENTRANCES) <= set(config.CAPTION_ANIMATIONS)


def test_baby_steps_hides_words_not_yet_spoken_but_keeps_their_place(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "baby_steps")
    words = [Word(" rate", 0.0, 0.3), Word(" now", 0.3, 0.6), Word(" when", 0.6, 0.9)]
    text = captions.render_line(words, words[1])
    assert "RATE" in text and r"{\alpha&HFF&}WHEN{\alpha&H00&}" in text
    assert r"\alpha&HFF&}NOW" not in text and r"\alpha&HFF&}RATE" not in text
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "pop")
    assert r"\alpha" not in captions.render_line(words, words[1])


# ---------- ក្រុម B: ពាក្យកំពុងនិយាយ ----------

WORDS = [Word(" rate", 0.0, 0.3), Word(" now", 0.3, 0.6), Word(" when", 0.6, 0.9)]


@pytest.mark.parametrize("kind, grow", [
    ("scale", r"\fscx115\fscy115"),
    ("underline", r"\u1"),
    ("seamless_bounce", r"\t(0,70,\fscx115\fscy115)\t(70,170,\fscx100\fscy100)"),
])
def test_spoken_word_tags(monkeypatch, kind, grow):
    monkeypatch.setattr(config, "CAPTION_ANIMATION", kind)
    text = captions.render_line(WORDS, WORDS[1])
    assert grow + r"\c" in text and "}NOW{" in text
    assert r"\fscy110" not in text                         # pop មិនបន្ថែមលើវាទេ


def test_blur_switch_and_focus_change_only_the_other_words(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "blur_switch")
    text = captions.render_line(WORDS, WORDS[1])
    # គ្រោងត្រូវដកចេញ បើមិនដូច្នោះ libass ព្រិលតែគ្រោង
    assert r"{\bord0\blur4}RATE" in text and r"{\bord0\blur4}WHEN" in text
    assert r"\blur4}NOW" not in text
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "focus")
    text = captions.render_line(WORDS, WORDS[1])
    assert r"{\alpha&H99&}RATE{\alpha&H00&}" in text and r"\alpha&H99&}NOW" not in text
    # គ្មានពាក្យកំពុងនិយាយ (ឧ. ចន្លោះស្ងាត់) = គ្មានពាក្យណាស្រអាប់
    assert r"\alpha" not in captions.render_line(WORDS, None)


def test_box_puts_a_box_layer_under_the_text(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "box")
    events = captions.line_events(0.3, 0.6, 800, WORDS, WORDS[1], {}, 0)
    assert len(events) == 2
    box, text = events
    assert box.startswith("Dialogue: 0,") and ",Box,," in box
    assert text.startswith("Dialogue: 1,") and ",Default,," in text
    # ប្រអប់មើលឃើញតែពីក្រោយពាក្យកំពុងនិយាយ; អក្សរងងឹតគ្មានគ្រោង
    # ប្រអប់បិទ (alpha FF) លើគ្រប់ពាក្យ ហើយបើកតែលើពាក្យកំពុងនិយាយ — បិទវិញមុនដកឃ្លា
    assert r"{\1a&HFF&\4a&HFF&\3a&HFF&}RATE {\3a&H00&}NOW{\3a&HFF&} WHEN" in box
    assert r"\bord0\c&H00111111&}NOW" in text
    style = captions.box_style("Montserrat", 300)
    assert len(style) == 1 and ",3," in style[0]           # BorderStyle 3 = ប្រអប់


def test_highlighter_box_is_see_through_and_keeps_the_text_colour(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "highlighter")
    style = captions.box_style("Montserrat", 300)[0]
    assert ",&H60" in style                                # alpha 0x60 = ថ្លាពាក់កណ្តាល
    # `\3a` លើពាក្យ ជំនួស alpha របស់ style -> ត្រូវតែ 60 ដែរ (មុនកែ: 00 = ស្រអាប់ទាំងស្រុង)
    box, _ = captions.line_events(0.3, 0.6, 800, WORDS, WORDS[1], {}, 0)
    assert r"{\3a&H60&}NOW" in box
    assert caption_fx.active_word_colour() == config.CAPTION_TEXT_COLOR
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "pop")
    assert captions.box_style("Montserrat", 300) == []
    assert len(captions.line_events(0.3, 0.6, 800, WORDS, WORDS[1], {}, 0)) == 1


# ---------- ក្រុម C: ពេញមួយ cue ----------

def test_breathe_runs_through_the_cue_and_continues_across_events():
    tags = caption_fx.hold_tags(0, 3000, "breathe")
    assert tags.count(r"\fscx105") == 3                     # វដ្ត 1400 ms បីដងក្នុង 3 s
    later = caption_fx.hold_tags(1500, 3000, "breathe")
    assert later.startswith(r"\t(-100,600,")                # វដ្តទីមួយចប់ហើយ -> មិនសរសេរ
    assert caption_fx.hold_tags(0, 3000, "pop") == ""


def test_earthquake_starts_from_the_angle_already_reached():
    first = caption_fx.hold_tags(0, 300, "baby_earthquake")
    assert first.startswith(r"\t(0,70,\frz1.4)") and r"\frz-1.1" in first
    later = caption_fx.hold_tags(150, 300, "baby_earthquake")
    assert later.startswith(r"\frz-1.1\t(-10,60,\frz0.8)")


def test_glitch_draws_two_colour_layers_under_the_zooming_text(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "glitch_infinite_zoom")
    events = captions.line_events(0.3, 0.6, 800, WORDS, WORDS[1], {}, 300, 900)
    assert len(events) == 3
    red, blue, text = events
    assert r"\pos(531,800)" in red and r"\pos(549,800)" in blue and r"\pos(540,800)" in text
    assert all(r"\t(-300,600,\fscx118\fscy118)" in e for e in events)
    assert text.startswith("Dialogue: 1,") and r"\bord0\shad0" in red


def test_backdrop_is_one_box_behind_the_whole_line(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "with_backdrop")
    back, text = captions.line_events(0.3, 0.6, 800, WORDS, WORDS[1], {}, 0, 900)
    assert ",Backdrop,," in back and r"{\1a&HFF&}RATE NOW WHEN" in back
    style = captions.backdrop_style("Montserrat", 300)[0]
    assert ",4," in style                                   # BorderStyle 4 = ប្រអប់មួយក្នុងមួយបន្ទាត់
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "pop")
    assert captions.backdrop_style("Montserrat", 300) == []


def test_the_ui_lists_the_same_animations_as_config():
    """`ui/src/captionStyle.ts` ANIMATION_GROUPS ត្រូវដូច config — បើមិនដូច្នោះ UI ផ្ញើឈ្មោះដែល sidecar បដិសេធ."""
    import re
    from pathlib import Path
    source = (Path(__file__).parent.parent / "ui" / "src" / "captionStyle.ts").read_text(encoding="utf-8")
    block = source.split("export const ANIMATION_GROUPS", 1)[1].split("] as const", 1)[0]
    names = re.findall(r"\['([a-z_]+)', '", block)
    assert sorted(names) == sorted(config.CAPTION_ANIMATIONS)
