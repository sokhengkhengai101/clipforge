"""Manual subject tracking ក្នុង sidecar: /pick, /track, Reset, ផ្លូវក្នុង look និង flag របស់ job."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from pipeline import subject_track as st
from server import app as APP
from server import editor, manage
from server import jobs as J


def a_track(start=10.0, end=20.0):
    return st.Track(start=start, end=end, box=(100, 100, 50, 50), label="area",
                    points=[(start + 1, 300.0, 200.0), (start + 2, 320.0, 200.0)],
                    good_from=start + 1, good_until=start + 2)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(APP, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(J.db, "save_job", lambda *a, **k: None)
    monkeypatch.setattr(APP, "runner", J.JobRunner())
    monkeypatch.setattr("pipeline.render.probe_dimensions", lambda path: (1280, 720))
    monkeypatch.setattr(editor, "scenes", lambda video, folder=None: [[0.0, 10.0], [10.0, 20.0]])
    (tmp_path / "output" / "talk").mkdir(parents=True)
    video = tmp_path / "talk.mp4"
    video.write_bytes(b"x")
    return TestClient(APP.app), str(video)


def test_track_saves_one_path_per_scene_and_clears_tracking_off(client, monkeypatch, tmp_path):
    http, video = client
    seen = {}

    def fake_track(video_path, start, end, at, x, y, size, mode):
        seen.update(scene=(start, end), click=(x, y), mode=mode)
        return a_track(start, end)

    monkeypatch.setattr(st, "track_subject", fake_track)
    manage.write_look(tmp_path / "output" / "talk", {"no_track": [[10, 20]]})
    answer = http.post("/projects/talk/track", json={"video": video, "time": 12.5, "x": 0.5, "y": 0.25, "mode": "area"})
    assert answer.status_code == 200
    assert seen == {"scene": (10.0, 20.0), "click": (640.0, 180.0), "mode": "area"}
    look = answer.json()["look"]
    assert len(look["subjects"]) == 1 and look["no_track"] == []          # ជ្រើសប្រធានបទ = បើក tracking វិញ
    http.post("/projects/talk/track", json={"video": video, "time": 15.0, "x": 0.1, "y": 0.1})
    assert len(manage.read_look(tmp_path / "output" / "talk")["subjects"]) == 1   # scene ដដែល = ជំនួស
    assert http.delete("/projects/talk/track", params={"start": 10, "end": 20}).json()["subjects"] == []


def test_track_refuses_bad_requests(client, monkeypatch):
    http, video = client
    body = {"video": video, "time": 12.5, "x": 0.5, "y": 0.5}
    assert http.post("/projects/talk/track", json={**body, "mode": "magic"}).status_code == 400
    assert http.post("/projects/talk/track", json={**body, "x": 1.5}).status_code == 400
    assert http.post("/projects/other/track", json=body).status_code == 404
    assert http.post("/projects/talk/track", json={**body, "time": 99}).status_code == 400
    monkeypatch.setattr(APP.runner, "active", lambda: object())
    assert http.post("/projects/talk/track", json=body).status_code == 409


def test_pick_returns_the_subject_and_the_area(client, monkeypatch):
    http, video = client
    monkeypatch.setattr("pipeline.reframe.grab_frame", lambda *a: None)
    monkeypatch.setattr(st, "pick_subject", lambda frame, size, x, y: ((600, 100, 300, 500), "cow"))
    answer = http.post("/projects/talk/pick", json={"video": video, "time": 3, "x": 0.5, "y": 0.5}).json()
    assert answer["subject"] == [600, 100, 300, 500] and answer["label"] == "cow"
    assert answer["area"] == [550, 270, 180, 180] and answer["size"] == [1280, 720]


def test_a_job_gets_the_tracks_file(client, monkeypatch):
    http, video = client
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args))
    look = {"tracking": False, "subjects": [a_track().as_dict()]}
    assert http.post("/jobs", json={"video": video, "full": True, "look": look}).status_code == 200
    time.sleep(0.2)
    args = captured["args"]
    tracks = json.loads(open(args[args.index("--subject-tracks") + 1], encoding="utf-8").read())
    assert st.Track.from_dict(tracks[0]) == a_track()
    bad = {"subjects": [{"start": 1}]}
    assert http.post("/jobs", json={"video": video, "full": True, "look": bad}).status_code == 400
