"""--language: ភាសាដែលទទួល, និង transcript ចាស់ជាភាសាផ្សេង = transcribe ម្តងទៀត."""
import json

from typer.testing import CliRunner

import make_clips
from server import jobs


def test_language_changes_reads_the_cached_language(tmp_path):
    (tmp_path / "transcript.json").write_text(json.dumps({"cache_version": 1, "language": "fr", "segments": []}))
    assert jobs.language_changes(tmp_path, "en") is True
    assert jobs.language_changes(tmp_path, "fr") is False
    assert jobs.language_changes(tmp_path, "auto") is False
    assert jobs.language_changes(tmp_path, None) is False
    assert jobs.language_changes(tmp_path / "missing", "en") is False


def test_unknown_language_is_refused(tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    result = CliRunner().invoke(make_clips.app, [str(video), "--language", "km"])
    assert result.exit_code == 2
    assert "--language" in result.output
