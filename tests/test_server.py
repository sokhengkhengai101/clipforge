"""Test សម្រាប់ sidecar (server/).

យើង**មិនរត់ pipeline ពិត**ទេ — `JobRunner` ត្រូវជំនួសដោយ process ក្លែងក្លាយ
ដូច្នេះ test លឿន ហើយមិនត្រូវការ GPU។
"""

import json
import os
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


def test_only_local_origins_are_allowed(client):
    """App desktop ហៅ 127.0.0.1 ពី origin `tauri.localhost` — វាត្រូវអនុញ្ញាត,
    ចំណែក website ខាងក្រៅមិនត្រូវ (គោលការណ៍ local-first)."""
    allowed = client.get("/health", headers={"Origin": "http://tauri.localhost"})
    assert allowed.headers.get("access-control-allow-origin") == "http://tauri.localhost"
    blocked = client.get("/health", headers={"Origin": "https://evil.example.com"})
    assert "access-control-allow-origin" not in blocked.headers


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
        # .ass/.mp4 ពីការ run មុនមិនមែន cached ទេ: ជំហានទាំងពីរនោះតែងរត់ម្តងទៀត
        (out / "clips" / "clip_01.ass").write_text("x", encoding="utf-8")
        (out / "clips" / "clip_01.mp4").write_bytes(b"x")
        runner.jobs.clear()
        rerun = runner.start(video)
        assert not {"captions", "render"} & set(rerun.progress()["cached"])
        # file ចាស់ពីការ run មុន != ចប់
        old = rerun.started - 60
        for name in ("clip_01.ass", "clip_01.mp4"):
            os.utime(out / "clips" / name, (old, old))
        assert rerun.progress()["done"] == ["audio", "transcribe"]
        # ពេល run នេះសរសេរ .ass ហើយ .mp4 ថ្មី ទើបជំហានទាំងពីររាប់ថាចប់
        later = rerun.started + 5
        os.utime(out / "clips" / "clip_01.ass", (later, later))
        assert rerun.progress()["fresh"] == ["captions"]
        os.utime(out / "clips" / "clip_01.mp4", (later, later))
        # .mp4 មានតាំងពី FFmpeg ចាប់ផ្តើម: render ចប់តែពេល job ចប់
        assert rerun.progress()["fresh"] == ["captions"]
        rerun.state = "done"
        assert rerun.progress()["fresh"] == ["captions", "render"]
        # ជំហានដែល --redo ប៉ះមិនមែន cached ទេ ទោះ file មានស្រាប់
        runner.jobs.clear()
        again = runner.start(video, redo="transcribe")
        assert again.progress()["cached"] == ["audio"]
    finally:
        for name in ("audio.wav", "transcript.json", "clips/clip_01.ass", "clips/clip_01.mp4"):
            (out / name).unlink(missing_ok=True)


def test_project_clip_count_comes_from_disk_not_the_database(client, monkeypatch):
    """job ដែលមិនចប់ `done` មិនសរសេរ clip ក្នុង database — CLI ដែល render ក្រោយត្រូវតែរាប់."""
    from server import app as APP

    DB.save_job("stale", "rendered-by-cli", "v.mp4", ["x"], time.time())
    monkeypatch.setattr(APP, "clips_of_project",
                        lambda folder: [{"index": i, "files": {"mp4": f"clip_0{i}.mp4"}}
                                        for i in (1, 2)] + [{"index": 3, "files": {}}]
                        if folder.name == "rendered-by-cli" else [])
    names = {item["name"]: item for item in client.get("/projects").json()}
    assert names["rendered-by-cli"]["clips"] == 2      # clip ទី ៣ មិនទាន់ render
    assert names["rendered-by-cli"]["jobs"] == 1


def test_projects_include_folders_made_before_the_database(client, monkeypatch):
    """Project ចាស់ដែលសង់ដោយ CLI មានតែ folder — វាត្រូវតែលេចក្នុងបញ្ជី."""
    from server import app as APP

    # clip ពិតតែងមាន .mp4 — ការរាប់ក្នុង /projects រាប់តែ clip ដែល render រួច
    monkeypatch.setattr(APP, "clips_of_project",
                        lambda folder: [{"index": 1, "files": {"mp4": "clip_01.mp4"}}]
                        if folder.name == "old-cli-project" else [])
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
    # captions + render ធ្វើថ្មីរាល់ការ run (.ass សង់ឡើងវិញ -> render ម្តងទៀត)
    assert J.steps_redone({}) == {"captions", "render"}
    assert J.steps_redone({"redo": "render"}) == {"captions", "render"}
    assert J.steps_redone({"redo": "highlights"}) == {
        "highlights", "boundaries", "captions", "render"}
    assert J.steps_redone({"force": True}) == {
        "audio", "transcribe", "highlights", "boundaries", "captions", "render"}
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


# ---------- Export (screen 05) ----------


def test_export_names_are_readable_and_legal():
    """`clip_01.mp4` ទៅជា `01 - Title.mp4`, ហើយតួអក្សរដែល Windows បដិសេធរត់ចោល."""
    from server import export as E

    assert E.export_name({"index": 1, "title": "Daily Rhino Monitoring"}, "mp4") \
        == "01 - Daily Rhino Monitoring.mp4"
    # `:` `"` `?` `/` មិនអាចនៅក្នុងឈ្មោះ file លើ Windows
    assert E.export_name({"index": 2, "title": 'Why "AI" fails: part 2/3?'}, "srt") \
        == "02 - Why AI fails part 23.srt"
    # គ្មាន title -> ឈ្មោះដើម
    assert E.export_name({"index": 3, "title": ""}, "mp4") == "clip_03.mp4"
    # វែងពេក -> កាត់, ហើយមិនបញ្ចប់ដោយ space ឬ `.`
    long_name = E.export_name({"index": 4, "title": "x" * 200 + "."}, "mp4")
    assert len(long_name) < 80 and not long_name.startswith("04 - .")


def fake_clip(folder: Path, index: int, title: str, kinds=("mp4", "srt")) -> dict:
    """clip ក្លែងក្លាយ៖ file ពិតលើ disk តែខ្លឹមសារជាអក្សរខ្លី (គ្មាន FFmpeg)."""
    files = {}
    for kind in kinds:
        path = folder / f"clip_{index:02d}.{kind}"
        path.write_bytes(b"data" * 10)
        files[kind] = str(path)
    return {"index": index, "title": title, "files": files}


@pytest.fixture
def project(tmp_path, monkeypatch):
    """Project ក្លែងក្លាយដែល `/projects/demo/export` មើលឃើញ."""
    from server import app as APP

    source = tmp_path / "clips"
    source.mkdir()
    clips = [fake_clip(source, 1, "First idea"), fake_clip(source, 2, "Second idea")]
    monkeypatch.setattr(APP, "clips_of_project", lambda folder: clips)
    return clips


def test_export_preview_does_not_touch_disk(client, project, tmp_path):
    """GET បង្ហាញតែអ្វីដែល *នឹង* កើតឡើង — គ្មាន file ថ្មីទេ."""
    body = client.get("/projects/demo/export?kinds=mp4,srt").json()
    assert [item["index"] for item in body["clips"]] == [1, 2]
    assert [file["name"] for file in body["clips"][0]["files"]] \
        == ["01 - First idea.mp4", "01 - First idea.srt"]
    assert body["bytes"] > 0 and body["mb"] == 0.0     # file ក្លែងតូចជាង 10 KB
    assert body["destination"].endswith(str(Path("ClipForge") / "demo"))
    assert not (tmp_path / "out").exists()


def test_export_copies_clips_and_keeps_the_originals(client, project, tmp_path):
    destination = tmp_path / "out"
    body = client.post("/projects/demo/export",
                       json={"destination": str(destination), "kinds": ["mp4"]}).json()
    assert len(body["files"]) == 2 and body["skipped"] == []
    assert sorted(path.name for path in destination.iterdir()) \
        == ["01 - First idea.mp4", "02 - Second idea.mp4"]
    # file ដើមនៅដដែល (គោលការណ៍៖ មិនប៉ះ output/)
    for clip in project:
        assert Path(clip["files"]["mp4"]).is_file()


def test_export_can_pick_some_clips_and_the_sidecars(client, project, tmp_path):
    destination = tmp_path / "out"
    body = client.post("/projects/demo/export",
                       json={"destination": str(destination), "clips": [2],
                             "kinds": ["mp4", "srt", "vtt"]}).json()
    # clip 2 ប៉ុណ្ណោះ, ហើយ vtt មិនមានលើ disk ដូច្នេះវាគ្មានក្នុងលទ្ធផល
    assert sorted(file["name"] for file in body["files"]) \
        == ["02 - Second idea.mp4", "02 - Second idea.srt"]


def test_export_never_overwrites(client, project, tmp_path):
    """Export ពីរដង = file ពីរ, មិនមែនមួយដែលត្រូវសរសេរពីលើ."""
    destination = tmp_path / "out"
    for _ in range(2):
        client.post("/projects/demo/export",
                    json={"destination": str(destination), "clips": [1], "kinds": ["mp4"]})
    assert sorted(path.name for path in destination.iterdir()) \
        == ["01 - First idea (2).mp4", "01 - First idea.mp4"]


def test_export_rejects_an_unknown_kind(client, project, tmp_path):
    reply = client.post("/projects/demo/export",
                        json={"destination": str(tmp_path / "out"), "kinds": ["exe"]})
    assert reply.status_code == 400


def test_export_404s_for_an_unknown_project(client, monkeypatch):
    from server import app as APP

    monkeypatch.setattr(APP, "clips_of_project", lambda folder: [])
    monkeypatch.setattr(APP.db, "project_clips", lambda name: [])
    assert client.get("/projects/not-a-project/export").status_code == 404


def test_export_400s_when_nothing_is_rendered(client, monkeypatch, tmp_path):
    """Project មាន តែ clip មិនទាន់ render — 400 ជាមួយមូលហេតុ, មិនមែន folder ទទេ."""
    from server import app as APP

    monkeypatch.setattr(APP, "clips_of_project",
                        lambda folder: [{"index": 1, "title": "x", "files": {}}])
    reply = client.post("/projects/demo/export", json={"destination": str(tmp_path / "out")})
    assert reply.status_code == 400
    assert not (tmp_path / "out").exists()


def test_reveal_needs_a_path_that_exists(client, tmp_path, monkeypatch):
    from server import export as E

    opened = []
    monkeypatch.setattr(E.subprocess, "Popen", lambda command, **kw: opened.append(command))
    monkeypatch.setattr(E.os, "startfile", lambda path: opened.append(path), raising=False)
    assert client.post("/reveal", json={"path": str(tmp_path)}).status_code == 200
    assert len(opened) == 1
    assert client.post("/reveal", json={"path": str(tmp_path / "nope")}).status_code == 404
    assert len(opened) == 1


def test_probe_reads_the_real_file(tmp_path, monkeypatch):
    """Resolution/Quality ក្នុង dialog មកពី ffprobe លើ clip ពិត, មិនមែនពី config."""
    from server import media

    video = tmp_path / "clip_01.mp4"
    video.write_bytes(b"x")
    answer = {"streams": [{"width": 1080, "height": 1920, "codec_name": "h264",
                           "avg_frame_rate": "30000/1001", "bit_rate": "2500000"}],
              "format": {"bit_rate": "2600000"}}

    def fake_run(command, **kwargs):
        return subprocess.CompletedProcess(command, 0, json.dumps(answer).encode())

    monkeypatch.setattr(media.subprocess, "run", fake_run)
    found = media.probe_video(video)
    assert found == {"width": 1080, "height": 1920, "fps": 29.97,
                     "codec": "h264", "kbps": 2500}
    assert media.probe_video(tmp_path / "gone.mp4") is None


def test_probe_survives_a_broken_ffprobe(tmp_path, monkeypatch):
    """ffprobe បាត់ ឬឆ្លើយមិនមែន JSON -> None, UI សរសេរ "—"."""
    from server import media

    video = tmp_path / "clip_01.mp4"
    video.write_bytes(b"x")
    monkeypatch.setattr(media.subprocess, "run",
                        lambda command, **kw: subprocess.CompletedProcess(command, 0, b"oops"))
    assert media.probe_video(video) is None


def test_projects_count_only_rendered_clips(client, monkeypatch):
    """`clips.json` អាចមានមុន render — ការ៉េមិនត្រូវសរសេរ READY ទេ."""
    from server import app as APP

    monkeypatch.setattr(APP, "clips_of_project", lambda folder: [
        {"index": 1, "title": "rendered", "files": {"mp4": "a.mp4", "srt": "a.srt"}},
        {"index": 2, "title": "chosen but never rendered", "files": {}},
    ])
    folder = J.PROJECT_ROOT / "output" / "half-rendered"
    folder.mkdir(parents=True, exist_ok=True)
    try:
        found = {item["name"]: item for item in client.get("/projects").json()}
        assert found["half-rendered"]["clips"] == 1
    finally:
        folder.rmdir()


# ---------- Env (screen 01 · AI models) ----------


def test_gpu_is_read_from_nvidia_smi(monkeypatch):
    """ctranslate2 ប្រាប់តែថាមាន CUDA; ឈ្មោះ និង VRAM មកពី nvidia-smi."""
    from server import env as E

    monkeypatch.setattr(E.subprocess, "run", lambda command, **kw: subprocess.CompletedProcess(
        command, 0, "NVIDIA GeForce GTX 1060, 3072\n"))
    assert E.gpu() == {"name": "NVIDIA GeForce GTX 1060", "vram_mb": 3072}

    # គ្មាន driver -> nvidia-smi មិនមាន -> None (UI សរសេរ "CPU")
    def missing(command, **kw):
        raise FileNotFoundError("nvidia-smi")

    monkeypatch.setattr(E.subprocess, "run", missing)
    assert E.gpu() is None


def test_whisper_cache_lists_downloaded_sizes(tmp_path, monkeypatch):
    """Folder `models--Systran--faster-whisper-medium` = medium ទាញរួច."""
    from server import env as E

    hub = tmp_path / "hub"
    (hub / "models--Systran--faster-whisper-medium").mkdir(parents=True)
    (hub / "models--Systran--faster-whisper-small").mkdir()
    (hub / "models--other--thing").mkdir()
    monkeypatch.setenv("HF_HUB_CACHE", str(hub))
    assert E.whisper_cache() == ["medium", "small"]


def test_ollama_is_not_fatal_when_it_is_down(monkeypatch):
    """Ollama បិទ -> ទំព័រនៅតែបង្ហាញបាន, គ្រាន់តែ `reachable: False`."""
    from server import env as E

    def refused(url, timeout=0):
        raise OSError("connection refused")

    monkeypatch.setattr(E.urllib.request, "urlopen", refused)
    answer = E.ollama()
    assert answer["reachable"] is False and answer["models"] == []


def test_env_endpoint_answers_with_the_machine(client):
    """`GET /env` ត្រូវឆ្លើយទោះ hardware ជាអ្វីក៏ដោយ — UI គូរពីវា."""
    body = client.get("/env").json()
    assert set(body) >= {"device", "gpu", "ram_mb", "disk_free_mb", "ollama",
                         "whisper_cache", "onnx", "anthropic_key"}
    assert body["device"] in ("cuda", "cpu")
    assert len(body["onnx"]) == 3
    assert isinstance(body["ollama"]["models"], list)


def test_model_pack_becomes_cli_flags(tmp_path, monkeypatch):
    """ជ្រើស pack = `--whisper-model` + `--model` ពិតលើ command line."""
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run",
                        lambda self, job: captured.update(args=job.args))
    monkeypatch.setattr(J.db, "save_job", lambda *a, **k: None)
    runner.start(video, whisper_model="medium", model="qwen2.5:7b-instruct")
    time.sleep(0.2)
    args = captured["args"]
    assert args[args.index("--whisper-model") + 1] == "medium"
    assert args[args.index("--model") + 1] == "qwen2.5:7b-instruct"


def test_health_says_where_output_goes(client):
    """screen Import បង្ហាញ folder ពិត — វាត្រូវតែជា output/ របស់ project."""
    body = client.get("/health").json()
    assert body["output_dir"].endswith("output")


# ---------- Transcript preview (screen Processing) ----------


def test_transcript_preview_drops_words_and_marks_candidates(tmp_path):
    """Processing ត្រូវការតែ start/end/text — words ធ្វើឲ្យ file ធំ ២ MB."""
    from pipeline.highlights import save_clips
    from server.clips import transcript_preview
    from tests.test_highlights import make_clip

    (tmp_path / "transcript.json").write_text(json.dumps({
        "duration": 3000.5, "device": "cuda",
        "segments": [{"id": 0, "start": 1.0, "end": 4.0, "text": " Hello there ",
                      "words": [{"word": "Hello", "start": 1.0, "end": 1.4}]}],
    }), encoding="utf-8")
    save_clips([make_clip(0, 30, title="A moment")], tmp_path / "highlights.json", model="m", prompt="p")

    preview = transcript_preview(tmp_path)
    assert preview["duration"] == 3000.5 and preview["device"] == "cuda"
    assert preview["segments"] == [{"start": 1.0, "end": 4.0, "text": "Hello there"}]
    assert preview["candidates"][0]["title"] == "A moment"


def test_transcript_preview_is_empty_before_the_files_exist(tmp_path):
    """job ទើបចាប់ផ្តើម: គ្មាន file ទេ — បញ្ជីទទេ មិនមែន error."""
    from server.clips import transcript_preview

    assert transcript_preview(tmp_path / "not-yet") == {
        "duration": None, "device": None, "segments": [], "candidates": []}


def test_transcript_endpoint_answers_for_a_new_project_and_refuses_paths(client):
    assert client.get("/projects/never-ran-yet/transcript").status_code == 200
    assert client.get("/projects/../transcript").status_code in (400, 404)
    assert client.get("/projects/%2E%2E/transcript").status_code == 400


def test_explorer_select_quotes_only_the_path():
    """list -> Python quote "/select,..." ទាំងមូល ហើយ Explorer បើក Documents ជំនួស."""
    from server import export
    path = Path(r"C:\clips\01 - Comedy vs. Real Life (2).mp4")
    assert export.explorer_select(path) == r'explorer /select,"C:\clips\01 - Comedy vs. Real Life (2).mp4"'


def test_caption_style_reaches_the_command_line(client, tmp_path, monkeypatch):
    """screen Subtitles ផ្ញើ style តាម POST /jobs — JobRequest មិនត្រូវទម្លាក់វាចោលទេ."""
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args))
    monkeypatch.setattr(J.db, "save_job", lambda *a, **k: None)
    answer = client.post("/jobs", json={
        "video": str(video), "redo": "render", "caption_size": 85, "caption_outline": 2,
        "caption_case": "original", "caption_position": "top", "no_captions": True,
    })
    assert answer.status_code == 200
    time.sleep(0.2)
    args = captured["args"]
    assert args[args.index("--caption-size") + 1] == "85"
    assert args[args.index("--caption-outline") + 1] == "2"
    assert args[args.index("--caption-case") + 1] == "original"
    assert args[args.index("--caption-position") + 1] == "top"
    assert "--no-captions" in args
