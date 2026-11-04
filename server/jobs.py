"""ការគ្រប់គ្រង job — រត់ `make_clips.py` ជា subprocess រួចតាមដានវា.

**ហេតុអ្វី subprocess?** Orchestration ក្នុង `make_clips.py` ច្របល់ជាមួយការបង្ហាញ
(rich console) ហើយវែង ៣៣០ បន្ទាត់។ ការរត់វាជា process ដាច់ដោយឡែកផ្តល់៖
  - ការញែក (job គាំង មិនធ្វើឲ្យ server ដាច់)
  - ការបញ្ឈប់ងាយ (kill process)
  - គ្មានហានិភ័យនៃការកែ CLI ដែលដំណើរការល្អ

វឌ្ឍនភាពមកពី **file នៅលើ disk** ដែល pipeline សរសេររួចស្រាប់ មិនមែនពីការ parse
អត្ថបទទេ។
"""

import re
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from pipeline.highlights import cached_timeframe, parse_timeframe
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


LANGUAGE_IN_HEAD = re.compile(r'"language"\s*:\s*"([a-z]+)"')


def language_changes(out_dir: Path, language: str | None) -> bool:
    """`--language xx` លើ project ដែល transcript.json ជាភាសាផ្សេង -> transcribe ម្តងទៀត.

    អានតែ 4 KB ដំបូង ("language" នៅខាងលើ file) — transcript 70 នាទីធំ ២ MB.
    """
    if not language or language == "auto":
        return False
    try:
        with open(Path(out_dir) / "transcript.json", encoding="utf-8") as handle:
            found = LANGUAGE_IN_HEAD.search(handle.read(4096))
    except OSError:
        return False
    return bool(found) and found.group(1) != language


def timeframe_changes(out_dir: Path, timeframe: str | None) -> bool:
    """`--timeframe` ខុសពីចន្លោះដែល highlights.json រកពី -> AI ជ្រើសម្តងទៀត (មិនមែន cache)."""
    if not timeframe:
        return False
    try:
        return parse_timeframe(timeframe) != cached_timeframe(Path(out_dir) / "highlights.json")
    except ValueError:
        return False


# នាឡិកា file របស់ Windows អាចយឺតជាង time.time() បន្តិច: file ដែលសរសេរភ្លាមក្រោយ
# job ចាប់ផ្តើម អាចមាន mtime មុន `started` ពីរបីមីលីវិនាទី.
MTIME_SLACK = 1.0


def output_folder(options: dict) -> str:
    """folder ដែល make_clips សរសេរ clip: `clips`, `clips_1x1`, `full`, `full_4x5` ...

    ដូច make_clips.py ត្រង់ `clips_dir`: `--full` = វីដេអូទាំងមូល (AI Reframe), aspect
    ក្រៅពី 9:16 បន្ថែម suffix ដើម្បីកុំឲ្យជាន់គ្នា.
    """
    aspect = str(options.get("aspect") or "9:16")
    base = ("full_edit" if options.get("cuts") else "full") if options.get("full") else "clips"
    return base if aspect == "9:16" else f"{base}_{aspect.replace(':', 'x')}"


def steps_on_disk(out_dir: Path, since: float = 0.0, folder: str = "clips") -> set[str]:
    """ជំហានដែល marker file មាន ហើយសរសេរនៅ ឬក្រោយ `since` (epoch វិនាទី).

    ក្រៅពី STEPS វាក៏រាយការណ៍ `plan` ដែរ: `clip_XX_layout.json` ដែល reframe សរសេរពេលវិភាគ
    shot និងមុខរួច — screen AI Reframe បង្ហាញវាជាជំហានមួយ.
    """
    def new(path: Path) -> bool:
        return path.is_file() and path.stat().st_mtime >= since

    clips_dir = out_dir / folder
    ass = [p for p in clips_dir.glob("*.ass") if new(p)] if clips_dir.is_dir() else []
    found = {name for name, marker in STEPS if marker is not None and new(out_dir / marker)}
    if clips_dir.is_dir() and any(new(p) for p in clips_dir.glob("*_layout.json")):
        found.add("plan")
    if ass:
        found.add("captions")
        # render ចប់ពេល .ass នីមួយៗមាន .mp4 របស់វា (មិនមែនពេល clip ទី 1 ចេញទេ)
        if all(new(p.with_suffix(".mp4")) for p in ass):
            found.add("render")
    return found


# "progress transcribe 742.3 2829.6" ពី make_clips.report_progress -> វឌ្ឍនភាពពិតក្នុងជំហាន
PROGRESS_LINE = re.compile(r"^progress (\w+) ([0-9.]+) ([0-9.]+)$")


def parse_progress(line: str) -> tuple[str, float] | None:
    """បន្ទាត់ progress -> (ជំហាន, 0..1); បន្ទាត់ផ្សេង -> None."""
    found = PROGRESS_LINE.match(line)
    if not found:
        return None
    done, total = float(found.group(2)), float(found.group(3))
    return found.group(1), (min(1.0, done / total) if total > 0 else 0.0)


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
    folder: str = "clips"                # output_folder(): clips / full / clips_1x1 ...
    # `--full` មិនជ្រើស clip ទេ ដូច្នេះ highlights និង boundaries មិនសរសេរ file របស់វាឡើយ
    skipped: tuple[str, ...] = ()
    # ចំណែកដែលចប់ក្នុងជំហាន (0..1) ពីបន្ទាត់ "progress ..." — transcribe, highlights, render
    fractions: dict[str, float] = field(default_factory=dict)
    # Long to Short ជ្រើសទំហំក្រៅពី 9:16: render 9:16 សិន (Review, Subtitles ត្រូវការ `clips/`)
    # រួច render ទំហំនោះទៀត ពីជម្រើស AI ដដែល. command ទី ២ នេះ; None = គ្មាន
    also_args: list[str] | None = None

    def progress(self) -> dict:
        """ជំហានណាចប់ហើយ — អានពី file ដែលមានលើ disk.

        ជំហាន cached ចប់តាំងពីមុន. ជំហានផ្សេងទៀតចប់ តែពេល file របស់វាត្រូវបាន
        សរសេរ **ក្រោយ** job នេះចាប់ផ្តើម (mtime): `--redo` និង render សរសេរជាន់លើ
        file ចាស់ ដូច្នេះ "file មាន" តែឯងមិនបានន័យថា run នេះធ្វើវារួចទេ.
        """
        written = steps_on_disk(self.out_dir, since=self.started - MTIME_SLACK, folder=self.folder)
        if self.state == "running":
            # FFmpeg សរសេរ .mp4 នៅកន្លែងតែម្តង ដូច្នេះ file លេចមកតាំងពី render ទើបចាប់ផ្តើម
            # (វាស់: "render រួចរាល់" 8 s មុន job ចប់). render ជាជំហានចុងក្រោយ: វាចប់ពេល process ចប់.
            written.discard("render")
        done = [name for name, _ in STEPS if name in self.cached or name in written]
        fresh = [name for name in done if name not in self.cached]
        return {"done": done, "cached": list(self.cached), "fresh": fresh,
                "skipped": list(self.skipped), "planned": "plan" in written,
                "folder": self.folder, "total": len(STEPS),
                "fraction": dict(self.fractions),
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

            also_aspect = options.pop("also_aspect", None)
            args = [str(PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"), "-u",
                    str(PROJECT_ROOT / "make_clips.py"), str(video)]
            for key, value in options.items():
                # False = flag មិនបើក (typer bool flag គ្មានតម្លៃ "False")
                if value is None or value is False:
                    continue
                flag = "--" + key.replace("_", "-")
                args += [flag] if value is True else [flag, str(value)]

            job = Job(id=uuid.uuid4().hex[:8], video=video,
                      out_dir=PROJECT_ROOT / "output" / video.stem, args=args,
                      folder=output_folder(options),
                      also_args=args + ["--aspect", also_aspect] if also_aspect else None,
                      skipped=(("highlights", "boundaries", "captions", "render")
                               if options.get("transcribe_only")
                               else ("highlights", "boundaries") if options.get("full") else ()))
            redone = steps_redone(options)
            # ភាសាដែលសុំខុសពី transcript ចាស់ = make_clips transcribe ម្តងទៀត (មិនមែន cache)
            if language_changes(job.out_dir, options.get("language")):
                redone |= {"transcribe", *REDO_TOUCHES["highlights"]}
            if timeframe_changes(job.out_dir, options.get("timeframe")):
                redone |= set(REDO_TOUCHES["highlights"])
            on_disk = steps_on_disk(job.out_dir, folder=job.folder)
            job.cached = tuple(name for name, _ in STEPS
                               if name in on_disk and name not in redone and name not in job.skipped)
            self.jobs[job.id] = job

        db.save_job(job.id, video.stem, str(video), job.args, job.started)
        thread = threading.Thread(target=self._run, args=(job,), daemon=True)
        thread.start()
        return job

    def _run(self, job: Job) -> None:
        """រត់ process (មួយ ឬពីរ: `also_args`) រួចប្រមូល output មួយបន្ទាត់ម្តង."""
        try:
            code = self._run_one(job, job.args, render_share=(0.0, 0.5) if job.also_args else (0.0, 1.0))
            if code == 0 and job.also_args and job.state != "cancelled":
                code = self._run_one(job, job.also_args, render_share=(0.5, 0.5))
        except OSError as e:
            job.state, job.error, job.finished = "failed", str(e), time.time()
            self._record(job)
            return
        job.finished = time.time()
        if job.state != "cancelled":
            job.state = "done" if code == 0 else "failed"
            if code != 0:
                job.error = f"make_clips.py ចេញដោយ code {code}"
        self._record(job)

    def _run_one(self, job: Job, args: list[str], render_share: tuple[float, float]) -> int:
        """`render_share` = (ចាប់ពី, ចំណែក): render ពីរដង ជាបន្ទាត់ % តែមួយ ដែលមិនថយក្រោយ."""
        job.process = subprocess.Popen(
            args, cwd=str(PROJECT_ROOT), stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, encoding="utf-8",
            errors="replace", bufsize=1,
        )
        begin, share = render_share
        for line in job.process.stdout:
            text = line.rstrip()
            progress = parse_progress(text)
            if progress:
                # មិនដាក់ក្នុង log ទេ — ម្តងក្នុង 3 s លើ job 50 នាទី = បន្ទាត់រាប់ពាន់
                step, fraction = progress
                job.fractions[step] = begin + fraction * share if step == "render" else fraction
            elif text:
                job.log.append(text)
        return job.process.wait()

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
