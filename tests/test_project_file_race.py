"""project.json: PUT /look, /motion, /cuts ក្នុងពេលតែមួយ មិនត្រូវលុបការកែរបស់គ្នាទេ.

ឃើញពិត (2026-10-27): autosave របស់ Edit Video ផ្ញើ PUT ៣ ក្នុងពេលតែមួយ; គ្មាន lock ហើយ write_text
ធ្វើឲ្យ file ទទេមួយភ្លែត -> thread មួយអាន {} ហើយលុប file -> split របស់អ្នកអភិវឌ្ឍបាត់.
"""
import contextlib
import threading

from server import manage

ROUNDS = 150


def hammer(folder):
    barrier = threading.Barrier(4)
    errors = []

    def run(write):
        barrier.wait()
        try:
            for i in range(ROUNDS):
                write(i)
        except Exception as error:      # noqa: BLE001 — ការបរាជ័យណាមួយ = test បរាជ័យ
            errors.append(error)

    writers = [
        lambda i: manage.write_look(folder, {"blur": 10 + i % 5}),
        lambda i: manage.write_motion(folder, {"zoom": "in" if i % 2 else "out"}),
        lambda i: manage.write_cuts(folder, [[1, 2]], "punch", [272.31]),
        lambda i: manage.write_title(folder, f"Show {i % 3}"),
    ]
    threads = [threading.Thread(target=run, args=(w,)) for w in writers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errors


def test_concurrent_writes_keep_every_key(tmp_path):
    errors = hammer(tmp_path)
    assert not errors
    assert manage.read_cuts(tmp_path)["splits"] == [272.31]
    assert manage.read_look(tmp_path)["blur"] in range(10, 15)
    assert manage.read_motion(tmp_path)["zoom"] in ("in", "out")
    assert manage.read_title(tmp_path).startswith("Show")
    assert not list(tmp_path.glob("*.tmp"))


def test_the_race_is_real_without_the_lock(tmp_path, monkeypatch):
    """ការពិនិត្យ test ខ្លួនឯង: lock ទទេ + write_text ផ្ទាល់ (កូដចាស់) -> ទិន្នន័យបាត់."""
    monkeypatch.setattr(manage, "_LOCK", contextlib.nullcontext())

    def old_write(folder, data):
        path = folder / manage.TITLE_FILE
        data = {key: value for key, value in data.items() if value}
        if not data:
            path.unlink(missing_ok=True)
            return
        path.write_text(__import__("json").dumps(data), encoding="utf-8")

    monkeypatch.setattr(manage, "_write", old_write)
    lost = 0
    for attempt in range(5):
        folder = tmp_path / str(attempt)
        folder.mkdir()
        hammer(folder)
        cuts = manage.read_cuts(folder)
        lost += (cuts["splits"] != [272.31]) or manage.read_title(folder) is None or \
            manage.read_look(folder)["blur"] == 33 or manage.read_motion(folder)["zoom"] == "off"
    assert lost > 0, "the hammer never hit the race; the first test would prove nothing"
