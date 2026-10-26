"""menu Background / Tracker (Edit Video): ផ្ទៃខាងក្រោយ Fit, spacing, ជ្រុងមូល, បិទ tracking."""
import pytest

import config
from pipeline import render
from pipeline.cuts import shift_range
from pipeline.reframe import Layout, tracking_allowed


@pytest.fixture(autouse=True)
def restore_config(monkeypatch):
    # កុំឲ្យ test មួយទុកការកំណត់ឲ្យ test ផ្សេង
    for name in ("FIT_BACKGROUND", "FIT_BLUR_STRENGTH", "FIT_COLOR", "FIT_IMAGE", "FIT_RADIUS",
                 "FIT_SPACING", "TRACKING", "NO_TRACK_RANGES"):
        monkeypatch.setattr(config, name, getattr(config, name))


def test_blur_strength_33_is_the_old_blur_and_0_is_none():
    assert render.fit_blur_filter(33) == "boxblur=20:5"
    assert render.fit_blur_filter(0) == ""
    assert render.fit_blur_filter(100) == "boxblur=60:5"


def test_background_kinds():
    config.FIT_BACKGROUND = "color"
    config.FIT_COLOR = "#1E8F5A"
    assert "drawbox=x=0:y=0:w=iw:h=ih:color=#1e8f5a:t=fill" in render.fit_background("f", "bg", 1080, 1920)
    config.FIT_BACKGROUND = "image"
    config.FIT_IMAGE = "pic.jpg"
    assert f"movie={render.FIT_IMAGE_FILE}" in render.fit_background("f", "bg", 1080, 1920)
    config.FIT_IMAGE = None                    # image គ្មានរូប -> blur វិញ
    assert "boxblur" in render.fit_background("f", "bg", 1080, 1920)


def test_spacing_fits_the_video_inside_the_room_with_even_sizes():
    config.FIT_SPACING = 10
    assert render.fit_foreground_size(1280, 720, 1080, 1920) == (864, 486)
    config.FIT_SPACING = 0
    assert render.fit_foreground_size(1280, 720, 1080, 1920) == (1080, 606)


def test_rounded_fit_uses_the_mask_as_alpha():
    config.FIT_RADIUS = 40
    chain = render.layout_chain(Layout(kind="fit"), 0, "0:v", "v", out_width=1080, out_height=1920,
                                fit_size=(864, 486))
    assert "scale=864:486" in chain and "alphamerge" in chain and render.FIT_MASK_FILE in chain
    # គ្មាន spacing/ជ្រុង = filter ចាស់ដដែល
    plain = render.layout_chain(Layout(kind="fit"), 0, "0:v", "v", out_width=1080, out_height=1920)
    assert "scale=1080:-2" in plain and "alphamerge" not in plain


def test_tracking_switches():
    assert tracking_allowed(8, 11)
    config.NO_TRACK_RANGES = [(10.0, 12.0)]
    assert not tracking_allowed(8, 11)        # ជាន់ 10-11
    assert tracking_allowed(12, 15)           # ប៉ះគែម មិនមែនជាន់
    config.TRACKING = False
    assert not tracking_allowed(12, 15)


def test_shift_range_follows_the_cut_copy():
    keeps = [(0.0, 10.0), (20.0, 30.0)]
    assert shift_range((5, 25), keeps) == [(5.0, 10.0), (10.0, 15.0)]
    assert shift_range((12, 18), keeps) == []          # ទាំងមូលត្រូវបានកាត់ចេញ
