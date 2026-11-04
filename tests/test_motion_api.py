"""Motion ក្នុង sidecar: project.json (key motion), GET/PUT, flag របស់ job."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from server import app as APP
from server import jobs as J
from server import manage


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(APP, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(J.db, "save_job", lambda *a, **k: None)
    monkeypatch.setattr(APP, "runner", J.JobRunner())
    (tmp_path / "output" / "talk").mkdir(parents=True)
    video = tmp_path / "talk.mp4"
    video.write_bytes(b"x")
    return TestClient(APP.app), str(video)


def test_clean_motion_clamps_and_rejects():
    assert manage.clean_motion({"zoom": "in", "zoom_amount": 50, "keywords": -1})["zoom_amount"] == 20
    for bad in ({"zoom": "spin"}, {"shake": "big"}, {"animation": "wiggle"}):
        with pytest.raises(ValueError):
            manage.clean_motion(bad)


def test_motion_lives_beside_look_and_cuts(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    manage.write_cuts(folder, [[1, 2]], "hard")
    manage.write_look(folder, {"background": "color", "color": "#112233"})
    manage.write_motion(folder, {"zoom": "out", "animation": "fade"})
    assert manage.read_motion(folder)["zoom"] == "out"
    assert manage.read_look(folder)["color"] == "#112233" and manage.read_cuts(folder)["cuts"]
    manage.write_motion(folder, dict(manage.DEFAULT_MOTION))
    assert "motion" not in json.loads((folder / "project.json").read_text(encoding="utf-8"))


def test_motion_endpoints(client):
    http, _ = client
    assert http.put("/projects/none/motion", json={}).status_code == 404
    assert http.get("/projects/talk/motion").json()["animation"] == "pop"
    assert http.put("/projects/talk/motion", json={"shake": "loud", "keywords": 8}).json()["keywords"] == 8
    assert http.get("/projects/talk/motion").json()["shake"] == "loud"
    assert http.put("/projects/talk/motion", json={"zoom": "spin"}).status_code == 400


def test_a_job_gets_the_motion_flags(client, monkeypatch):
    http, video = client
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args))
    motion = {"zoom": "in", "zoom_amount": 12, "keywords": 8, "shake": "loud", "animation": "bounce"}
    assert http.post("/jobs", json={"video": video, "full": True, "motion": motion}).status_code == 200
    time.sleep(0.2)
    args = captured["args"]
    flag = lambda name: args[args.index(name) + 1]  # noqa: E731
    assert (flag("--motion-zoom"), flag("--motion-zoom-amount"), flag("--motion-keywords"),
            flag("--motion-shake"), flag("--caption-animation")) == ("in", "12", "8", "loud", "bounce")
    assert "--motion" not in args


def test_default_motion_sends_no_flags_and_bad_motion_is_400(client, monkeypatch):
    http, video = client
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args))
    assert http.post("/jobs", json={"video": video, "full": True, "motion": {}}).status_code == 200
    time.sleep(0.2)
    assert not [a for a in captured["args"] if a.startswith("--motion") or a == "--caption-animation"]
    assert http.post("/jobs", json={"video": video, "full": True, "motion": {"shake": "big"}}).status_code == 400
    assert http.post("/jobs", json={"video": video, "caption_animation": "wiggle"}).status_code == 400


def test_motion_cues_for_the_preview(client, tmp_path):
    from pipeline.transcribe import Segment, Transcript, Word, save_transcript
    http, _ = client
    assert http.get("/projects/talk/motion/cues").json()["ready"] is False
    words = [Word(" incredible", 1.0, 1.5), Word(" afterwards", 6.0, 6.5)]
    save_transcript(Transcript(language="en", language_probability=0.9, duration=8.0, model="m", device="cpu",
                               segments=[Segment(id=0, start=0.0, end=8.0, text="x", words=words)]),
                    tmp_path / "output" / "talk" / "transcript.json")
    answer = http.get("/projects/talk/motion/cues").json()
    assert answer["ready"] and answer["keywords"][0] == 1.0 and answer["loud"] == []   # គ្មាន audio.wav


# ---------- animation ថ្មី (ក្រុម A / B / C) ----------

NEW_ANIMATIONS = ["slide_left", "blur_in", "soft_landing", "grow", "baby_steps",
                  "scale", "underline", "box", "highlighter", "seamless_bounce", "blur_switch", "focus",
                  "breathe", "baby_earthquake", "glitch_infinite_zoom", "with_backdrop"]


def test_every_animation_belongs_to_one_group():
    import config
    from pipeline import caption_fx
    groups = [caption_fx.ENTRANCES, caption_fx.WORD_EFFECTS, caption_fx.HOLDS]
    for name in NEW_ANIMATIONS:
        assert name in config.CAPTION_ANIMATIONS
        assert sum(name in g for g in groups) == (0 if name == "baby_steps" else 1), name


@pytest.mark.parametrize("name", ["grow", "box", "with_backdrop"])
def test_new_animations_are_saved_and_reach_the_command_line(client, monkeypatch, name):
    http, video = client
    assert http.put("/projects/talk/motion", json={"animation": name}).json()["animation"] == name
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args))
    assert http.post("/jobs", json={"video": video, "caption_animation": name}).status_code == 200
    time.sleep(0.2)
    args = captured["args"]
    assert args[args.index("--caption-animation") + 1] == name
