"""AI Reframe (1F ជំហាន ៧): folder របស់ `--full`, ជំហានដែលរំលង, marker `plan`, និងលទ្ធផល."""

import json
from pathlib import Path
import time

import pytest
from fastapi.testclient import TestClient

from server import app as APP
from server import clips as SC
from server import jobs as J


def test_output_folder_follows_make_clips():
    assert J.output_folder({}) == "clips"
    assert J.output_folder({"aspect": "1:1"}) == "clips_1x1"
    assert J.output_folder({"full": True}) == "full"
    assert J.output_folder({"full": True, "aspect": "4:5"}) == "full_4x5"


def test_full_job_skips_highlights_and_watches_its_own_folder(tmp_path):
    out = tmp_path / "v"
    (out / "full").mkdir(parents=True)
    # highlights.json ចាស់ពីការរក clips មិនត្រូវបង្ហាញថា "cached" ក្នុង reframe ទេ
    (out / "highlights.json").write_text("{}", encoding="utf-8")
    job = J.Job(id="x", video=tmp_path / "v.mp4", out_dir=out, args=[], folder="full",
                skipped=("highlights", "boundaries"))
    assert job.progress()["skipped"] == ["highlights", "boundaries"]
    assert job.progress()["planned"] is False
    (out / "full" / "clip_01_layout.json").write_text("{}", encoding="utf-8")
    (out / "full" / "clip_01.ass").write_text("x", encoding="utf-8")
    progress = job.progress()
    assert progress["planned"] is True
    assert "captions" in progress["done"]
    assert progress["folder"] == "full"


def write_reframe(folder, shots):
    folder.mkdir(parents=True)
    (folder / "clip_01.mp4").write_bytes(b"x" * 10)
    (folder / "clip_01.srt").write_text("1", encoding="utf-8")
    (folder / "clip_01_layout.json").write_text(
        json.dumps({"dominant": "single", "shots": shots}), encoding="utf-8")


def test_reframe_outputs_summarise_the_plan(tmp_path):
    shots = [{"start": 0.0, "end": 30.0, "kind": "single"},
             {"start": 30.0, "end": 45.0, "kind": "split"},
             {"start": 45.0, "end": 60.0, "kind": "single"}]
    write_reframe(tmp_path / "full", shots)
    write_reframe(tmp_path / "full_1x1", shots[:1])
    (tmp_path / "fullish").mkdir()                      # មិនមែន folder reframe ទេ
    results = {item["folder"]: item for item in SC.reframe_outputs(tmp_path)}
    assert set(results) == {"full", "full_1x1"}
    main = results["full"]
    assert main["aspect"] == "9:16" and results["full_1x1"]["aspect"] == "1:1"
    assert main["seconds"] == 60.0
    assert main["layout_seconds"] == {"single": 45.0, "split": 15.0}
    assert main["shots_per_minute"] == 3.0
    assert main["layout_switches_per_minute"] == 2.0
    assert set(main["files"]) == {"mp4", "srt"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(APP, "PROJECT_ROOT", tmp_path)
    return TestClient(APP.app)


def test_reframe_endpoints_only_serve_reframe_files(client, tmp_path):
    write_reframe(tmp_path / "output" / "p" / "full", [{"start": 0.0, "end": 6.0, "kind": "fit"}])
    listed = client.get("/projects/p/reframe").json()["results"]
    assert [item["folder"] for item in listed] == ["full"]
    assert client.get("/projects/p/reframe/full/file?kind=mp4").status_code == 200
    assert client.get("/projects/p/reframe/clips/file?kind=mp4").status_code == 400   # មិនមែន full*
    assert client.get("/projects/p/reframe/full/file?kind=ass").status_code == 400
    assert client.get("/projects/p/reframe/full_1x1/file?kind=mp4").status_code == 404
    assert client.get("/projects/none/reframe").json()["results"] == []
    assert client.get("/projects/..%5Cx/reframe").status_code == 400


def test_probe_frame_is_a_jpeg_of_a_video_only(client, tmp_path, monkeypatch):
    from server import media
    assert client.get("/probe/frame", params={"path": str(tmp_path / "a.txt")}).status_code == 400
    monkeypatch.setattr(media, "source_frame", lambda path, at: None)
    assert client.get("/probe/frame", params={"path": str(tmp_path / "a.mp4")}).status_code == 404
    monkeypatch.setattr(media, "source_frame", lambda path, at: b"\xff\xd8jpeg")
    answer = client.get("/probe/frame", params={"path": str(tmp_path / "a.mp4"), "at": 12.5})
    assert answer.status_code == 200 and answer.headers["content-type"] == "image/jpeg"


def test_reframe_export_copies_without_overwriting(client, tmp_path):
    write_reframe(tmp_path / "output" / "p" / "full", [{"start": 0.0, "end": 6.0, "kind": "single"}])
    target = tmp_path / "exported"
    first = client.post("/projects/p/reframe/full/export",
                        json={"destination": str(target), "kinds": ["mp4", "srt"]}).json()
    second = client.post("/projects/p/reframe/full/export",
                         json={"destination": str(target), "kinds": ["mp4"]}).json()
    assert [Path(f["path"]).name for f in first["files"]] == ["01 - p - Reframe 9x16.mp4", "01 - p - Reframe 9x16.srt"]
    assert [Path(f["path"]).name for f in second["files"]] == ["01 - p - Reframe 9x16 (2).mp4"]
    assert client.post("/projects/p/reframe/clips/export", json={"kinds": ["mp4"]}).status_code == 400
    assert client.post("/projects/p/reframe/full_1x1/export", json={"kinds": ["mp4"]}).status_code == 404


def test_captions_come_from_the_plan_not_from_the_ass_file(tmp_path):
    """--no-captions នៅតែសរសេរ .ass (សម្រាប់ .srt/.vtt) — Result ធ្លាប់សរសេរ "ដុតរួច" ខុស."""
    folder = tmp_path / "full_1x1"
    write_reframe(folder, [{"start": 0.0, "end": 6.0, "kind": "single"}])
    (folder / "clip_01.ass").write_text("x", encoding="utf-8")
    data = json.loads((folder / "clip_01_layout.json").read_text(encoding="utf-8"))
    (folder / "clip_01_layout.json").write_text(json.dumps({**data, "captions": False}), encoding="utf-8")
    assert SC.reframe_outputs(tmp_path)[0]["captions"] is False


def test_layout_summary_records_whether_captions_are_burned(tmp_path):
    from pipeline.reframe import Box, Layout, Segment, save_layout_summary
    segments = [Segment(0.0, 4.0, Layout(kind="single", panels=[Box(x=0, y=0, w=10, h=10)]))]
    plain = json.loads(save_layout_summary(segments, tmp_path / "a.json").read_text(encoding="utf-8"))
    bare = json.loads(save_layout_summary(segments, tmp_path / "b.json", captions=False).read_text(encoding="utf-8"))
    assert plain["captions"] is True and bare["captions"] is False


def test_layout_summary_records_the_allowed_layouts(tmp_path):
    """--layout fit = គ្មាន single -> AI មិនតាមដាន subject; Result ត្រូវដឹងពីរឿងនេះ."""
    from pipeline.reframe import Box, Layout, Segment, parse_layouts, save_layout_summary
    segments = [Segment(0.0, 55.7, Layout(kind="center", panels=[Box(x=0, y=0, w=10, h=10)]))]
    path = save_layout_summary(segments, tmp_path / "full" / "clip_01_layout.json", allowed=parse_layouts("fit"))
    assert json.loads(path.read_text(encoding="utf-8"))["allowed"] == ["fit"]
    (tmp_path / "full" / "clip_01.mp4").write_bytes(b"x")
    assert SC.reframe_outputs(tmp_path)[0]["allowed"] == ["fit"]


def test_reframe_thumb_guards_the_folder_and_serves_a_jpeg(client, tmp_path, monkeypatch):
    """ទំព័រ Review បង្ហាញលទ្ធផលវីដេអូទាំងមូលជាកាត — រូបតូចមកពី media.thumbnail."""
    from server import media
    write_reframe(tmp_path / "output" / "p" / "full", [{"start": 0.0, "end": 6.0, "kind": "fit"}])
    image = tmp_path / "t.jpg"
    image.write_bytes(b"\xff\xd8jpeg")
    seen = []
    monkeypatch.setattr(media, "thumbnail", lambda video: seen.append(video.name) or image)
    answer = client.get("/projects/p/reframe/full/thumb")
    assert answer.status_code == 200 and answer.headers["content-type"] == "image/jpeg"
    assert seen == ["clip_01.mp4"]
    assert client.get("/projects/p/reframe/clips/thumb").status_code == 400
    monkeypatch.setattr(media, "thumbnail", lambda video: None)
    assert client.get("/projects/p/reframe/full_1x1/thumb").status_code == 404


def test_thumbnail_is_redone_when_the_video_is_newer(tmp_path, monkeypatch):
    import os
    from server import media
    video = tmp_path / "clip_01.mp4"
    video.write_bytes(b"x")
    old = tmp_path / "clip_01.jpg"
    old.write_bytes(b"old")
    os.utime(old, (1, 1))                              # រូបចាស់ជាងវីដេអូ
    calls = []
    monkeypatch.setattr(media.subprocess, "run", lambda *a, **k: calls.append(a) or old.write_bytes(b"new"))
    assert media.thumbnail(video) == old and calls      # ដកម្តងទៀត
    calls.clear()
    assert media.thumbnail(video) == old and not calls  # ថ្មីរួច -> ប្រើឡើងវិញ
