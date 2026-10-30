"""Background / Tracker ក្នុង sidecar: project.json, រូបចម្លង, flag របស់ job, /scenes."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from server import app as APP
from server import editor, manage
from server import jobs as J


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(APP, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(J.db, "save_job", lambda *a, **k: None)
    monkeypatch.setattr(APP, "runner", J.JobRunner())
    return TestClient(APP.app)


def test_clean_look_clamps_and_rejects():
    look = manage.clean_look({"background": "color", "color": "#1E8F5A", "blur": 500, "spacing": -3})
    assert look["blur"] == 100 and look["spacing"] == 0 and look["color"] == "#1E8F5A"
    for bad in ({"background": "video"}, {"color": "green"}, {"background": "image"}):
        with pytest.raises(ValueError):
            manage.clean_look(bad)


def test_look_is_saved_with_a_copied_image_and_the_original_untouched(tmp_path):
    folder = tmp_path / "output" / "talk"
    folder.mkdir(parents=True)
    picture = tmp_path / "Pictures" / "my bg.PNG"
    picture.parent.mkdir()
    picture.write_bytes(b"png-bytes")
    saved = manage.write_look(folder, {"background": "image", "image": str(picture), "radius": 40})
    assert saved["image"] == str(folder / "background.png")
    assert (folder / "background.png").read_bytes() == b"png-bytes"
    assert picture.read_bytes() == b"png-bytes"                  # រូបដើមនៅដដែល
    assert manage.read_look(folder)["radius"] == 40
    manage.write_cuts(folder, [[1, 2]], "hard")                  # cuts និង look នៅជាមួយគ្នា
    assert manage.read_look(folder)["background"] == "image" and manage.read_cuts(folder)["cuts"]
    (folder / "background.png").unlink()                         # រូបបាត់ -> blur វិញ
    assert manage.read_look(folder)["background"] == "blur"
    manage.write_look(folder, dict(manage.DEFAULT_LOOK))         # លំនាំដើម = គ្មាន key "look"
    assert "look" not in json.loads((folder / "project.json").read_text(encoding="utf-8"))


def test_look_endpoints(client, tmp_path):
    assert client.put("/projects/p/look", json={}).status_code == 404
    (tmp_path / "output" / "p").mkdir(parents=True)
    assert client.get("/projects/p/look").json()["background"] == "blur"
    assert client.put("/projects/p/look", json={"background": "color", "color": "#112233"}).status_code == 200
    assert client.get("/projects/p/look").json()["color"] == "#112233"
    assert client.put("/projects/p/look", json={"color": "red"}).status_code == 400
    assert client.get("/projects/p/background").status_code == 404
    assert client.get("/image", params={"path": str(tmp_path / "x.exe")}).status_code == 400


def test_job_with_a_look_gets_fit_and_tracking_flags(client, tmp_path, monkeypatch):
    video = tmp_path / "talk.mp4"
    video.write_bytes(b"x")
    picture = tmp_path / "bg.jpg"
    picture.write_bytes(b"jpg")
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args))
    look = {"background": "image", "image": str(picture), "blur": 50, "radius": 30, "spacing": 5,
            "no_track": [[10, 12]]}
    assert client.post("/jobs", json={"video": str(video), "full": True, "look": look}).status_code == 200
    time.sleep(0.2)
    args = captured["args"]
    flag = lambda name: args[args.index(name) + 1]  # noqa: E731
    assert flag("--fit-background") == "image"
    assert flag("--fit-image").endswith("background.jpg")
    assert (flag("--fit-blur"), flag("--fit-radius"), flag("--fit-spacing")) == ("50", "30", "5")
    assert json.loads(open(flag("--no-track-ranges"), encoding="utf-8").read()) == [[10.0, 12.0]]
    assert "--no-tracking" not in args and "--look" not in args


def test_job_with_tracking_off_and_a_bad_look(client, tmp_path, monkeypatch):
    video = tmp_path / "talk.mp4"
    video.write_bytes(b"x")
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args))
    assert client.post("/jobs", json={"video": str(video), "full": True,
                                      "look": {"tracking": False, "no_track": [[1, 2]]}}).status_code == 200
    time.sleep(0.2)
    assert "--no-tracking" in captured["args"] and "--no-track-ranges" not in captured["args"]
    assert "--fit-background" not in captured["args"]           # លំនាំដើមមិនផ្ញើ
    bad = client.post("/jobs", json={"video": str(video), "full": True, "look": {"background": "video"}})
    assert bad.status_code == 400


def test_scenes_are_cached_by_video_size_and_mtime(tmp_path, monkeypatch):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    calls = []
    import pipeline.audio as audio
    import pipeline.reframe as reframe
    monkeypatch.setattr(audio, "probe_duration", lambda path: 30.0)
    monkeypatch.setattr(reframe, "detect_cuts", lambda path, a, b: calls.append(1) or [10.0, 20.0])
    assert editor.scenes(video, tmp_path) == [[0.0, 10.0], [10.0, 20.0], [20.0, 30.0]]
    assert editor.scenes(video, tmp_path) == [[0.0, 10.0], [10.0, 20.0], [20.0, 30.0]]
    assert len(calls) == 1                                       # លើកទី ២ មកពី scenes.json


# ---------- Transform video ----------

def test_transform_is_validated_and_saved_in_the_look(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    saved = manage.write_look(folder, {"transform": {"x": 0.5, "y": 0.42, "scale": 1.1,
                                                     "crop": [0.14, 0, 0.72, 1]}})
    assert saved["transform"] == {"x": 0.5, "y": 0.42, "scale": 1.1, "crop": [0.14, 0.0, 0.72, 1.0]}
    assert manage.read_look(folder)["transform"]["scale"] == 1.1
    assert manage.look_options(saved)["transform_crop"] == "0.14,0,0.72,1"
    for bad in ({"x": 0.5}, {"x": 0.5, "y": 0.5, "scale": 9}, "big",
                {"x": 0.5, "y": 0.5, "scale": 1, "crop": [0.9, 0, 0.5, 1]}):
        with pytest.raises(ValueError):
            manage.clean_look({"transform": bad})
    manage.write_look(folder, {"transform": None})              # Reset = AI layout វិញ
    # គ្មានអ្វីត្រូវរក្សាទុក -> project.json ត្រូវលុប (ដូច ratings / title)
    assert manage.read_look(folder)["transform"] is None and not (folder / "project.json").exists()


def test_a_job_gets_the_transform_flags(client, tmp_path, monkeypatch):
    video = tmp_path / "talk.mp4"
    video.write_bytes(b"x")
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args))
    look = {"transform": {"x": 0.3, "y": 0.7, "scale": 0.5}}       # គ្មាន crop = វីដេអូទាំងមូល
    assert client.post("/jobs", json={"video": str(video), "full": True, "look": look}).status_code == 200
    time.sleep(0.2)
    args = captured["args"]
    assert args[args.index("--transform") + 1] == "0.3,0.7,0.5" and "--transform-crop" not in args
    bad = {"transform": {"x": 0.3, "y": 0.7, "scale": 50}}
    assert client.post("/jobs", json={"video": str(video), "full": True, "look": bad}).status_code == 400


def test_put_look_keeps_the_transform(client, tmp_path):
    (tmp_path / "output" / "talk").mkdir(parents=True)
    body = {"transform": {"x": 0.5, "y": 0.4, "scale": 1, "crop": [0.1, 0, 0.8, 1]}}
    assert client.put("/projects/talk/look", json=body).json()["transform"]["crop"] == [0.1, 0.0, 0.8, 1.0]
    assert client.get("/projects/talk/look").json()["transform"]["y"] == 0.4
    assert client.put("/projects/talk/look", json={"transform": {"x": 0.5, "y": 0.5, "scale": 99}}).status_code == 400
