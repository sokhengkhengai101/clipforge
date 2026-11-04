"""Edit Video: ពាក្យ + pause, waveform, endpoints និង --transcribe-only."""
import os
import time
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

from pipeline.transcribe import Segment, Transcript, Word, save_transcript
from server import app as APP
from server import editor
from server import jobs as J


def write_transcript(folder):
    folder.mkdir(parents=True, exist_ok=True)
    words = [Word("On", 0.0, 0.3), Word(" John", 0.32, 0.6), Word(" are", 2.8, 3.1), Word(" trying", 3.56, 4.0)]
    transcript = Transcript(language="en", language_probability=0.9, duration=5.0, model="medium",
                            device="cuda", segments=[Segment(id=0, start=0.0, end=4.0, text="x", words=words)])
    save_transcript(transcript, folder / "transcript.json")


def write_wav(path, samples):
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(16000)
        writer.writeframes(np.asarray(samples, dtype=np.int16).tobytes())


def test_words_carry_real_pauses(tmp_path):
    assert editor.words_of(tmp_path) is None
    write_transcript(tmp_path)
    items = editor.words_of(tmp_path)["items"]
    assert [item.get("word") or item["pause"] for item in items] == ["On", "John", 2.2, "are", 0.46, "trying"]
    # 0.02 s រវាង "On" និង "John" តូចជាង PAUSE_MIN_SEC -> មិនមែន pause
    assert all("pause" not in item or item["pause"] > editor.PAUSE_MIN_SEC for item in items)


def test_waveform_peaks_and_cache(tmp_path):
    assert editor.waveform(tmp_path) is None
    loud = [0] * 8000 + [16000] * 8000                    # ស្ងាត់កន្លះវិនាទី រួចខ្លាំង
    write_wav(tmp_path / "audio.wav", loud)
    peaks = editor.waveform(tmp_path, points=4)
    assert peaks == [0.0, 0.0, 1.0, 1.0]
    assert (tmp_path / "waveform.json").is_file()
    assert editor.waveform(tmp_path, points=4) == peaks   # ពី cache
    # audio ថ្មីជាង cache -> គណនាម្តងទៀត
    time.sleep(0.01)
    write_wav(tmp_path / "audio.wav", [16000] * 8000 + [0] * 8000)
    os.utime(tmp_path / "waveform.json", (1, 1))
    assert editor.waveform(tmp_path, points=4) == [1.0, 1.0, 0.0, 0.0]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(APP, "PROJECT_ROOT", tmp_path)
    return TestClient(APP.app)


def test_endpoints(client, tmp_path):
    assert client.get("/projects/p/words").json()["ready"] is False   # 200, មិនមែន 404
    write_transcript(tmp_path / "output" / "p")
    answer = client.get("/projects/p/words").json()
    assert answer["ready"] is True and answer["duration"] == 5.0 and len(answer["items"]) == 6
    assert client.get("/projects/p/waveform").json()["peaks"] == []
    write_wav(tmp_path / "output" / "p" / "audio.wav", [100] * 16000)
    assert len(client.get("/projects/p/waveform").json()["peaks"]) == editor.WAVEFORM_POINTS
    assert client.get("/projects/..%5Cx/words").status_code == 400


def test_transcribe_only_skips_everything_after_transcribe(tmp_path):
    job = J.Job(id="x", video=tmp_path / "v.mp4", out_dir=tmp_path / "v", args=[],
                skipped=("highlights", "boundaries", "captions", "render"))
    assert job.progress()["skipped"] == ["highlights", "boundaries", "captions", "render"]


def test_transcribe_only_reaches_the_command_line(client, tmp_path, monkeypatch):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args, skipped=job.skipped))
    monkeypatch.setattr(J.db, "save_job", lambda *a, **k: None)
    assert client.post("/jobs", json={"video": str(video), "transcribe_only": True}).status_code == 200
    time.sleep(0.2)
    assert "--transcribe-only" in captured["args"]
    assert captured["skipped"] == ("highlights", "boundaries", "captions", "render")


def test_source_video_is_served_read_only_and_only_for_videos(client, tmp_path):
    video = tmp_path / "talk.mp4"
    video.write_bytes(b"0123456789")
    before = video.stat().st_mtime
    answer = client.get("/source", params={"path": str(video)}, headers={"Range": "bytes=0-3"})
    assert answer.status_code == 206 and answer.content == b"0123"
    assert video.stat().st_mtime == before and video.read_bytes() == b"0123456789"
    (tmp_path / "secret.txt").write_text("x")
    assert client.get("/source", params={"path": str(tmp_path / "secret.txt")}).status_code == 400
    assert client.get("/source", params={"path": str(tmp_path / "none.mp4")}).status_code == 404
