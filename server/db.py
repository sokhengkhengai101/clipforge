"""SQLite សម្រាប់ project / job / clip (Phase 1B).

**ហេតុអ្វីត្រូវការ database ខណៈ state នៅលើ disk រួចហើយ?** File (`clips.json`...)
ប្រាប់ថា *លទ្ធផលចុងក្រោយ* ជាអ្វី តែមិនប្រាប់ **ប្រវត្តិ** ទេ: job ណាខ្លះបានរត់,
ពេលណា, យូរប៉ុនណា, បរាជ័យដោយហេតុអ្វី។ UI ត្រូវការបញ្ជីនោះ ហើយវាត្រូវរស់ឆ្លង
ការបិទបើក server។

យើងប្រើ `sqlite3` ពី stdlib ហើយបើក connection **ថ្មីក្នុងមួយប្រតិបត្តិការ** —
connection របស់ sqlite3 មិនមែន thread-safe ហើយ job រត់ក្នុង thread ផ្សេង។
ការសរសេរមានតិច (ប៉ុន្មានដងក្នុងមួយ job) ដូច្នេះវាថោក។
"""

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "output" / "clipforge.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS project (
    id      INTEGER PRIMARY KEY,
    name    TEXT UNIQUE NOT NULL,          -- ឈ្មោះ folder ក្នុង output/
    video   TEXT NOT NULL,
    created REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS job (
    id         TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES project(id),
    args       TEXT NOT NULL,              -- JSON
    state      TEXT NOT NULL,
    step       TEXT DEFAULT '',
    error      TEXT DEFAULT '',
    started    REAL NOT NULL,
    finished   REAL
);

CREATE TABLE IF NOT EXISTS clip (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES project(id),
    idx        INTEGER NOT NULL,
    start      REAL NOT NULL,
    end        REAL NOT NULL,
    title      TEXT NOT NULL,
    type       TEXT DEFAULT '',
    total      REAL DEFAULT 0,
    letter     TEXT DEFAULT '',
    grades     TEXT,                       -- JSON ឬ NULL
    files      TEXT,                       -- JSON
    UNIQUE (project_id, idx)
);
"""


@contextmanager
def connect(path: Path | None = None):
    """បើក connection ថ្មី រួច commit និង **close** ពេលចេញ.

    `with sqlite3.connect(...)` commit តែ **មិន close** ទេ — handle នៅជាប់ ហើយ
    លើ Windows file លុបមិនបាន (យើងជួបវាពិតពេលសរសេរ test)។
    """
    path = Path(path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(path), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db(path: Path | None = None) -> None:
    with connect(path) as connection:
        connection.executescript(SCHEMA)


def project_id(name: str, video: str, path: Path | None = None) -> int:
    """រក project តាមឈ្មោះ ឬបង្កើតថ្មី."""
    with connect(path) as connection:
        row = connection.execute("SELECT id FROM project WHERE name = ?", (name,)).fetchone()
        if row is not None:
            return row["id"]
        cursor = connection.execute(
            "INSERT INTO project (name, video, created) VALUES (?, ?, ?)",
            (name, str(video), time.time()),
        )
        return cursor.lastrowid


def save_job(job_id: str, name: str, video: str, args: list[str],
             started: float, path: Path | None = None) -> None:
    pid = project_id(name, video, path)
    with connect(path) as connection:
        connection.execute(
            "INSERT OR REPLACE INTO job (id, project_id, args, state, started)"
            " VALUES (?, ?, ?, 'running', ?)",
            (job_id, pid, json.dumps(args), started),
        )


def update_job(job_id: str, *, state: str, step: str = "", error: str = "",
               finished: float | None = None, path: Path | None = None) -> None:
    with connect(path) as connection:
        connection.execute(
            "UPDATE job SET state = ?, step = ?, error = ?, finished = ? WHERE id = ?",
            (state, step, error, finished, job_id),
        )


def save_clips(name: str, video: str, clips: list[dict], path: Path | None = None) -> int:
    """សរសេរ clip របស់ project (ជំនួសរបស់ចាស់ទាំងស្រុង)."""
    pid = project_id(name, video, path)
    with connect(path) as connection:
        connection.execute("DELETE FROM clip WHERE project_id = ?", (pid,))
        connection.executemany(
            "INSERT INTO clip (project_id, idx, start, end, title, type, total,"
            " letter, grades, files) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [(pid, c["index"], c["start"], c["end"], c["title"], c.get("type", ""),
              c.get("total", 0), c.get("letter", ""),
              json.dumps(c.get("grades")) if c.get("grades") else None,
              json.dumps(c.get("files", {}))) for c in clips],
        )
    return len(clips)


def interrupt_stale_jobs(path: Path | None = None) -> int:
    """Job ដែល state នៅ `running` ពេល server ចាប់ផ្តើម = job ដែលស្លាប់.

    `JobRunner` ផ្ទុក job ក្នុង memory ដូច្នេះការបិទ server សម្លាប់ process កូន
    ហើយ row នៅជាប់ `running` ជារៀងរហូត — UI បង្ហាញវាជា "PROCESSING" មិនពិត.
    """
    with connect(path) as connection:
        cursor = connection.execute(
            "UPDATE job SET state = 'interrupted', error = ?, finished = ?"
            " WHERE state = 'running'",
            ("sidecar បានបិទពេល job កំពុងរត់", time.time()),
        )
        return cursor.rowcount


def list_projects(path: Path | None = None) -> list[dict]:
    """project ទាំងអស់ + ចំនួន clip + job ចុងក្រោយ."""
    with connect(path) as connection:
        rows = connection.execute("""
            SELECT p.id, p.name, p.video, p.created,
                   (SELECT COUNT(*) FROM clip c WHERE c.project_id = p.id) AS clips,
                   (SELECT COUNT(*) FROM job j WHERE j.project_id = p.id) AS jobs,
                   (SELECT state FROM job j WHERE j.project_id = p.id
                    ORDER BY started DESC LIMIT 1) AS last_state
            FROM project p ORDER BY p.created DESC
        """).fetchall()
    return [dict(row) for row in rows]


def list_jobs(limit: int = 50, path: Path | None = None) -> list[dict]:
    with connect(path) as connection:
        rows = connection.execute("""
            SELECT j.*, p.name AS project
            FROM job j JOIN project p ON p.id = j.project_id
            ORDER BY j.started DESC LIMIT ?
        """, (limit,)).fetchall()
    jobs = []
    for row in rows:
        item = dict(row)
        item["args"] = json.loads(item["args"])
        item["seconds"] = round((item["finished"] or time.time()) - item["started"], 1)
        jobs.append(item)
    return jobs


def project_clips(name: str, path: Path | None = None) -> list[dict]:
    with connect(path) as connection:
        rows = connection.execute("""
            SELECT c.* FROM clip c JOIN project p ON p.id = c.project_id
            WHERE p.name = ? ORDER BY c.idx
        """, (name,)).fetchall()
    clips = []
    for row in rows:
        item = dict(row)
        item["index"] = item.pop("idx")
        item["grades"] = json.loads(item["grades"]) if item["grades"] else None
        item["files"] = json.loads(item["files"]) if item["files"] else {}
        clips.append(item)
    return clips


def delete_project(name: str, path: Path | None = None) -> int:
    """លុប project មួយ និង job + clip របស់វាពី database. ត្រឡប់ចំនួន project ដែលបានលុប (0/1).

    ប្រវត្តិ job បាត់ជាមួយ — folder output ទៅ Recycle Bin ហើយអាចយកមកវិញ តែ database មិនអាចទេ.
    """
    with connect(path) as connection:
        row = connection.execute("SELECT id FROM project WHERE name = ?", (name,)).fetchone()
        if row is None:
            return 0
        connection.execute("DELETE FROM clip WHERE project_id = ?", (row["id"],))
        connection.execute("DELETE FROM job WHERE project_id = ?", (row["id"],))
        connection.execute("DELETE FROM project WHERE id = ?", (row["id"],))
    return 1
