"""Motion (Edit Video): zoom យឺតៗ, zoom លើពាក្យសំខាន់, shake — កន្សោម perspective និងកន្លែងក្នុង filter."""
import pytest

import config
from pipeline import motion, render
from pipeline.reframe import Box, Layout, Segment
from pipeline.transcribe import Word


@pytest.fixture(autouse=True)
def motion_off(monkeypatch):
    config.apply_aspect("9:16")
    for name, value in (("MOTION_ZOOM", "off"), ("MOTION_ZOOM_AMOUNT", 8), ("MOTION_KEYWORDS", 0), ("MOTION_SHAKE", "off")):
        monkeypatch.setattr(config, name, value)


def test_nothing_on_means_no_filter():
    assert not motion.enabled()
    assert motion.motion_filter(0, 5, None, 25, 1080, 1920) == ""


def test_slow_zoom_runs_over_the_shot_and_restarts_each_shot():
    config.MOTION_ZOOM = "in"
    z = motion.zoom_expression(10.0, 15.0, motion.MotionCues(), 25.0)
    assert z == "min(1.25,(1+0.08*(on/25)/5))"            # 1.00 ដើម shot -> 1.08 ចុង shot
    config.MOTION_ZOOM = "out"
    assert "(1-(on/25)/5)" in motion.zoom_expression(10.0, 15.0, motion.MotionCues(), 25.0)


def test_keyword_zoom_only_uses_keywords_near_the_shot():
    config.MOTION_KEYWORDS = 8
    cues = motion.MotionCues(keywords=[2.0, 12.0, 30.0])
    z = motion.zoom_expression(10.0, 15.0, cues, 25.0)
    assert "-12.12)" in z and "-2.12)" not in z and "-30.12)" not in z
    assert motion.zoom_expression(16.0, 20.0, cues, 25.0) is None       # គ្មានពាក្យ គ្មាន zoom


def test_shake_ramps_in_and_out_and_overscans():
    config.MOTION_SHAKE = "loud"
    cues = motion.MotionCues(loud=[(11.0, 12.0)])
    gate = motion.shake_gate(10.0, 15.0, cues, 25.0)
    assert "/0.15" in gate and "between" not in gate                   # មិនបើក/បិទភ្លាម
    assert motion.shake_gate(20.0, 25.0, cues, 25.0) is None
    f = motion.motion_filter(10.0, 15.0, cues, 25.0, 1080, 1920)
    assert f.startswith("perspective=") and "1.015" in f and "sin(" in f
    config.MOTION_SHAKE = "all"
    assert motion.shake_gate(20.0, 25.0, cues, 25.0) == "1"


def test_keyword_moments_are_three_seconds_apart():
    words = [Word(" incredible", 1.0, 1.5), Word(" a", 1.6, 1.7), Word(" wonderful", 2.0, 2.5),
             Word(" afterwards", 6.0, 6.5)]
    moments = motion.keyword_moments(words, 0.0)
    assert moments[0] == 1.0 and all(b - a >= 3.0 for a, b in zip(moments, moments[1:]))


def test_motion_sits_after_the_layout_and_before_the_captions():
    box = Box(x=0, y=0, w=404, h=720)
    one = render.build_layout_filter(Layout(kind="center", box=box), "clip_01.ass", motion="perspective=x0=1")
    assert one.index("[lm]perspective") < one.index("ass=clip_01.ass")
    two = render.build_segments_filter([Segment(0, 2, Layout(kind="center", box=box)),
                                        Segment(2, 4, Layout(kind="center", box=box))], 0.0, "c.ass",
                                       motions=["perspective=x0=1", ""])
    assert "[m0]perspective=x0=1[v0]" in two and "[m1]" not in two


@pytest.mark.parametrize("kind, has", [("pop", None), ("none", None), ("fade", r"\alpha&HFF&\t(0,160,"),
                                       ("slide", r"\move(540,"), ("bounce", r"\fscx70\fscy70\t(0,88,")])
def test_caption_intro_tags(monkeypatch, kind, has):
    from pipeline import captions
    monkeypatch.setattr(config, "CAPTION_ANIMATION", kind)
    tags = captions.intro_tags(540, 1400, 0)
    if has is None:
        assert tags == r"\an5\pos(540,1400)"
    else:
        assert has in tags
    # event ក្រោយ: ពេលដកថយ (libass ទទួលពេលអវិជ្ជមាន) ដូច្នេះចលនាមិនចាប់ផ្តើមម្តងទៀត
    if kind in ("fade", "slide"):
        assert "-70,90" in captions.intro_tags(540, 1400, 70)
    assert captions.intro_tags(540, 1400, 400) == r"\an5\pos(540,1400)"   # ចលនាចប់ហើយ


def test_only_pop_grows_the_spoken_word(monkeypatch):
    from pipeline import captions
    word = Word(" rhino", 1.0, 1.4)
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "pop")
    assert r"\fscy110" in captions.render_line([word], word)
    monkeypatch.setattr(config, "CAPTION_ANIMATION", "bounce")
    assert r"\fscy" not in captions.render_line([word], word)
