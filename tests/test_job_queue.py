"""ជួរ job: វីដេអូទី ២ រង់ ហើយចាប់ផ្តើមដោយខ្លួនឯងពេលវីដេអូទី ១ ចប់."""
import threading
import time

import pytest

import server.jobs as jobs_module
from server import db
from server.jobs import JobRunner


class FakeProcess:
    """make_clips ក្លែង: រង់រហូតដល់ test ប្រាប់ឲ្យចប់ (`release`)."""

    def __init__(self, video, code):
        self.video, self.code = video, code
        self.done = threading.Event()
        self.stdout = iter([])

    def wait(self):
        self.done.wait(5)
        return self.code

    def terminate(self):
        self.done.set()


@pytest.fixture
def setup(monkeypatch, tmp_path):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init_db()
    started, codes = [], {}

    def popen(args, **_):
        process = FakeProcess(args[3], codes.get(args[3], 0))
        started.append(process)
        return process

    monkeypatch.setattr(jobs_module.subprocess, "Popen", popen)
    videos = []
    for name in ("a", "b", "c"):
        video = tmp_path / f"{name}.mp4"
        video.write_bytes(b"x")
        videos.append(video)
    return JobRunner(), videos, started, codes


def wait_for(check):
    end = time.time() + 5
    while not check():
        assert time.time() < end, "timeout"
        time.sleep(0.01)


def test_without_queue_a_second_job_is_refused(setup):
    runner, (a, b, _), started, _ = setup
    runner.start(a)
    with pytest.raises(RuntimeError):
        runner.start(b)
    started[0].done.set()


def test_queued_jobs_run_one_after_another_in_order(setup):
    runner, (a, b, c), started, _ = setup
    first = runner.start(a)
    second = runner.start(b, queue=True)
    third = runner.start(c, queue=True)
    assert (first.state, second.state, third.state) == ("running", "queued", "queued")
    assert second.progress()["step"] == "queued" and second.progress()["done"] == []
    assert len(started) == 1                      # មិនរត់ពីរព្រមគ្នា

    started[0].done.set()
    wait_for(lambda: len(started) == 2)
    assert first.state == "done" and second.state == "running" and third.state == "queued"
    assert started[1].video == str(b)

    started[1].done.set()
    wait_for(lambda: len(started) == 3)
    started[2].done.set()
    wait_for(lambda: third.state == "done")
    assert runner.pending == []


def test_a_failed_job_still_starts_the_next(setup):
    runner, (a, b, _), started, codes = setup
    codes[str(a)] = 1
    first = runner.start(a)
    second = runner.start(b, queue=True)
    started[0].done.set()
    wait_for(lambda: len(started) == 2)
    assert first.state == "failed" and second.state == "running"
    started[1].done.set()


def test_cancelling_a_queued_job_removes_it(setup):
    runner, (a, b, c), started, _ = setup
    runner.start(a)
    second = runner.start(b, queue=True)
    third = runner.start(c, queue=True)
    runner.cancel(second.id)
    assert second.state == "cancelled" and runner.pending == [third]
    started[0].done.set()
    wait_for(lambda: len(started) == 2)
    assert started[1].video == str(c)             # b ត្រូវបានរំលង
    started[1].done.set()
    wait_for(lambda: third.state == "done")
    assert len(started) == 2
