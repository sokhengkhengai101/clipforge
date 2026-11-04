"""Long to Short ជ្រើសទំហំក្រៅពី 9:16: job មួយ render 9:16 រួចទំហំនោះ."""
import server.jobs as jobs_module
from server import db
from server.jobs import JobRunner


class FakeProcess:
    """make_clips ក្លែង: រាយបន្ទាត់ render ពាក់កណ្តាល និងចប់."""

    def __init__(self, code):
        self.stdout = iter(["progress render 1 2\n", "progress render 2 2\n"])
        self.code = code

    def wait(self):
        return self.code

    def terminate(self):
        pass


def _run(monkeypatch, tmp_path, codes, **options):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init_db()
    calls, fractions = [], []
    answers = iter(codes)

    def popen(args, **_):
        calls.append(args)
        return FakeProcess(next(answers))

    monkeypatch.setattr(jobs_module.subprocess, "Popen", popen)
    runner = JobRunner()
    job = runner.start(video, **options)
    while job.state == "running":
        pass
    fractions.append(job.fractions.get("render"))
    return job, calls, fractions


def test_two_renders_in_one_job(monkeypatch, tmp_path):
    job, calls, fractions = _run(monkeypatch, tmp_path, [0, 0], max_clips=2, also_aspect="1:1")
    assert job.state == "done"
    assert len(calls) == 2
    assert "--aspect" not in calls[0] and "--also-aspect" not in calls[0]
    assert calls[1][-2:] == ["--aspect", "1:1"] and "--max-clips" in calls[1]
    assert fractions == [1.0]                     # 2 ដង = % តែមួយដែលចប់ត្រឹម 100


def test_a_failed_first_render_stops_the_second(monkeypatch, tmp_path):
    job, calls, _ = _run(monkeypatch, tmp_path, [1], also_aspect="16:9")
    assert job.state == "failed" and len(calls) == 1


def test_without_also_aspect_one_render(monkeypatch, tmp_path):
    job, calls, fractions = _run(monkeypatch, tmp_path, [0], max_clips=2)
    assert job.state == "done" and len(calls) == 1 and fractions == [1.0]
