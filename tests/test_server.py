"""Test សម្រាប់ sidecar (server/).

យើង**មិនរត់ pipeline ពិត**ទេ — `JobRunner` ត្រូវជំនួសដោយ process ក្លែងក្លាយ
ដូច្នេះ test លឿន ហើយមិនត្រូវការ GPU។
"""

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import config
from server import jobs as J
from server.app import app, runner


@pytest.fixture(autouse=True)
def clean_runner():
    runner.jobs.clear()
    yield
    runner.jobs.clear()


@pytest.fixture
def client():
    return TestClient(app)


def test_health_reports_ok(client):
    body = client.get("/health").json()
    assert body["ok"] is True
    assert body["busy"] is None


def test_videos_lists_samples(client):
    found = client.get("/videos").json()
    assert isinstance(found, list)
    for item in found:
        assert item["path"].endswith(".mp4")
        assert item["mb"] > 0


def test_missing_video_is_404(client):
    reply = client.post("/jobs", json={"video": "nope.mp4"})
    assert reply.status_code == 404


def test_unknown_job_is_404(client):
    assert client.get("/jobs/does-not-exist").status_code == 404
    assert client.delete("/jobs/does-not-exist").status_code == 404


def test_options_become_cli_flags(tmp_path, monkeypatch):
    """`max_clips=3` -> `--max-clips 3`, `full=True` -> `--full`."""
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    captured = {}

    def fake_run(self, job):
        captured["args"] = job.args
        job.state = "done"
        job.finished = time.time()

    monkeypatch.setattr(J.JobRunner, "_run", fake_run)
    job = runner.start(video, max_clips=3, full=True, layout="fill,split")
    time.sleep(0.2)
    args = captured["args"]
    assert "--max-clips" in args and "3" in args
    assert "--full" in args
    assert args[args.index("--layout") + 1] == "fill,split"


def test_only_one_job_runs_at_a_time(tmp_path, monkeypatch):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: time.sleep(2))
    runner.start(video)
    time.sleep(0.1)
    with pytest.raises(RuntimeError):
        runner.start(video)


def test_progress_reads_files_from_disk(tmp_path):
    """វឌ្ឍនភាពមកពី file ដែល pipeline សរសេរ មិនមែនពីការ parse អត្ថបទ."""
    out = tmp_path / "project"
    (out / "clips").mkdir(parents=True)
    job = J.Job(id="x", video=tmp_path / "v.mp4", out_dir=out, args=[])
    assert job.progress()["done"] == []

    (out / "audio.wav").write_bytes(b"x")
    (out / "transcript.json").write_text("{}", encoding="utf-8")
    assert job.progress()["done"] == ["audio", "transcribe"]
    assert job.progress()["step"] == "transcribe"

    (out / "clips" / "clip_01.ass").write_text("x", encoding="utf-8")
    assert "captions" in job.progress()["done"]


def test_clips_endpoint_needs_a_project(client):
    assert client.get("/projects/not-a-project/clips").status_code == 404


def test_clips_endpoint_returns_grades(client, tmp_path, monkeypatch):
    from pipeline.highlights import Clip, Dimension, Grades, save_clips

    project = tmp_path / "output" / "demo"
    (project / "clips").mkdir(parents=True)
    clip = Clip(start=0, end=30, title="demo clip", hook="h", type="story",
                grades=Grades(hook=Dimension(score=95, reason="strong open"),
                              flow=Dimension(score=80), value=Dimension(score=85)))
    save_clips([clip], project / "clips.json", model="m", prompt="p")
    monkeypatch.setattr("server.app.PROJECT_ROOT", tmp_path)

    body = client.get("/projects/demo/clips").json()
    assert body["clips"][0]["grades"]["hook"]["letter"] == "A"
    assert body["clips"][0]["grades"]["hook"]["reason"] == "strong open"
    assert body["clips"][0]["total"] == clip.total


def test_websocket_sends_status(client, tmp_path, monkeypatch):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")

    def fake_run(self, job):
        job.log.append("hello from the pipeline")
        job.state = "done"
        job.finished = time.time()

    monkeypatch.setattr(J.JobRunner, "_run", fake_run)
    job = runner.start(video)
    time.sleep(0.3)
    with client.websocket_connect(f"/jobs/{job.id}/events") as socket:
        first = socket.receive_text()
        assert "hello from the pipeline" in first


def test_websocket_rejects_unknown_job(client):
    with client.websocket_connect("/jobs/nope/events") as socket:
        assert "error" in json.loads(socket.receive_text())
