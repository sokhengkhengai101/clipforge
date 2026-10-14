"""Test សម្រាប់ pipeline/audio.py — ប្រើ sample_5s.mp4 (៥ វិនាទី, ~100KB)."""

import subprocess
from pathlib import Path

import pytest

from pipeline.audio import FFmpegError, extract_audio, has_audio_stream, probe_duration

FIXTURE = Path(__file__).parent / "fixtures" / "sample_5s.mp4"


def ffprobe_field(path: Path, entry: str) -> str:
    """សួរ ffprobe យកតម្លៃមួយ (ឧ. sample_rate) ពី audio stream ទី ១."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", f"stream={entry}", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    ).stdout
    return out.strip()


def test_fixture_exists():
    assert FIXTURE.is_file(), "បាត់ sample_5s.mp4 — បង្កើតវាឡើងវិញដោយ FFmpeg"


def test_probe_duration():
    duration = probe_duration(FIXTURE)
    assert 4.5 < duration < 5.5          # ~5 វិនាទី (មិនពិតប្រាកដ 100% ព្រោះ frame rate)


def test_has_audio_stream():
    assert has_audio_stream(FIXTURE) is True


def test_extract_audio_format(tmp_path):
    """WAV ចេញត្រូវតែ 16 kHz, mono, pcm_s16le — Whisper ត្រូវការបែបនេះ."""
    out = extract_audio(FIXTURE, tmp_path / "audio.wav")
    assert out.is_file() and out.stat().st_size > 0
    assert ffprobe_field(out, "sample_rate") == "16000"
    assert ffprobe_field(out, "channels") == "1"
    assert ffprobe_field(out, "codec_name") == "pcm_s16le"
    # រយៈពេល audio ត្រូវប្រហាក់ប្រហែល video ដើម
    assert abs(probe_duration(out) - probe_duration(FIXTURE)) < 0.5


def test_original_video_untouched(tmp_path):
    """ច្បាប់ដាច់ខាត: មិនត្រូវកែ file ដើមរបស់ខ្ញុំ."""
    before = (FIXTURE.stat().st_size, FIXTURE.stat().st_mtime_ns)
    extract_audio(FIXTURE, tmp_path / "audio.wav")
    after = (FIXTURE.stat().st_size, FIXTURE.stat().st_mtime_ns)
    assert before == after


def test_cache_skips_second_run(tmp_path):
    """ហៅម្តងទីពីរត្រូវ skip — មិន extract ឡើងវិញ."""
    out1 = extract_audio(FIXTURE, tmp_path / "audio.wav")
    mtime1 = out1.stat().st_mtime_ns
    out2 = extract_audio(FIXTURE, tmp_path / "audio.wav")
    assert out2 == out1
    assert out2.stat().st_mtime_ns == mtime1      # file ដូចគ្នា មិនត្រូវសរសេរឡើងវិញ


def test_force_re_extracts(tmp_path):
    out = extract_audio(FIXTURE, tmp_path / "audio.wav")
    size1 = out.stat().st_size
    out.write_bytes(b"broken")                     # ធ្វើឲ្យខូចដោយចេតនា (bytes = ASCII only)
    again = extract_audio(FIXTURE, tmp_path / "audio.wav", force=True)
    assert again.stat().st_size == size1          # បាន extract ថ្មីវិញ


def test_missing_video_raises():
    with pytest.raises(FileNotFoundError):
        extract_audio(Path("គ្មាន_file_នេះ.mp4"))


def test_video_without_audio_raises(tmp_path):
    """video គ្មានសំឡេង ត្រូវបាន error ច្បាស់ មិនមែន crash អានមិនបាន."""
    silent = tmp_path / "silent.mp4"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10", "-t", "1",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", str(silent)],
        check=True,
    )
    with pytest.raises(FFmpegError, match="គ្មាន audio track"):
        extract_audio(silent, tmp_path / "out.wav")
