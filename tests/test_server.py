"""Test សម្រាប់ sidecar (server/).

យើង**មិនរត់ pipeline ពិត**ទេ — `JobRunner` ត្រូវជំនួសដោយ process ក្លែងក្លាយ
ដូច្នេះ test លឿន ហើយមិនត្រូវការ GPU។
"""

import json
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import config
from server import db as DB
from server import jobs as J
from server.app import app, runner


@pytest.fixture(autouse=True)
def clean_runner(tmp_path, monkeypatch):
    """Test មិនត្រូវសរសេរចូល database ពិតទេ — វាធ្វើឲ្យ UI បង្ហាញ project ក្លែង
    ឈ្មោះ `v` (យើងឃើញវាពិតក្នុងបញ្ជី "Recent projects")."""
    monkeypatch.setattr(DB, "DB_PATH", tmp_path / "test.db")
    DB.init_db()
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


def test_root_redirects_to_docs(client):
    """បើក `/` ក្នុង browser មិនត្រូវជួប 404 ទេ."""
    answer = client.get("/", follow_redirects=False)
    assert answer.status_code in (307, 308)
    assert answer.headers["location"] == "/docs"


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


def test_clip_file_is_found_by_index_not_by_path(tmp_path):
    """URL ប្រាប់តែ**លេខ** clip — path មកពី clips.json ដូច្នេះ `../` គ្មានន័យ."""
    from server import media

    video = tmp_path / "clip_01.mp4"
    video.write_bytes(b"x")
    clips = [{"index": 1, "files": {"mp4": str(video)}},
             {"index": 2, "files": {}}]
    found = media.clip_file(clips, 1, "mp4")
    assert found is not None and found[0] == video and found[1] == "video/mp4"
    assert media.clip_file(clips, 2, "mp4") is None       # clip មាន តែគ្មាន file
    assert media.clip_file(clips, 9, "mp4") is None       # គ្មាន clip នេះ
    assert media.clip_file(clips, 1, "exe") is None       # kind មិនស្គាល់


def test_clip_file_endpoint_404s_without_a_project(client):
    assert client.get("/projects/not-a-project/clips/1/file").status_code == 404
    assert client.get("/projects/not-a-project/clips/1/thumb").status_code == 404


def test_thumbnail_is_cached(tmp_path, monkeypatch):
    """FFmpeg រត់តែលើកដំបូង — លើកក្រោយប្រើ .jpg ដែលមានស្រាប់."""
    from server import media

    video = tmp_path / "clip_01.mp4"
    video.write_bytes(b"x")
    image = tmp_path / "clip_01.jpg"
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        image.write_bytes(b"jpeg")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(media.subprocess, "run", fake_run)
    assert media.thumbnail(video) == image
    assert media.thumbnail(video) == image
    assert len(calls) == 1


def test_cached_steps_are_not_counted_as_progress(tmp_path, monkeypatch):
    """Marker file ពីការរត់មុនមិនត្រូវបង្ហាញជា 6/6 ភ្លាមក្នុង UI."""
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    out = J.PROJECT_ROOT / "output" / "v"
    (out / "clips").mkdir(parents=True, exist_ok=True)
    (out / "audio.wav").write_bytes(b"x")
    (out / "transcript.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: None)
    monkeypatch.setattr(J.db, "save_job", lambda *a, **k: None)
    try:
        job = runner.start(video)
        progress = job.progress()
        assert set(progress["cached"]) == {"audio", "transcribe"}
        assert progress["fresh"] == []
        # ជំហានដែល --redo ប៉ះមិនមែន cached ទេ ទោះ file មានស្រាប់
        runner.jobs.clear()
        again = runner.start(video, redo="transcribe")
        assert again.progress()["cached"] == ["audio"]
    finally:
        for name in ("audio.wav", "transcript.json"):
            (out / name).unlink(missing_ok=True)


def test_projects_include_folders_made_before_the_database(client, monkeypatch):
    """Project ចាស់ដែលសង់ដោយ CLI មានតែ folder — វាត្រូវតែលេចក្នុងបញ្ជី."""
    from server import app as APP

    monkeypatch.setattr(APP, "clips_of_project",
                        lambda folder: [{"index": 1}] if folder.name == "old-cli-project" else [])
    folder = J.PROJECT_ROOT / "output" / "old-cli-project"
    folder.mkdir(parents=True, exist_ok=True)
    try:
        names = {item["name"]: item for item in client.get("/projects").json()}
        assert "old-cli-project" in names
        assert names["old-cli-project"]["clips"] == 1
        assert names["old-cli-project"]["jobs"] == 0
    finally:
        folder.rmdir()


def test_a_job_left_running_is_marked_interrupted(tmp_path):
    """Row `running` ពេល server ចាប់ផ្តើម = job ដែលស្លាប់ ទេមិនមែនកំពុងរត់."""
    DB.save_job("ghost", "project", "v.mp4", ["x"], time.time())
    assert DB.list_jobs()[0]["state"] == "running"
    assert DB.interrupt_stale_jobs() == 1
    row = DB.list_jobs()[0]
    assert row["state"] == "interrupted" and row["error"]
    assert DB.interrupt_stale_jobs() == 0      # ធ្វើម្តងទៀតគ្មានអ្វីប្តូរ


def test_redo_flags_map_to_steps():
    assert J.steps_redone({}) == set()
    assert J.steps_redone({"redo": "render"}) == {"captions", "render"}
    assert J.steps_redone({"redo": "highlights"}) == {"highlights", "boundaries"}
    assert J.steps_redone({"force": True}) == {
        "audio", "transcribe", "highlights", "boundaries", "captions", "render"}
    # --full render ជាថ្មីរាល់ដង ទោះ .mp4 ចាស់មាននៅ
    assert J.steps_redone({"full": True}) == {"captions", "render"}


def test_clips_endpoint_needs_a_project(client):
    assert client.get("/projects/not-a-project/clips").status_code == 404


def test_project_without_clips_yet_returns_an_empty_list(client, tmp_path, monkeypatch):
    """Project ដែលទើបចាប់ផ្តើម -> 200 និងបញ្ជីទទេ, មិនមែន 404."""
    empty = J.PROJECT_ROOT / "output" / "empty-project-for-test"
    empty.mkdir(parents=True, exist_ok=True)
    try:
        answer = client.get("/projects/empty-project-for-test/clips")
        assert answer.status_code == 200
        assert answer.json()["clips"] == []
    finally:
        empty.rmdir()


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


# ---------- database (1B) ----------

@pytest.fixture
def db_path(tmp_path):
    path = tmp_path / "test.db"
    DB.init_db(path)
    return path


def test_project_is_created_once(db_path):
    first = DB.project_id("demo", "D:/v.mp4", db_path)
    again = DB.project_id("demo", "D:/v.mp4", db_path)
    assert first == again
    assert len(DB.list_projects(db_path)) == 1


def test_job_history_survives(db_path):
    DB.save_job("j1", "demo", "D:/v.mp4", ["python", "make_clips.py"], 100.0, db_path)
    DB.update_job("j1", state="done", step="render", finished=160.0, path=db_path)
    jobs = DB.list_jobs(path=db_path)
    assert jobs[0]["id"] == "j1"
    assert jobs[0]["state"] == "done"
    assert jobs[0]["seconds"] == 60.0
    assert jobs[0]["project"] == "demo"
    assert jobs[0]["args"][0] == "python"


def test_failed_job_keeps_its_error(db_path):
    DB.save_job("j2", "demo", "D:/v.mp4", [], 10.0, db_path)
    DB.update_job("j2", state="failed", error="ffmpeg បាត់", finished=12.0, path=db_path)
    assert DB.list_jobs(path=db_path)[0]["error"] == "ffmpeg បាត់"


def test_clips_round_trip(db_path):
    clips = [{"index": 1, "start": 0.0, "end": 30.0, "title": "one", "type": "story",
              "total": 87, "letter": "B+",
              "grades": {"hook": {"score": 90, "letter": "A-", "reason": "r"}},
              "files": {"mp4": "a.mp4"}}]
    assert DB.save_clips("demo", "D:/v.mp4", clips, db_path) == 1
    stored = DB.project_clips("demo", db_path)
    assert stored[0]["index"] == 1
    assert stored[0]["grades"]["hook"]["letter"] == "A-"
    assert stored[0]["files"]["mp4"] == "a.mp4"


def test_saving_clips_replaces_the_old_set(db_path):
    DB.save_clips("demo", "D:/v.mp4", [{"index": i, "start": 0, "end": 10,
                                        "title": f"c{i}"} for i in (1, 2, 3)], db_path)
    DB.save_clips("demo", "D:/v.mp4", [{"index": 1, "start": 0, "end": 10,
                                        "title": "only"}], db_path)
    stored = DB.project_clips("demo", db_path)
    assert len(stored) == 1 and stored[0]["title"] == "only"


def test_project_summary_counts(db_path):
    DB.save_job("j3", "demo", "D:/v.mp4", [], 1.0, db_path)
    DB.update_job("j3", state="done", finished=2.0, path=db_path)
    DB.save_clips("demo", "D:/v.mp4", [{"index": 1, "start": 0, "end": 5, "title": "x"}],
                  db_path)
    summary = DB.list_projects(db_path)[0]
    assert summary["clips"] == 1 and summary["jobs"] == 1
    assert summary["last_state"] == "done"


def test_connection_is_closed(db_path):
    """`with sqlite3.connect()` commit តែមិន close — file ត្រូវលុបបាន."""
    DB.project_id("demo", "D:/v.mp4", db_path)
    db_path.unlink()          # បរាជ័យលើ Windows បើ handle នៅជាប់
    assert not db_path.exists()
