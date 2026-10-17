"""ការគ្រប់គ្រង job — រត់ `make_clips.py` ជា subprocess រួចតាមដានវា.

**ហេតុអ្វី subprocess?** Orchestration ក្នុង `make_clips.py` ច្របល់ជាមួយការបង្ហាញ
(rich console) ហើយវែង ៣៣០ បន្ទាត់។ ការរត់វាជា process ដាច់ដោយឡែកផ្តល់៖
  - ការញែក (job គាំង មិនធ្វើឲ្យ server ដាច់)
  - ការបញ្ឈប់ងាយ (kill process)
  - គ្មានហានិភ័យនៃការកែ CLI ដែលដំណើរការល្អ

វឌ្ឍនភាពមកពី **file នៅលើ disk** ដែល pipeline សរសេររួចស្រាប់ មិនមែនពីការ parse
អត្ថបទទេ។
"""

import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import config
from server import db

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ជំហាន និង file ដែលបញ្ជាក់ថាវាចប់ (តាមលំដាប់)
STEPS = (
    ("audio", "audio.wav"),
    ("transcribe", "transcript.json"),
    ("highlights", "highlights.json"),
    ("boundaries", "clips.json"),
    ("captions", None),        # .ass នៅក្នុង folder clip
    ("render", None),          # .mp4 នៅក្នុង folder clip
)


@dataclass
class Job:
    """job មួយ = ការរត់ pipeline មួយលើ video មួយ."""

    id: str
    video: Path
    out_dir: Path
    args: list[str]
    state: str = "running"          # running | done | failed | cancelled
    started: float = field(default_factory=time.time)
    finished: float | None = None
    error: str = ""
    log: list[str] = field(default_factory=list)
    process: subprocess.Popen | None = None

    def progress(self) -> dict:
        """ជំហានណាចប់ហើយ — អានពី file ដែលមានលើ disk."""
        done = []
        clips_dir = self.out_dir / "clips"
        for name, marker in STEPS:
            if marker is not None:
                finished = (self.out_dir / marker).is_file()
            elif name == "captions":
                finished = any(clips_dir.glob("*.ass")) if clips_dir.is_dir() else False
            else:
                finished = any(clips_dir.glob("*.mp4")) if clips_dir.is_dir() else False
            if finished:
                done.append(name)
        return {"done": done, "total": len(STEPS),
                "step": done[-1] if done else "starting"}

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "video": str(self.video),
            "state": self.state,
            "error": self.error,
            "seconds": round((self.finished or time.time()) - self.started, 1),
            "progress": self.progress(),
            "log_lines": len(self.log),
        }


class JobRunner:
    """ផ្ទុក job ក្នុង memory រួចរត់ម្តងមួយ (GPU មានតែមួយ)."""

    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def active(self) -> Job | None:
        return next((j for j in self.jobs.values() if j.state == "running"), None)

    def start(self, video: Path, **options) -> Job:
        """ចាប់ផ្តើម job។ បោះ `RuntimeError` បើមាន job កំពុងរត់."""
        video = Path(video)
        if not video.is_file():
            raise FileNotFoundError(f"រកមិនឃើញ video: {video}")
        with self._lock:
            if self.active() is not None:
                raise RuntimeError("មាន job កំពុងរត់រួចហើយ (GPU មានតែមួយ)")

            args = [str(PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"), "-u",
                    str(PROJECT_ROOT / "make_clips.py"), str(video)]
            for key, value in options.items():
                if value is None:
                    continue
                flag = "--" + key.replace("_", "-")
                args += [flag] if value is True else [flag, str(value)]

            job = Job(id=uuid.uuid4().hex[:8], video=video,
                      out_dir=PROJECT_ROOT / "output" / video.stem, args=args)
            self.jobs[job.id] = job

        db.save_job(job.id, video.stem, str(video), job.args, job.started)
        thread = threading.Thread(target=self._run, args=(job,), daemon=True)
        thread.start()
        return job

    def _run(self, job: Job) -> None:
        """រត់ process រួចប្រមូល output មួយបន្ទាត់ម្តង."""
        try:
            job.process = subprocess.Popen(
                job.args, cwd=str(PROJECT_ROOT), stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                errors="replace", bufsize=1,
            )
        except OSError as e:
            job.state, job.error, job.finished = "failed", str(e), time.time()
            self._record(job)
            return

        for line in job.process.stdout:
            text = line.rstrip()
            if text:
                job.log.append(text)
        code = job.process.wait()
        job.finished = time.time()
        if job.state != "cancelled":
            job.state = "done" if code == 0 else "failed"
            if code != 0:
                job.error = f"make_clips.py ចេញដោយ code {code}"
        self._record(job)

    def _record(self, job: Job) -> None:
        """សរសេរលទ្ធផលចូល database — រួមទាំង clip បើ pipeline សរសេរវារួច."""
        db.update_job(job.id, state=job.state, step=job.progress()["step"],
                      error=job.error, finished=job.finished)
        if job.state != "done":
            return
        try:
            from server.clips import clips_of_project
            found = clips_of_project(job.out_dir)
        except Exception:                     # clips.json ខូច/គ្មាន -> រំលង
            return
        if found:
            db.save_clips(job.video.stem, str(job.video), found)

    def cancel(self, job_id: str) -> Job:
        job = self.jobs[job_id]
        if job.state == "running" and job.process is not None:
            job.state = "cancelled"
            job.process.terminate()
        return job
