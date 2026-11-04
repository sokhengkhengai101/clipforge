"""ប៊ូតុងទំហំលើ Review: clip មួយមាន file ច្រើនទំហំ."""
import os
from types import SimpleNamespace

from server import clips as clip_api
from server import media


def _write_clip(folder, index=1):
    folder.mkdir(parents=True, exist_ok=True)
    for suffix in ("mp4", "srt"):
        (folder / f"clip_{index:02d}.{suffix}").write_bytes(b"x")


def test_lists_only_aspects_that_exist(tmp_path):
    _write_clip(tmp_path / "clips_1x1", 2)
    found = clip_api.clip_aspects(tmp_path, 2)
    assert list(found) == ["1:1"]
    assert found["1:1"]["mp4"].endswith("clip_02.mp4")
    assert clip_api.clip_aspects(tmp_path, 1) == {}


def test_a_file_older_than_the_ranking_is_another_clip(tmp_path):
    """AI ជ្រើសថ្មី: clip លេខ 1 អាចជា clip ផ្សេង ដូច្នេះ file ទំហំចាស់មិនត្រូវបង្ហាញទេ."""
    _write_clip(tmp_path / "clips_1x1")
    ranked = tmp_path / "clips.json"
    ranked.write_text("[]")
    old = ranked.stat().st_mtime - 100
    os.utime(tmp_path / "clips_1x1" / "clip_01.mp4", (old, old))
    assert clip_api.clip_aspects(tmp_path, 1) == {}


def test_clip_file_picks_the_aspect(tmp_path):
    _write_clip(tmp_path / "clips")
    _write_clip(tmp_path / "clips_1x1")
    clips = [{"index": 1, "files": {"mp4": str(tmp_path / "clips" / "clip_01.mp4")},
              "aspects": clip_api.clip_aspects(tmp_path, 1)}]
    assert media.clip_file(clips, 1, "mp4")[0].parent.name == "clips"
    assert media.clip_file(clips, 1, "mp4", "1:1")[0].parent.name == "clips_1x1"
    assert media.clip_file(clips, 1, "mp4", "4:5") is None
    assert media.clip_file(clips, 1, "mp4", "../..") is None


def test_only_clip_needs_a_ranking(tmp_path, monkeypatch):
    """គ្មាន clips.json = exit 2 មុន Whisper / LLM (មិនត្រូវចំណាយពេលដោយស្ងាត់)."""
    from typer.testing import CliRunner

    import config
    import make_clips

    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    monkeypatch.setattr(config, "OUTPUT_DIR", tmp_path / "output")
    monkeypatch.setattr(config, "detect_device", lambda: ("cpu", "small", "int8"))
    result = CliRunner().invoke(make_clips.app, [str(video), "--only-clip", "1"])
    assert result.exit_code == 2
    assert SimpleNamespace(done=not (tmp_path / "output" / "v" / "clips").exists()).done
