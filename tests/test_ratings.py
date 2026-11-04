"""♡ / 👎 លើ clip: project.json រក្សាទាំងឈ្មោះ និងការវាយតម្លៃ, endpoint មានការពារ."""
import json

import pytest
from fastapi.testclient import TestClient

from server import app as APP
from server import db as DB
from server import manage


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(DB, "DB_PATH", tmp_path / "test.db")   # មិនប៉ះ output/clipforge.db ពិត
    DB.init_db()
    return TestClient(APP.app)


def test_rating_and_title_live_together(tmp_path):
    manage.write_title(tmp_path, "My show")
    manage.write_rating(tmp_path, 125.33, 141.04, "like")
    manage.write_rating(tmp_path, 10.0, 30.0, "dislike")
    assert manage.read_title(tmp_path) == "My show"
    assert manage.read_ratings(tmp_path) == {"125.3-141.0": "like", "10.0-30.0": "dislike"}
    manage.write_title(tmp_path, "Renamed")              # ប្តូរឈ្មោះ មិនលុបការវាយតម្លៃ
    assert manage.read_ratings(tmp_path)["125.3-141.0"] == "like"


def test_clearing_everything_removes_the_file(tmp_path):
    manage.write_rating(tmp_path, 1.0, 20.0, "like")
    manage.write_rating(tmp_path, 1.0, 20.0, None)
    assert manage.read_ratings(tmp_path) == {}
    assert not (tmp_path / manage.TITLE_FILE).exists()


def test_bad_rating_and_bad_file(tmp_path):
    with pytest.raises(ValueError):
        manage.write_rating(tmp_path, 1.0, 2.0, "love")
    (tmp_path / manage.TITLE_FILE).write_text(json.dumps({"ratings": {"1.0-2.0": "love", "3.0-4.0": "like"}}))
    assert manage.read_ratings(tmp_path) == {"3.0-4.0": "like"}   # តម្លៃមិនស្គាល់ត្រូវរំលង


def test_rating_endpoint(client, monkeypatch):
    from server import jobs as J

    folder = J.PROJECT_ROOT / "output" / "rating-test-project"
    folder.mkdir(parents=True, exist_ok=True)
    clip = {"index": 1, "start": 5.0, "end": 25.0, "files": {"mp4": "clip_01.mp4"}}
    monkeypatch.setattr(APP, "clips_of_project", lambda path: [dict(clip)] if path == folder else [])
    try:
        assert client.put("/projects/rating-test-project/clips/1/rating", json={"rating": "like"}).status_code == 200
        items = client.get("/projects/rating-test-project/clips").json()["clips"]
        assert items[0]["rating"] == "like"
        assert client.put("/projects/rating-test-project/clips/1/rating", json={"rating": "love"}).status_code == 400
        assert client.put("/projects/rating-test-project/clips/9/rating", json={"rating": "like"}).status_code == 404
        assert client.put("/projects/%2E%2E/clips/1/rating", json={"rating": "like"}).status_code == 400
        client.put("/projects/rating-test-project/clips/1/rating", json={"rating": None})
        assert client.get("/projects/rating-test-project/clips").json()["clips"][0]["rating"] is None
    finally:
        (folder / manage.TITLE_FILE).unlink(missing_ok=True)
        folder.rmdir()
