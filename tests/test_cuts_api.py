"""Edit Video ជំហាន ២ ផ្នែក ខ: cut list ក្នុង project.json, Speech cleanup, job --cuts, លទ្ធផល full_edit*."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from pipeline.transcribe import Segment, Transcript, Word, save_transcript
from server import app as APP
from server import clips as SC
from server import editor, manage
from server import jobs as J


def write_transcript(folder, words):
    folder.mkdir(parents=True, exist_ok=True)
    transcript = Transcript(language="en", language_probability=0.9, duration=20.0, model="m", device="cuda",
                            segments=[Segment(id=0, start=0.0, end=20.0, text="x", words=words)])
    save_transcript(transcript, folder / "transcript.json")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(APP, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(J.db, "save_job", lambda *a, **k: None)
    # runner ផ្ទាល់ខ្លួន: job ដែល _run ត្រូវបាន stub នៅ "running" — កុំឲ្យ test បន្ទាប់ទទួល 409
    monkeypatch.setattr(APP, "runner", J.JobRunner())
    return TestClient(APP.app)


def test_cuts_live_beside_title_and_ratings(tmp_path):
    manage.write_title(tmp_path, "My show")
    manage.write_rating(tmp_path, 1.0, 5.0, "like")
    saved = manage.write_cuts(tmp_path, [[5, 6], [1, 2], [3, 3]], "hard")    # [3,3] = ទទេ ត្រូវដក
    assert saved == {"cuts": [[1.0, 2.0], [5.0, 6.0]], "transition": "hard", "splits": [], "inserts": [], "order": []}
    assert manage.read_cuts(tmp_path) == saved
    assert manage.read_title(tmp_path) == "My show" and manage.read_ratings(tmp_path)
    manage.write_cuts(tmp_path, [], "punch")                                 # ទទេ = លុប
    assert manage.read_cuts(tmp_path) == {"cuts": [], "transition": "punch", "splits": [], "inserts": [], "order": []}
    with pytest.raises(ValueError):
        manage.write_cuts(tmp_path, [[1, 2]], "wipe")


def test_splits_are_saved_with_the_cuts_and_kept_by_a_job_that_only_writes_cuts(tmp_path):
    saved = manage.write_cuts(tmp_path, [[1, 2]], "punch", [20.0, 10.0, 10.0, 0])   # 0 / ដដែល = ដក
    assert saved["splits"] == [10.0, 20.0]
    manage.write_cuts(tmp_path, [[3, 4]], "hard")                # splits=None (job) = ទុក split
    assert manage.read_cuts(tmp_path) == {"cuts": [[3.0, 4.0]], "transition": "hard", "splits": [10.0, 20.0], "inserts": [], "order": []}
    manage.write_cuts(tmp_path, [], "punch")                     # គ្មាន cut តែមាន split = នៅរក្សាទុក
    assert manage.read_cuts(tmp_path)["splits"] == [10.0, 20.0]
    manage.write_cuts(tmp_path, [], "punch", [])                 # គ្មានអ្វីទាំងអស់ = លុប key edit
    assert manage.read_cuts(tmp_path) == {"cuts": [], "transition": "punch", "splits": [], "inserts": [], "order": []}
    with pytest.raises(ValueError):
        manage.write_cuts(tmp_path, [], "punch", [float(at) for at in range(1, manage.MAX_SPLITS + 2)])


def test_cleanup_suggests_long_pauses_with_breath_and_fillers(tmp_path):
    write_transcript(tmp_path, [
        Word(" So", 0.0, 0.3), Word(" um,", 0.4, 0.6), Word(" the", 2.0, 2.2),       # pause 1.4 s
        Word(" you", 2.3, 2.4), Word(" know", 2.45, 2.6), Word(" rhino", 2.7, 3.0),
        Word(" yeah", 3.1, 3.3),                                                     # yeah = មិនមែន filler cleanup
    ])
    data = editor.cleanup_suggestions(tmp_path, pause=1.0)
    reasons = [(s["reason"], s["text"]) for s in data["suggestions"]]
    assert reasons == [("filler", "um,"), ("pause", "1.40s"), ("filler", "you know")]
    pause = data["suggestions"][1]
    assert pause["start"] == round(0.6 + 0.12, 3) and pause["end"] == round(2.0 - 0.12, 3)
    assert data["pauses"] == 1 and data["fillers"] == 2
    assert len(editor.cleanup_suggestions(tmp_path, pause=1.0, fillers=False)["suggestions"]) == 1
    assert editor.cleanup_suggestions(tmp_path / "none") is None


def test_cuts_and_cleanup_endpoints(client, tmp_path):
    folder = tmp_path / "output" / "p"
    assert client.put("/projects/p/cuts", json={"cuts": [[1, 2]]}).status_code == 404   # គ្មាន project
    write_transcript(folder, [Word(" a", 0.0, 0.5), Word(" b", 3.0, 3.5)])
    assert client.put("/projects/p/cuts", json={"cuts": [[1, 2]], "transition": "punch"}).status_code == 200
    assert client.get("/projects/p/cuts").json()["cuts"] == [[1.0, 2.0]]
    assert client.put("/projects/p/cuts", json={"cuts": [[1, 2]], "splits": [4.5]}).json()["splits"] == [4.5]
    assert client.put("/projects/p/cuts", json={"cuts": [[1, 2]]}).json()["splits"] == [4.5]   # គ្មាន field = ទុក
    assert client.put("/projects/p/cuts", json={"cuts": [[1, 2, 3]]}).status_code == 400
    assert client.put("/projects/p/cuts", json={"cuts": [[1, 2]], "transition": "wipe"}).status_code == 400
    answer = client.get("/projects/p/cleanup", params={"pause": 1.0}).json()
    assert answer["ready"] and answer["pauses"] == 1
    assert client.get("/projects/p/cleanup", params={"pause": 0}).status_code == 400
    assert client.get("/projects/none/cleanup").json()["ready"] is False


def test_job_with_cuts_writes_the_cut_file_and_renders_into_full_edit(client, tmp_path, monkeypatch):
    video = tmp_path / "talk.mp4"
    video.write_bytes(b"x")
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args, folder=job.folder))
    answer = client.post("/jobs", json={"video": str(video), "full": True, "aspect": "16:9",
                                        "cuts": [[5, 6], [1, 2]], "transition": "hard"})
    assert answer.status_code == 200
    time.sleep(0.2)
    args = captured["args"]
    cut_file = args[args.index("--cuts") + 1]
    assert json.loads(open(cut_file, encoding="utf-8").read()) == {"cuts": [[1.0, 2.0], [5.0, 6.0]], "inserts": []}
    assert args[args.index("--transition") + 1] == "hard"
    assert captured["folder"] == "full_edit_16x9"
    assert manage.read_cuts(tmp_path / "output" / "talk")["cuts"] == [[1.0, 2.0], [5.0, 6.0]]
    # cuts ដោយគ្មាន --full ឬទទេ = 400
    assert client.post("/jobs", json={"video": str(video), "cuts": [[1, 2]]}).status_code == 400
    assert client.post("/jobs", json={"video": str(video), "full": True, "cuts": []}).status_code == 400


def test_full_edit_folders_are_results_marked_edited(tmp_path):
    for name in ("full", "full_edit", "full_edit_16x9", "full_edit_x"):
        folder = tmp_path / name
        folder.mkdir()
        (folder / "clip_01.mp4").write_bytes(b"x" * 10)
        (folder / "clip_01_layout.json").write_text(json.dumps({"shots": [{"start": 0, "end": 5, "kind": "center"}]}))
    found = {item["folder"]: (item["aspect"], item["edited"]) for item in SC.reframe_outputs(tmp_path)}
    assert found == {"full": ("9:16", False), "full_edit": ("9:16", True), "full_edit_16x9": ("16:9", True)}
    assert J.output_folder({"full": True, "cuts": "c.json"}) == "full_edit"
    assert J.output_folder({"full": True}) == "full"


# ---- inserts ("+ Extend a clip" -> Add, ផ្នែកដែលចម្លងទៅដាក់កន្លែងផ្សេង) ----

def test_inserts_are_kept_in_order_validated_and_survive_writes_without_them(tmp_path):
    hook = {"start": 40, "end": 44, "at": 0}
    tail = {"start": 1.23456, "end": 2, "at": 55}
    saved = manage.write_cuts(tmp_path, [], "punch", inserts=[tail, hook])     # គ្មាន cut តែមាន insert
    assert saved["inserts"] == [{"start": 1.235, "end": 2.0, "at": 55.0}, {"start": 40.0, "end": 44.0, "at": 0.0}]
    manage.write_cuts(tmp_path, [[3, 4]], "hard")                            # inserts=None (job/UI ចាស់) = ទុក
    assert manage.read_cuts(tmp_path)["inserts"] == saved["inserts"]
    for bad in ([{"start": 5, "end": 5.05, "at": 0}], [{"start": -1, "end": 2, "at": 0}],
                [{"start": 1, "end": 2}], [[1, 2, 3]], [hook] * (manage.MAX_INSERTS + 1)):
        with pytest.raises(ValueError):
            manage.write_cuts(tmp_path, [], "punch", inserts=bad)
    manage.write_cuts(tmp_path, [], "punch", [], [])                         # គ្មានអ្វីទាំងអស់ = លុប key edit
    assert manage.read_cuts(tmp_path)["inserts"] == []
    assert not (tmp_path / "project.json").exists()                          # គ្មាន title / look ទៀត = file ត្រូវលុប


def test_put_cuts_takes_inserts_and_keeps_them_when_absent(client, tmp_path):
    write_transcript(tmp_path / "output" / "p", [Word(" a", 0.0, 0.5)])
    hook = {"start": 10, "end": 12, "at": 0}
    assert client.put("/projects/p/cuts", json={"cuts": [], "inserts": [hook]}).json()["inserts"] == [
        {"start": 10.0, "end": 12.0, "at": 0.0}]
    assert client.put("/projects/p/cuts", json={"cuts": [[1, 2]]}).json()["inserts"] == [
        {"start": 10.0, "end": 12.0, "at": 0.0}]                             # គ្មាន field = ទុក
    assert client.get("/projects/p/cuts").json()["inserts"][0]["at"] == 0.0
    assert client.put("/projects/p/cuts", json={"inserts": [{"start": 1, "end": 1}]}).status_code == 400


def test_job_with_only_an_insert_writes_it_into_the_cut_file(client, tmp_path, monkeypatch):
    video = tmp_path / "talk.mp4"
    video.write_bytes(b"x")
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args, folder=job.folder))
    hook = {"start": 40, "end": 44, "at": 0}
    answer = client.post("/jobs", json={"video": str(video), "full": True, "aspect": "4:5", "inserts": [hook]})
    assert answer.status_code == 200
    time.sleep(0.2)
    args = captured["args"]
    assert "--inserts" not in args                                           # inserts មិនមែន flag
    cut_file = json.loads(open(args[args.index("--cuts") + 1], encoding="utf-8").read())
    assert cut_file == {"cuts": [], "inserts": [{"start": 40.0, "end": 44.0, "at": 0.0}]}
    assert captured["folder"] == "full_edit_4x5"
    # pipeline អានវាបាន
    from pipeline.cuts import read_inserts
    assert read_inserts(args[args.index("--cuts") + 1]) == [(40.0, 44.0, 0.0)]
    bad = client.post("/jobs", json={"video": str(video), "full": True, "inserts": [{"start": 1, "end": 1, "at": 0}]})
    assert bad.status_code == 400
    assert client.post("/jobs", json={"video": str(video), "inserts": [hook]}).status_code == 400   # គ្មាន full


# ---- order: ប្លុកដែលអូសប្តូរលំដាប់លើ timeline ----

def test_order_is_saved_validated_and_a_time_order_means_no_change(tmp_path):
    moved = [[10, 30], [0, 10]]
    assert manage.write_cuts(tmp_path, [], "punch", order=moved)["order"] == [[10.0, 30.0], [0.0, 10.0]]
    manage.write_cuts(tmp_path, [[3, 4]], "hard")                            # order=None (job/UI ចាស់) = ទុក
    assert manage.read_cuts(tmp_path)["order"] == [[10.0, 30.0], [0.0, 10.0]]
    assert manage.write_cuts(tmp_path, [], "punch", order=[[0, 10], [10, 30]])["order"] == []
    for bad in ([[1]], [[5, 5]], [[-1, 3]], "x"):
        with pytest.raises(ValueError):
            manage.write_cuts(tmp_path, [], "punch", order=bad)


def test_put_cuts_takes_order_and_keeps_it_when_absent(client, tmp_path):
    (tmp_path / "output" / "p").mkdir(parents=True)
    assert client.put("/projects/p/cuts", json={"cuts": [], "order": [[10, 30], [0, 10]]}).json()["order"] == [
        [10.0, 30.0], [0.0, 10.0]]
    assert client.put("/projects/p/cuts", json={"cuts": [[1, 2]]}).json()["order"] == [[10.0, 30.0], [0.0, 10.0]]
    assert client.put("/projects/p/cuts", json={"order": [[1, 1]]}).status_code == 400


def test_job_with_only_an_order_reaches_the_pipeline(client, tmp_path, monkeypatch):
    video = tmp_path / "talk.mp4"
    video.write_bytes(b"x")
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args, folder=job.folder))
    # លំដាប់ពេលធម្មតា ហើយគ្មានការកែផ្សេង = គ្មានអ្វីត្រូវ render
    assert client.post("/jobs", json={"video": str(video), "full": True, "order": [[0, 10], [10, 30]]}).status_code == 400
    assert client.post("/jobs", json={"video": str(video), "order": [[10, 30], [0, 10]]}).status_code == 400   # គ្មាន full
    answer = client.post("/jobs", json={"video": str(video), "full": True, "aspect": "4:5", "order": [[10, 30], [0, 10]]})
    assert answer.status_code == 200
    time.sleep(0.2)
    args = captured["args"]
    assert "--order" not in args                                             # order មិនមែន flag
    assert captured["folder"] == "full_edit_4x5"
    from pipeline.cuts import read_order
    assert read_order(args[args.index("--cuts") + 1]) == [(10.0, 30.0), (0.0, 10.0)]


# ---- timeline: បញ្ជី clip តែមួយ ជំនួស cuts / splits / order / inserts ----

def test_old_projects_convert_when_read_and_the_file_stays_untouched(tmp_path):
    manage.write_cuts(tmp_path, [[0, 1]], "hard", splits=[20], order=[[10, 30], [1, 10]])
    before = (tmp_path / "project.json").read_bytes()
    assert manage.read_timeline(tmp_path, 30.0) == {"clips": [[10.0, 20.0], [20.0, 30.0], [1.0, 10.0]], "transition": "hard"}
    assert (tmp_path / "project.json").read_bytes() == before
    assert manage.read_timeline(tmp_path)["clips"] == []                     # គ្មាន duration = បម្លែងមិនបាន


def test_a_converted_project_plays_like_the_old_one(tmp_path):
    from pipeline import cuts as C
    manage.write_cuts(tmp_path, [[5, 8]], "punch", splits=[20], inserts=[{"start": 40, "end": 44, "at": 0}])
    parts = C.sequence(C.keep_ranges(60.0, [(5.0, 8.0)]), [(40.0, 44.0, 0.0)], 60.0)
    assert C.clip_parts([tuple(p) for p in manage.read_timeline(tmp_path, 60.0)["clips"]], 60.0) == parts


def test_write_timeline_replaces_the_old_keys_and_empty_means_the_whole_video(tmp_path):
    manage.write_title(tmp_path, "My talk")
    manage.write_cuts(tmp_path, [[1, 2]], "hard", splits=[10])
    assert manage.write_timeline(tmp_path, [[10, 20], [0, 5]], "hard")["clips"] == [[10.0, 20.0], [0.0, 5.0]]
    saved = json.loads((tmp_path / "project.json").read_text(encoding="utf-8"))
    assert saved["edit"] == {"clips": [[10.0, 20.0], [0.0, 5.0]], "transition": "hard"} and saved["title"] == "My talk"
    assert manage.read_timeline(tmp_path)["clips"] == [[10.0, 20.0], [0.0, 5.0]]
    # បន្ទាប់ពីនេះ ការសរសេរទម្រង់ចាស់ (app ដែលមិនទាន់ restart) ជំនួសវា មិនមែនបញ្ចូលគ្នាទេ
    manage.write_cuts(tmp_path, [[3, 4]], "punch")
    assert "clips" not in json.loads((tmp_path / "project.json").read_text(encoding="utf-8"))["edit"]
    manage.write_timeline(tmp_path, [], "punch")
    assert manage.read_timeline(tmp_path) == {"clips": [], "transition": "punch"}
    for bad in ([[1]], [[5, 5]], [[-1, 3]], "x"):
        with pytest.raises(ValueError):
            manage.write_timeline(tmp_path, bad)


def test_timeline_api_reads_writes_and_refuses(client, tmp_path):
    folder = tmp_path / "output" / "p"
    write_transcript(folder, [Word(" a", 1.0, 2.0)])
    assert client.get("/projects/p/timeline").json()["clips"] == []
    assert client.put("/projects/p/timeline", json={"clips": [[5, 9], [0, 5]], "transition": "hard"}).json()["clips"] == [[5.0, 9.0], [0.0, 5.0]]
    assert client.get("/projects/p/timeline").json() == {"name": "p", "clips": [[5.0, 9.0], [0.0, 5.0]], "transition": "hard"}
    assert client.put("/projects/p/timeline", json={"clips": [[1, 1]]}).status_code == 400
    assert client.put("/projects/p/timeline", json={"clips": [[0, 2]], "transition": "wipe"}).status_code == 400
    assert client.put("/projects/none/timeline", json={"clips": []}).status_code == 404


def test_job_with_a_timeline_reaches_the_pipeline(client, tmp_path, monkeypatch):
    video = tmp_path / "talk.mp4"
    video.write_bytes(b"x")
    captured = {}
    monkeypatch.setattr(J.JobRunner, "_run", lambda self, job: captured.update(args=job.args, folder=job.folder))
    assert client.post("/jobs", json={"video": str(video), "timeline": [[1, 2]]}).status_code == 400             # គ្មាន full
    assert client.post("/jobs", json={"video": str(video), "full": True, "timeline": []}).status_code == 400
    assert client.post("/jobs", json={"video": str(video), "full": True, "timeline": [[2, 2]]}).status_code == 400
    answer = client.post("/jobs", json={"video": str(video), "full": True, "aspect": "4:5", "timeline": [[10, 30], [0, 10]]})
    assert answer.status_code == 200
    time.sleep(0.2)
    args = captured["args"]
    assert "--timeline" not in args and captured["folder"] == "full_edit_4x5"
    from pipeline.cuts import read_clips
    assert read_clips(args[args.index("--cuts") + 1]) == [(10.0, 30.0), (0.0, 10.0)]
