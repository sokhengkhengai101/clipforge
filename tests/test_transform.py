"""Transform video (Edit Video): crop -> scale -> overlay ដោយដៃ ជំនួស AI layout."""
import pytest

import config
from pipeline import render, transform as tf
from pipeline.reframe import Layout, custom_layout


@pytest.fixture(autouse=True)
def nine_sixteen(monkeypatch):
    config.apply_aspect("9:16")
    monkeypatch.setattr(config, "FIT_RADIUS", 0)
    monkeypatch.setattr(config, "FIT_BACKGROUND", "blur")


def test_parse_and_reject():
    t = tf.parse("0.5,0.4,0.9", "0.12,0,0.76,1")
    assert (t.x, t.y, t.scale, t.crop) == (0.5, 0.4, 0.9, (0.12, 0.0, 0.76, 1.0))
    assert tf.parse("0.5,0.5,1").crop == (0.0, 0.0, 1.0, 1.0)
    for bad in [("0.5,0.5", None), ("0.5,0.5,9", None), ("a,b,c", None),
                ("0.5,0.5,1", "0.9,0,0.5,1"), ("0.5,0.5,1", "0,0,0.01,1"), ("3,0.5,1", None)]:
        with pytest.raises(tf.TransformError):
            tf.parse(*bad)
    assert tf.parse(*tf.parse("0.3,0.6,0.8", "0.1,0.2,0.5,0.5").as_flags()[1::2]).crop == (0.1, 0.2, 0.5, 0.5)


def test_geometry_of_the_docstring_example():
    # 1280x720, ដក 12% ពីឆ្វេង/ស្តាំ, ទទឹង 90% នៃ 1080, កណ្តាលអេក្រង់
    t = tf.parse("0.5,0.5,0.9", "0.12,0,0.76,1")
    assert tf.crop_pixels(t, 1280, 720) == (154, 0, 972, 720)
    size = tf.foreground_size(t, 1280, 720, 1080)
    assert size == (972, 720)
    assert tf.top_left(t, size, 1080, 1920) == (54, 600)


def test_custom_layout_draws_crop_scale_overlay(monkeypatch):
    monkeypatch.setattr(config, "TRANSFORM", tf.parse("0.5,0.25,1.2"))
    layout = custom_layout(config.TRANSFORM, (1280, 720))
    assert layout.kind == "custom" and layout.place == (1296, 728, -108, 116)   # ធំជាងអេក្រង់: ចេញក្រៅ
    chain = render.layout_chain(layout, 0, "0:v", "out")
    assert "crop=1280:720:0:0,scale=1296:728" in chain
    assert "overlay=-108:116" in chain and "boxblur" in chain        # background blur ដូច Fit


def test_plan_clip_uses_the_transform_instead_of_the_ai(monkeypatch, tmp_path):
    from pipeline.highlights import Clip
    from pipeline.reframe import plan_clip
    monkeypatch.setattr(config, "TRANSFORM", tf.parse("0.5,0.5,1"))
    clip = Clip(start=1.0, end=9.0, title="t", hook="h", type="story", score=80, reason="r")
    segments = plan_clip(tmp_path / "none.mp4", clip, (1920, 1080))     # គ្មាន FFmpeg / មុខ
    assert len(segments) == 1 and segments[0].layout.kind == "custom"
    assert (segments[0].start, segments[0].end) == (1.0, 9.0)
    monkeypatch.setattr(config, "TRANSFORM", None)
    assert isinstance(Layout(kind="custom").place, type(None))
