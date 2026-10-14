"""Test មូលដ្ឋាន — ធានាថា environment និង config មិនខូច."""

import shutil
import subprocess

import config


def test_ffmpeg_is_installed():
    """ffmpeg ត្រូវនៅក្នុង PATH ហើយរត់បាន."""
    assert shutil.which("ffmpeg"), "រកមិនឃើញ ffmpeg ក្នុង PATH"
    result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
    assert result.returncode == 0


def test_ffmpeg_has_libass():
    """ត្រូវការ libass ដើម្បី burn .ass captions ចូល video."""
    out = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout
    assert "--enable-libass" in out


def test_config_values_are_sane():
    assert 0 < config.MIN_CLIP_SEC < config.MAX_CLIP_SEC
    assert config.OUT_WIDTH * 16 == config.OUT_HEIGHT * 9  # 9:16
    assert config.MAX_CLIPS > 0


def test_detect_device_returns_valid_triple():
    device, model, compute = config.detect_device()
    assert device in ("cuda", "cpu")
    assert model
    assert compute
