"""ប៊ូតុង Duplicate លើ Review: clip + ទំហំទាំងអស់ចម្លង, clip ផ្សេងមិនប៉ះ."""
import json
import os

import pytest

from server.clips import clips_of_project, duplicate_clip


def clip(title: str) -> dict:
    return {"start": 1.0, "end": 20.0, "title": title, "hook": "h", "type": "insight", "score": 8.0, "reason": "r"}


@pytest.fixture
def project(tmp_path):
    (tmp_path / "clips").mkdir()
    (tmp_path / "clips_1x1").mkdir()
    ranked = tmp_path / "clips.json"
    ranked.write_text(json.dumps({"cache_version": 5, "model": "m", "prompt": "p",
                                  "clips": [clip("a"), clip("b"), clip("hidden")]}), encoding="utf-8")
    os.utime(ranked, (1000, 1000))
    for name in ("clips/clip_01.mp4", "clips/clip_01.vtt", "clips/clip_01_layout.json", "clips/clip_02.mp4",
                 "clips_1x1/clip_01.mp4", "clips_1x1/clip_02.mp4"):
        (tmp_path / name).write_text(name)
    return tmp_path


def test_copy_goes_after_the_last_rendered_clip_with_every_size(project):
    assert duplicate_clip(project, 1) == 3
    items = clips_of_project(project)
    assert [item["title"] for item in items] == ["a", "b", "a (Copy)", "hidden"]
    assert (project / "clips/clip_03.mp4").read_text() == "clips/clip_01.mp4"
    assert (project / "clips/clip_03_layout.json").is_file()
    assert "1:1" in items[2]["aspects"]
    assert not (project / "clips/clip_04.mp4").exists()


def test_other_clips_keep_their_files_and_sizes(project):
    before = clips_of_project(project)[1]["aspects"]
    duplicate_clip(project, 1)
    assert (project / "clips.json").stat().st_mtime == 1000
    assert clips_of_project(project)[1]["aspects"] == before
    assert (project / "clips/clip_02.mp4").read_text() == "clips/clip_02.mp4"


@pytest.mark.parametrize("index", [0, 3, 9])
def test_a_clip_with_no_file_is_refused(project, index):
    with pytest.raises(ValueError):
        duplicate_clip(project, index)
    assert len(json.loads((project / "clips.json").read_text(encoding="utf-8"))["clips"]) == 3
