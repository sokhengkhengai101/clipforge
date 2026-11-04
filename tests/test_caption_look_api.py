"""Captions › Font / Effects ក្នុង sidecar: /fonts, /cues វីដេអូទាំងមូល, flag របស់ job."""
import time

import pytest
from fastapi.testclient import TestClient

from pipeline.transcribe import Segment, Transcript, Word, save_transcript
from server import app as APP
from server import fonts
from server import jobs as J


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(APP, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(J.db, "save_job", lambda *a, **k: None)
    monkeypatch.setattr(APP, "runner", J.JobRunner())
    monkeypatch.setattr(fonts, "installed_fonts", lambda: [
        {"family": "Montserrat", "weight": "Black", "face": "Montserrat Black", "em_scale": 0.64,
         "italic_face": True}])
    folder = tmp_path / "output" / "talk"
    folder.mkdir(parents=True)
    words = [Word(" Between", 0.0, 0.4), Word(" the", 0.4, 0.6), Word(" incredible", 0.6, 1.2),
             Word(" rhinos.", 1.2, 1.8)]
    save_transcript(Transcript(language="en", language_probability=0.9, duration=2.0, model="m", device="cpu",
                               segments=[Segment(id=0, start=0.0, end=2.0, text="x", words=words)]),
                    folder / "transcript.json")
    video = tmp_path / "talk.mp4"
    video.write_bytes(b"x")
    return TestClient(APP.app), str(video)


def test_em_scale_reads_the_real_font():
    import sys
    if sys.platform != "win32":
        pytest.skip("Windows fonts")
    from pipeline.captions import find_font_file
    assert fonts.em_scale(find_font_file("Montserrat ExtraBold")) == pytest.approx(0.640, abs=0.001)


def test_fonts_endpoint(client):
    http, _ = client
    answer = http.get("/fonts").json()
    assert answer["fonts"][0]["face"] == "Montserrat Black" and answer["default"]


def test_whole_video_cues_follow_lines_and_mark_keywords(client):
    http, _ = client
    three = http.get("/projects/talk/cues", params={"words": 5, "lines": 3}).json()
    one = http.get("/projects/talk/cues", params={"words": 5, "lines": 1}).json()
    assert three["ready"] and len(one["cues"]) >= len(three["cues"])
    assert all(len(cue["lines"]) == 1 for cue in one["cues"])
    marked = [w["text"] for cue in three["cues"] for line in cue["lines"] for w in line if w["keyword"]]
    assert "incredible" in marked
    assert http.get("/projects/talk/cues", params={"lines": 4}).status_code == 400
    assert http.get("/projects/none/cues").json()["ready"] is False


def test_job_gets_the_look_flags_and_skips_false(client, monkeypatch):
    http, video = client
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args))
    body = {"video": video, "full": True, "caption_font": "Montserrat Black", "caption_italic": True,
            "caption_underline": False, "caption_shadow": "2,2,5,#000000", "caption_keywords": True,
            "caption_keyword_colors": "#04F827,#FFFD03", "caption_lines": 1, "caption_text_color": "#FFFFFF"}
    assert http.post("/jobs", json=body).status_code == 200
    time.sleep(0.2)
    args = captured["args"]
    assert "--caption-italic" in args and "--caption-keywords" in args
    assert "--caption-underline" not in args                              # False = មិនផ្ញើ
    assert args[args.index("--caption-shadow") + 1] == "2,2,5,#000000"
    assert args[args.index("--caption-lines") + 1] == "1"


@pytest.mark.parametrize("bad", [{"caption_font": "Comic Sans MS"}, {"caption_text_color": "red"},
                                 {"caption_shadow": "1,1"}, {"caption_lines": 5}])
def test_bad_look_is_400_before_the_job(client, bad):
    http, video = client
    assert http.post("/jobs", json={"video": video, "full": True, **bad}).status_code == 400
