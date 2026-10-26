"""វឌ្ឍនភាពពិតក្នុងជំហាន: make_clips.report_progress សរសេរ, server/jobs.parse_progress អាន."""

from types import SimpleNamespace

import make_clips as M
from server import jobs as J


def test_parse_progress_lines():
    assert J.parse_progress("progress transcribe 742.3 2829.6") == ("transcribe", 742.3 / 2829.6)
    assert J.parse_progress("progress highlights 3.0 9.0") == ("highlights", 3 / 9)
    assert J.parse_progress("progress render 7.0 5.0") == ("render", 1.0)        # មិនលើស 1
    assert J.parse_progress("progress render 0.0 0.0") == ("render", 0.0)        # សរុប 0
    for other in ("✔ 1/6 audio  output\\x\\audio.wav", "progress", "progress transcribe abc 10", ""):
        assert J.parse_progress(other) is None


def test_report_progress_prints_only_without_a_terminal(monkeypatch, capsys):
    monkeypatch.setattr(M, "_last_report", {})
    monkeypatch.setattr(M, "console", SimpleNamespace(is_terminal=True))
    M.report_progress("transcribe", 10, 100)
    assert capsys.readouterr().out == ""                    # terminal មាន progress bar រួចហើយ

    monkeypatch.setattr(M, "console", SimpleNamespace(is_terminal=False))
    M.report_progress("transcribe", 10, 100)
    assert capsys.readouterr().out == "progress transcribe 10.0 100.0\n"


def test_report_progress_is_throttled_but_always_sends_the_end(monkeypatch, capsys):
    clock = {"now": 1000.0}
    monkeypatch.setattr(M, "_last_report", {})
    monkeypatch.setattr(M, "console", SimpleNamespace(is_terminal=False))
    monkeypatch.setattr(M.time, "monotonic", lambda: clock["now"])

    M.report_progress("transcribe", 10, 100)      # ដំបូង: សរសេរ
    clock["now"] += 1
    M.report_progress("transcribe", 11, 100)      # 1 s ក្រោយ: រំលង
    M.report_progress("highlights", 1, 9)         # ជំហានផ្សេង: សរសេរ
    clock["now"] += 1
    M.report_progress("transcribe", 100, 100)     # ចុងក្រោយ: សរសេរជានិច្ច
    clock["now"] += 5
    M.report_progress("transcribe", 50, 100)      # 3 s+ ក្រោយ: សរសេរ
    lines = capsys.readouterr().out.splitlines()
    assert lines == ["progress transcribe 10.0 100.0", "progress highlights 1.0 9.0",
                     "progress transcribe 100.0 100.0", "progress transcribe 50.0 100.0"]


def test_job_progress_carries_the_fractions(tmp_path):
    job = J.Job(id="x", video=tmp_path / "v.mp4", out_dir=tmp_path / "out", args=[])
    assert job.progress()["fraction"] == {}
    job.fractions["transcribe"] = 0.26
    assert job.progress()["fraction"] == {"transcribe": 0.26}
