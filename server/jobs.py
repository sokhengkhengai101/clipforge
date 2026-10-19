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


# `--redo X` មិនលុប file ទេ — វាសរសេរជាន់លើ. ដូច្នេះដើម្បីដឹងថាជំហានណា
# **ពិតជាធ្វើថ្មី** យើងត្រូវដឹងថា redo ប៉ះជំហានណាខ្លះ (boundaries មកពី
# clips.json ដែល highlights សរសេរ; captions សង់ឡើងវិញពេល render).
REDO_TOUCHES = {
    "audio": ("audio",),
    "transcribe": ("transcribe",),
    "highlights": ("highlights", "boundaries"),
    "render": ("captions", "render"),
}


def steps_redone(options: dict) -> set[str]:
    """ជំហានដែល run នេះធ្វើថ្មី ទោះ marker file មានស្រាប់.

    captions និង render ធ្វើថ្មី **រាល់ដង**: make_clips សង់ .ass ឡើងវិញរាល់ការ run
    ហើយ .ass ដែលថ្មីជាង .mp4 ធ្វើឲ្យ render_clip render ម្តងទៀត (វាស់: 26 s
    លើ video 56 s ដោយគ្មាន --redo) ។ បើយើងរាប់វាជា cached, UI បង្ហាញ "៦ / ៦"
    ពេល job ទើបចាប់ផ្តើម.
    """
    names = {n.strip().lower() for n in str(options.get("redo") or "").split(",") if n.strip()}
    names.add("render")
    if options.get("force") or "all" in names:
        names = set(REDO_TOUCHES)
    touched = set()
    for name in names:
        touched |= set(REDO_TOUCHES.get(name, (name,)))
    return touched


# នាឡិកា file របស់ Windows អាចយឺតជាង time.time() បន្តិច: file ដែលសរសេរភ្លាមក្រោយ
# job ចាប់ផ្តើម អាចមាន mtime មុន `started` ពីរបីមីលីវិនាទី.
MTIME_SLACK = 1.0


def steps_on_disk(out_dir: Path, since: float = 0.0) -> set[str]:
    """ជំហានដែល marker file មាន ហើយសរសេរនៅ ឬក្រោយ `since` (epoch វិនាទី)."""
    def new(path: Path) -> bool:
        return path.is_file() and path.stat().st_mtime >= since

    clips_dir = out_dir / "clips"
    ass = [p for p in clips_dir.glob("*.ass") if new(p)] if clips_dir.is_dir() else []
    found = {name for name, marker in STEPS if marker is not None and new(out_dir / marker)}
    if ass:
        found.add("captions")
        # render ចប់ពេល .ass នីមួយៗមាន .mp4 របស់វា (មិនមែនពេល clip ទី 1 ចេញទេ)
        if all(new(p.with_suffix(".mp4")) for p in ass):
            found.add("render")
    return found


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
    # ជំហានដែលមាន file រួចមុន job នេះចាប់ផ្តើម (cache ពីការរត់មុន). បើគ្មានវា
    # UI បង្ហាញ 6/6 ភ្លាម ពេលរត់លើ video ដែលធ្លាប់រត់ ហើយវាមិនពិតទេ.
    cached: tuple[str, ...] = ()

    def progress(self) -> dict:
        """ជំហានណាចប់ហើយ — អានពី file ដែលមានលើ disk.

        ជំហាន cached ចប់តាំងពីមុន. ជំហានផ្សេងទៀតចប់ តែពេល file របស់វាត្រូវបាន
        សរសេរ **ក្រោយ** job នេះចាប់ផ្តើម (mtime): `--redo` និង render សរសេរជាន់លើ
        file ចាស់ ដូច្នេះ "file មាន" តែឯងមិនបានន័យថា run នេះធ្វើវារួចទេ.
        """
        written = steps_on_disk(self.out_dir, since=self.started - MTIME_SLACK)
        if self.state == "running":
            # FFmpeg សរសេរ .mp4 នៅកន្លែងតែម្តង ដូច្នេះ file លេចមកតាំងពី render ទើបចាប់ផ្តើម
            # (វាស់: "render រួចរាល់" 8 s មុន job ចប់). render ជាជំហានចុងក្រោយ: វាចប់ពេល process ចប់.
            written.discard("render")
        done = [name for name, _ in STEPS if name in self.cached or name in written]
        fresh = [name for name in done if name not in self.cached]
        return {"done": done, "cached": list(self.cached), "fresh": fresh,
                "total": len(STEPS),
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
            redone = steps_redone(options)
            on_disk = steps_on_disk(job.out_dir)
            job.cached = tuple(name for name, _ in STEPS
                               if name in on_disk and name not in redone)
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
