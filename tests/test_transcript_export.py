"""⬇ ទាញយក transcript ក្នុង Edit Video: TXT / SRT ដូចវីដេអូដែល Export នឹងចេញ (ពាក្យដែលកាត់ត្រូវដក)."""
import pytest
from fastapi.testclient import TestClient

from pipeline.transcribe import Segment, Transcript, Word, save_transcript
from server import app as APP
from server import editor, export
from server import jobs as J

WORDS = [Word(" Coming", 0.0, 0.4), Word(" straight", 0.4, 0.9), Word(" here.", 0.9, 1.3),
         # pause 3 s -> កថាខណ្ឌថ្មីក្នុង TXT
         Word(" That's", 4.3, 4.6), Word(" the", 4.6, 4.8), Word(" difference.", 4.8, 5.5)]


def write_transcript(folder):
    folder.mkdir(parents=True, exist_ok=True)
    save_transcript(Transcript(language="en", language_probability=0.9, duration=8.0, model="m", device="cuda",
                               segments=[Segment(id=0, start=0.0, end=8.0, text="x", words=WORDS)]),
                    folder / "transcript.json")


def test_txt_keeps_punctuation_and_starts_a_paragraph_after_a_long_pause(tmp_path):
    write_transcript(tmp_path)
    assert editor.transcript_text(tmp_path, "txt") == "Coming straight here.\n\nThat's the difference.\n"
    # "straight" (0.4-0.9) ត្រូវកាត់ -> មិនមានក្នុង TXT
    assert editor.transcript_text(tmp_path, "txt", [[0.4, 0.9]]) == "Coming here.\n\nThat's the difference.\n"
    assert editor.transcript_text(tmp_path / "none", "txt") is None
    with pytest.raises(ValueError):
        editor.transcript_text(tmp_path, "docx")


def test_srt_times_follow_the_cut_video(tmp_path):
    write_transcript(tmp_path)
    plain = editor.transcript_text(tmp_path, "srt")
    assert plain.startswith("1\n00:00:00,000 --> ") and "That's the difference." in plain
    # កាត់ pause 1.3-4.3 (3 s): "That's" ចាប់ផ្តើមនៅ 1.3 s ជំនួស 4.3 s
    cut = editor.transcript_text(tmp_path, "srt", [[1.3, 4.3]])
    assert "00:00:04,300" not in cut and "00:00:01,300" in cut


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(APP, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(J.db, "save_job", lambda *a, **k: None)
    monkeypatch.setattr(APP, "runner", J.JobRunner())
    # folder Export ក្នុង tmp — កុំសរសេរក្នុង ~/Videos ពិត
    monkeypatch.setattr(export, "default_destination", lambda project: tmp_path / "Videos" / project)
    return TestClient(APP.app)


def test_export_writes_into_the_export_folder_and_never_overwrites(client, tmp_path):
    write_transcript(tmp_path / "output" / "talk")
    first = client.post("/projects/talk/transcript/export", json={"format": "txt"}).json()
    second = client.post("/projects/talk/transcript/export", json={"format": "txt"}).json()
    assert first["path"].endswith("talk - transcript.txt") and second["path"].endswith("talk - transcript (2).txt")
    assert open(first["path"], encoding="utf-8").read().startswith("Coming straight here.")
    srt = client.post("/projects/talk/transcript/export", json={"format": "srt", "cuts": [[0.4, 0.9]]}).json()
    assert "straight" not in open(srt["path"], encoding="utf-8").read()
    assert client.post("/projects/talk/transcript/export", json={"format": "pdf"}).status_code == 400
    assert client.post("/projects/talk/transcript/export", json={"cuts": [[1, 2, 3]]}).status_code == 400
    (tmp_path / "output" / "empty").mkdir()
    assert client.post("/projects/empty/transcript/export", json={}).status_code == 404


def test_txt_follows_an_inserted_hook(tmp_path):
    write_transcript(tmp_path)
    # hook = ផ្នែកចុង (That's the difference) ដាក់នៅដើម: ពាក្យរបស់វាចេញពីរដង
    text = editor.transcript_text(tmp_path, "txt", [], [{"start": 4.3, "end": 6.0, "at": 0.0}])
    assert text.startswith("That's the difference.") and text.count("That's the difference.") == 2


def test_transcript_follows_the_block_order(tmp_path):
    write_transcript(tmp_path)
    # ប្លុកទីពីរ ("That's the difference.") មកមុន
    text = editor.transcript_text(tmp_path, "txt", [], [], [[4.0, 10.0], [0.0, 4.0]])
    assert text.index("That's") < text.index("Coming")
