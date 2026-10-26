"""ប្តូរឈ្មោះ និងលុប project (server/manage.py + PATCH/DELETE /projects/{name})."""

import shutil
import subprocess
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from server import app as APP
from server import db as DB
from server import jobs as J
from server import manage


# ---------- ឈ្មោះបង្ហាញ ----------

def test_title_round_trip_and_reset(tmp_path):
    assert manage.read_title(tmp_path) is None
    assert manage.write_title(tmp_path, "  Podcast   ខ្មែរ\n EP 1 ") == "Podcast ខ្មែរ EP 1"
    assert manage.read_title(tmp_path) == "Podcast ខ្មែរ EP 1"
    assert manage.write_title(tmp_path, "   ") is None          # ទទេ = ឈ្មោះ folder វិញ
    assert not (tmp_path / manage.TITLE_FILE).exists()


def test_title_is_capped_and_broken_file_ignored(tmp_path):
    assert len(manage.write_title(tmp_path, "x" * 500)) == manage.TITLE_MAX
    (tmp_path / manage.TITLE_FILE).write_text("{not json", encoding="utf-8")
    assert manage.read_title(tmp_path) is None


# ---------- Recycle Bin ----------

def test_recycle_passes_the_path_by_environment(tmp_path, monkeypatch):
    """path ចូលតាម env var — quote ឬ `$` ក្នុងឈ្មោះមិនប្តូរ command ទេ."""
    folder = tmp_path / "it's $HOME; rm"
    folder.mkdir()
    seen = {}

    def fake_run(cmd, env, **kwargs):
        seen.update(cmd=cmd, path=env["CLIPFORGE_RECYCLE"])
        shutil.rmtree(env["CLIPFORGE_RECYCLE"])               # ដូច Windows យកវាទៅ Recycle Bin
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    manage.recycle(folder)
    assert seen["path"] == str(folder)
    assert str(folder) not in " ".join(seen["cmd"])
    assert "SendToRecycleBin" in seen["cmd"][-1]


def test_recycle_raises_when_the_folder_is_still_there(tmp_path, monkeypatch):
    monkeypatch.setattr(subprocess, "run",
                        lambda cmd, env, **kw: SimpleNamespace(returncode=1, stdout="", stderr="denied"))
    with pytest.raises(OSError, match="denied"):
        manage.recycle(tmp_path)


# ---------- API ----------

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(DB, "DB_PATH", tmp_path / "test.db")
    DB.init_db()
    return TestClient(APP.app)


@pytest.fixture
def project():
    """folder ពិតក្នុង output/ (ដូច test ផ្សេងៗ) — លុបវិញក្រោយ test."""
    folder = J.PROJECT_ROOT / "output" / "manage-test-project"
    (folder / "clips").mkdir(parents=True, exist_ok=True)
    (folder / "audio.wav").write_bytes(b"0" * 10)
    yield folder
    shutil.rmtree(folder, ignore_errors=True)


def test_rename_changes_only_the_title(client, project):
    response = client.patch("/projects/manage-test-project", json={"title": "Rhino ពិសេស"})
    assert response.json() == {"name": "manage-test-project", "title": "Rhino ពិសេស"}
    assert project.is_dir() and (project / "audio.wav").is_file()       # គ្មានអ្វីផ្លាស់ទី
    assert manage.read_title(project) == "Rhino ពិសេស"
    assert client.patch("/projects/manage-test-project", json={"title": ""}).json()["title"] == \
        "manage-test-project"


def test_rename_unknown_or_bad_name(client):
    assert client.patch("/projects/no-such-project", json={"title": "x"}).status_code == 404
    assert client.patch("/projects/%2E%2E", json={"title": "x"}).status_code == 400


def test_delete_recycles_the_folder_and_forgets_the_project(client, project, monkeypatch):
    DB.save_job("j1", "manage-test-project", "v.mp4", ["x"], time.time())
    recycled = []
    monkeypatch.setattr(manage, "recycle", lambda folder: (recycled.append(folder), shutil.rmtree(folder)))

    response = client.delete("/projects/manage-test-project")
    assert response.json() == {"name": "manage-test-project", "recycled": True}
    assert recycled == [project] and not project.exists()
    assert all(item["name"] != "manage-test-project" for item in DB.list_projects())
    assert DB.list_jobs() == []


def test_delete_refuses_while_its_job_runs(client, project, monkeypatch):
    running = SimpleNamespace(out_dir=project)
    monkeypatch.setattr(APP.runner, "active", lambda: running)
    monkeypatch.setattr(manage, "recycle", lambda folder: pytest.fail("must not recycle"))
    assert client.delete("/projects/manage-test-project").status_code == 409
    assert project.is_dir()


def test_delete_keeps_the_database_when_recycling_fails(client, project, monkeypatch):
    DB.save_job("j2", "manage-test-project", "v.mp4", ["x"], time.time())

    def broken(folder):
        raise OSError("in use")

    monkeypatch.setattr(manage, "recycle", broken)
    response = client.delete("/projects/manage-test-project")
    assert response.status_code == 500 and "in use" in response.json()["detail"]
    assert any(item["name"] == "manage-test-project" for item in DB.list_projects())


def test_delete_unknown_or_bad_name(client):
    assert client.delete("/projects/no-such-project").status_code == 404
    assert client.delete("/projects/%2E%2E").status_code == 400
