"""Sidecar HTTP សម្រាប់ UI (Phase 1).

រត់៖  python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
សាក៖  http://127.0.0.1:8765/docs

វាចង link តែ **127.0.0.1** ប៉ុណ្ណោះ — app ក្នុងម៉ាស៊ីន មិនមែន server សាធារណៈ
(គោលការណ៍ "local-first, no uploads" របស់ project)។
"""

import asyncio
from contextlib import asynccontextmanager
import json
import shutil
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from pydantic import BaseModel, Field

import config
from server import db, editor, env, export, fonts, manage, media, quiet
from server.clips import (REFRAME_FOLDER, REFRAME_KINDS, clips_of_project, preview_cues, project_facts,
                          reframe_outputs, transcript_preview, whole_cues)
from server.jobs import PROJECT_ROOT, JobRunner

config.enable_utf8_output()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """ពេល server ចាប់ផ្តើម: លាក់ traceback reset គ្មានគ្រោះថ្នាក់ពេល WebView2 បិទ video (server/quiet.py)."""
    quiet.install(asyncio.get_running_loop())
    yield


app = FastAPI(title="ClipForge sidecar", version="0.2.0", lifespan=lifespan)
runner = JobRunner()
db.init_db()
db.interrupt_stale_jobs()

# App desktop (Tauri) ផ្ទុកទំព័រពី `tauri.localhost` មិនមែនពី Vite ទេ ដូច្នេះ
# browser ចាត់ទុកការហៅ 127.0.0.1:8765 ជា "cross-origin" ហើយ block វា។
# យើងអនុញ្ញាតតែ origin ក្នុងម៉ាស៊ីន — គ្មាន website ខាងក្រៅទេ.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://tauri.localhost", "https://tauri.localhost",   # Windows/Linux
        "tauri://localhost",                                   # macOS
        "http://localhost:5173", "http://127.0.0.1:5173",      # dev ក្នុង browser
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class JobRequest(BaseModel):
    """អ្វីដែល UI ផ្ញើមកដើម្បីចាប់ផ្តើម — ឈ្មោះដូច flag របស់ CLI."""

    video: str
    max_clips: int | None = None
    layout: str | None = None
    aspect: str | None = None
    caption_words: int | None = None
    caption_color: str | None = None
    caption_size: int | None = None     # % (70-120) — screen Subtitles
    caption_outline: int | None = None  # px (0-8)
    caption_case: str | None = None     # upper / original
    caption_position: str | None = None # auto / top / middle / bottom
    no_captions: bool | None = None
    clean_only: bool | None = None      # preview គ្មាន caption (screen Subtitles)
    full: bool | None = None
    redo: str | None = None
    model: str | None = None            # Ollama model សម្រាប់ highlights
    whisper_model: str | None = None    # small / medium / large-v3
    language: str | None = None         # auto / en / fr ... (Auto Subtitles)
    transcribe_only: bool | None = None # Edit Video: audio + transcribe ប៉ុណ្ណោះ
    cuts: list[list[float]] | None = None  # Edit Video: ចន្លោះដែលត្រូវកាត់ [[start, end], ...]
    transition: str | None = None       # punch / hard (នៅកន្លែងកាត់)
    inserts: list[dict] | None = Field(default=None, max_length=200)  # "+ Extend a clip": [{start, end, at}]
    order: list[list[float]] | None = Field(default=None, max_length=2001)  # ប្លុកតាមលំដាប់ដែលអូសលើ timeline
    look: dict | None = None            # Edit Video: Background / Tracker (manage.clean_look)
    motion: dict | None = None          # Edit Video: Motion (manage.clean_motion)
    caption_animation: str | None = None  # ឈ្មោះណាមួយក្នុង config.CAPTION_ANIMATIONS (21)
    # ផ្ទាំង Captions › Font / Effects (config.apply_caption_look)
    caption_font: str | None = None
    caption_text_color: str | None = None
    caption_outline_color: str | None = None
    caption_italic: bool | None = None
    caption_underline: bool | None = None
    caption_shadow: str | None = None       # "x,y,blur,#RRGGBB"
    caption_keywords: bool | None = None
    caption_keyword_colors: str | None = None  # "#RRGGBB,#RRGGBB"
    caption_lines: int | None = None


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    """បើក `/` ក្នុង browser -> ទៅ `/docs` ដែលមានបញ្ជី route ទាំងអស់ សាកបាន."""
    return RedirectResponse("/docs")


# detect_device() សួរ CUDA ម្តង ហើយចម្លើយមិនប្តូរក្នុងអំឡុងរត់មួយ —
# ដូច្នេះរក្សាទុក កុំឲ្យរាល់ការហៅ /health ទៅសួរ driver ម្តងទៀត.
DEVICE, WHISPER_MODEL, COMPUTE_TYPE = config.detect_device()


@app.get("/health")
def health() -> dict:
    """UI ហៅវាដើម្បីដឹងថា sidecar រស់ឬនៅ."""
    active = runner.active()
    return {
        "ok": True,
        "version": app.version,
        # `shutil.which` រក binary ក្នុង PATH — UI ត្រូវដឹងមុនពេល start job
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "device": DEVICE,
        "whisper_model": WHISPER_MODEL,
        "llm_model": config.OLLAMA_MODEL,
        "busy": active.id if active else None,
        # screen Import បង្ហាញ "Folder រក្សាទុក" — path ពិត មិនមែន Documents\... ក្នុង design
        "output_dir": str(PROJECT_ROOT / "output"),
    }


@app.get("/env")
def environment() -> dict:
    """Hardware និង model ដែលមានពិត — screen "01 · AI models" គូរពីវា.

    វាសួរ nvidia-smi និង Ollama រាល់ដង (មិន cache) ព្រោះចម្លើយផ្លាស់ប្តូរបាន:
    អ្នកអាច `ollama pull` ពេលទំព័រនៅបើក ហើយ Refresh គួរឃើញវាភ្លាម.
    """
    return env.report(DEVICE, WHISPER_MODEL, COMPUTE_TYPE, PROJECT_ROOT / "output")


@app.get("/videos")
def videos() -> list[dict]:
    """video ក្នុង `samples/` — ងាយសម្រាប់ជ្រើសក្នុង UI ដំបូង."""
    folder = PROJECT_ROOT / "samples"
    found = []
    for path in sorted(folder.glob("*.mp4")) if folder.is_dir() else []:
        found.append({"name": path.name, "path": str(path),
                      "mb": round(path.stat().st_size / 1e6, 1)})
    return found


@app.post("/jobs")
def start_job(request: JobRequest) -> dict:
    options = request.model_dump(exclude={"video"}, exclude_none=True)
    inserts = options.pop("inserts", None)   # មិនមែន flag: ចូល cuts.json ជាមួយ cuts
    order = options.pop("order", None)       # ដូចគ្នា
    if "cuts" in options or inserts or order:
        # cut list + inserts + order ជា JSON file សម្រាប់ `--cuts` (ក្នុង output/<name>/edit/) + រក្សាទុកសម្រាប់ editor
        folder = PROJECT_ROOT / "output" / Path(request.video).stem
        cuts = options.get("cuts") or []
        try:
            moved = manage.clean_order(order or [])   # លំដាប់ពេលធម្មតា = [] = មិនមែនការកែ
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        if not options.get("full") or not (cuts or inserts or moved):
            raise HTTPException(status_code=400, detail="cuts / inserts / order ត្រូវការ full និងយ៉ាងតិច ១ ការកែ")
        cut_file = folder / "edit" / "cuts.json"
        cut_file.parent.mkdir(parents=True, exist_ok=True)      # មុន project.json (folder អាចមិនទាន់មាន)
        try:
            # inserts / order មិនផ្ញើ (UI ចាស់) = render គ្មានវា, តែ project.json ទុកអ្វីដែលមាន
            saved = manage.write_cuts(folder, cuts, options.get("transition") or "punch", inserts=inserts, order=order)
        except (ValueError, TypeError) as error:
            raise HTTPException(status_code=400, detail=str(error))
        used = saved["inserts"] if inserts is not None else []
        body = {"cuts": saved["cuts"], "inserts": used}
        if moved:
            body["order"] = moved
        cut_file.write_text(json.dumps(body), encoding="utf-8")
        options["cuts"] = str(cut_file)   # output_folder() មើល `cuts` -> full_edit*
    if "motion" in options:
        # Motion -> --motion-* / --caption-animation; រក្សាទុកក្នុង project.json ដូច look
        folder = PROJECT_ROOT / "output" / Path(request.video).stem
        folder.mkdir(parents=True, exist_ok=True)
        try:
            motion = manage.write_motion(folder, options.pop("motion"))
        except (ValueError, TypeError) as error:
            raise HTTPException(status_code=400, detail=str(error))
        options.update(manage.motion_options(motion))
    if options.get("caption_animation") and options["caption_animation"] not in config.CAPTION_ANIMATIONS:
        raise HTTPException(status_code=400, detail="caption_animation មិនស្គាល់")
    if options.get("caption_font") and options["caption_font"] not in {f["face"] for f in fonts.installed_fonts()}:
        raise HTTPException(status_code=400, detail="font នេះមិនមានលើកុំព្យូទ័រនេះទេ (GET /fonts)")
    _check_caption_look(options)
    if "look" in options:
        # Background / Tracker -> flag `--fit-*`, `--no-tracking`, `--no-track-ranges <file>`;
        # រក្សាទុកក្នុង project.json (រូបចម្លងចូល output/<name>/) ដូច cuts
        folder = PROJECT_ROOT / "output" / Path(request.video).stem
        folder.mkdir(parents=True, exist_ok=True)
        try:
            look = manage.write_look(folder, options.pop("look"))
        except (ValueError, TypeError, FileNotFoundError) as error:
            raise HTTPException(status_code=400, detail=str(error))
        options.update(manage.look_options(look))
        if look["tracking"] and look["no_track"]:
            ranges = folder / "no_track.json"
            ranges.write_text(json.dumps(look["no_track"]), encoding="utf-8")
            options["no_track_ranges"] = str(ranges)
        if look["subjects"]:
            # ផ្លូវដោយដៃ ឈ្នះ "បិទ tracking ទាំងអស់" — អ្នកបានជ្រើសវាដោយផ្ទាល់
            tracks = folder / "subject_tracks.json"
            tracks.write_text(json.dumps(look["subjects"]), encoding="utf-8")
            options["subject_tracks"] = str(tracks)
    try:
        job = runner.start(Path(request.video), **options)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return job.as_dict()


@app.get("/jobs")
def list_jobs(history: bool = True) -> list[dict]:
    """job ក្នុង session នេះ + ប្រវត្តិពី database (រស់ឆ្លងការបិទបើក server)."""
    live = {job.id: job.as_dict() for job in runner.jobs.values()}
    if not history:
        return list(live.values())
    merged = list(live.values())
    for row in db.list_jobs():
        if row["id"] not in live:
            merged.append({"id": row["id"], "video": row["project"],
                           "state": row["state"], "error": row["error"] or "",
                           "seconds": row["seconds"],
                           "progress": {"done": [], "total": 6,
                                        "step": row["step"] or ""},
                           "log_lines": 0, "from_history": True})
    return merged


@app.get("/probe")
def probe(path: str) -> dict:
    """ទំហំ និងរយៈពេលរបស់វីដេអូដែលជ្រើសលើ Import ("1080p · 35:25") — ffprobe, មិនប៉ះ file.

    ទទួលតែ file វីដេអូ (`media.VIDEO_SUFFIXES`); 404 បើ file មិនមាន ឬ ffprobe មិនឆ្លើយ.
    """
    video = Path(path)
    if video.suffix.lower() not in media.VIDEO_SUFFIXES:
        raise HTTPException(status_code=400, detail="មិនមែន file វីដេអូ")
    info = media.probe_video(video)
    if info is None:
        raise HTTPException(status_code=404, detail="អាន file វីដេអូមិនបាន")
    return info


@app.get("/probe/frame")
def probe_frame(path: str, at: float = 0.0) -> Response:
    """frame ពិតពីវីដេអូដែលជ្រើស (JPEG) សម្រាប់ preview របស់ AI Reframe — វីដេអូតែប៉ុណ្ណោះ."""
    video = Path(path)
    if video.suffix.lower() not in media.VIDEO_SUFFIXES:
        raise HTTPException(status_code=400, detail="មិនមែន file វីដេអូ")
    image = media.source_frame(video, at)
    if image is None:
        raise HTTPException(status_code=404, detail="ទាញ frame មិនបាន")
    return Response(content=image, media_type="image/jpeg")


@app.get("/projects")
def list_projects() -> list[dict]:
    """project ទាំងអស់ — database **បូក** folder ក្នុង `output/`.

    Database ដឹងពី job (ពេល, ស្ថានភាព) តែវាទើបមានពេល Phase 1B; project ដែល
    សង់ដោយ CLI មុននោះមានតែ folder. UI ត្រូវឃើញទាំងពីរ.
    """
    out_root = PROJECT_ROOT / "output"

    def rendered(folder: Path) -> int:
        # រាប់តែ clip ដែល **render រួច**: `clips.json` ជាបញ្ជីដែល LLM ជ្រើស ហើយ
        # វាអាចមានមុន render ទាល់តែសោះ (`sample_5s` មាន clips.json តែគ្មាន
        # folder `clips/`). បើរាប់ទាំងនោះ ការ៉េបង្ហាញ READY រួច Review បើកទទេ.
        return sum(1 for clip in clips_of_project(folder) if clip.get("files", {}).get("mp4"))

    projects = db.list_projects()
    # ចំនួន clip មកពី disk សម្រាប់ project ក្នុង database ដែរ: database សរសេរ clip តែពេល
    # job តាម sidecar ចប់ `done` — job ដែលបោះបង់ រួច CLI render ក្រោយ ទុកលេខ 0 ចាស់
    # (ឃើញពិត: The-Future-Mark-Zuckerberg បង្ហាញ 0 ទោះមាន .mp4 ៥).
    for item in projects:
        item["clips"] = rendered(out_root / item["name"])
    known = {item["name"] for item in projects}
    for folder in sorted(out_root.iterdir()) if out_root.is_dir() else []:
        # folder ពី CLI: បង្ហាញបើវាមាន clips ឬ reframe (reframe មិនសរសេរ clips.json ទេ)
        if not folder.is_dir() or folder.name in known:
            continue
        if not clips_of_project(folder) and not any(folder.glob("full*/clip_01.mp4")):
            continue
        projects.append({
            "id": -len(projects) - 1,          # លេខអវិជ្ជមាន = មិនមានក្នុង database
            "name": folder.name,
            "video": "",                        # មិនដឹង path ដើមទេ
            "created": folder.stat().st_mtime,
            "clips": rendered(folder),
            "jobs": 0,
            "last_state": None,
        })
    # រយៈពេល ទំហំ និង reframe សម្រាប់កាតលើទំព័រ Projects របស់ខ្ញុំ
    for item in projects:
        folder = out_root / item["name"]
        item.update(project_facts(folder) if folder.is_dir()
                    else {"seconds": None, "bytes": 0, "reframes": 0})
        # path ពេញរបស់ folder សម្រាប់ "បើក folder" — UI មិនផ្គុំ path ដោយខ្លួនឯងទេ
        item["folder"] = str(folder) if folder.is_dir() else ""
        # ឈ្មោះបង្ហាញ (ម៉ឺនុយ "ប្តូរឈ្មោះ") — `name` នៅតែជាឈ្មោះ folder សម្រាប់ URL ទាំងអស់
        item["title"] = (manage.read_title(folder) if folder.is_dir() else None) or item["name"]
    return projects


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = runner.jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="រកមិនឃើញ job")
    return {**job.as_dict(), "log": job.log[-40:]}


@app.delete("/jobs/{job_id}")
def cancel_job(job_id: str) -> dict:
    if job_id not in runner.jobs:
        raise HTTPException(status_code=404, detail="រកមិនឃើញ job")
    return runner.cancel(job_id).as_dict()


def _project_folder(name: str) -> Path:
    """`output/<name>` — ឈ្មោះមិនអាចមាន `..`, `/` ឬ backslash ទេ ដូច្នេះ URL អានក្រៅ output/ មិនបាន."""
    if name in ("", ".", "..") or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="ឈ្មោះ project មិនត្រឹមត្រូវ")
    return PROJECT_ROOT / "output" / name


def _clips_of(name: str) -> list[dict]:
    items = clips_of_project(PROJECT_ROOT / "output" / name)
    return items or db.project_clips(name)


def _check_caption_look(options: dict) -> None:
    """ពណ៌ / shadow / បន្ទាត់ដែលខុស = 400 ឥឡូវ មិនមែន job បរាជ័យក្រោយមក."""
    import copy

    probe = {name: copy.copy(getattr(config, name)) for name in (
        "CAPTION_FONT", "CAPTION_TEXT_COLOR", "CAPTION_OUTLINE_COLOR", "CAPTION_ITALIC", "CAPTION_UNDERLINE",
        "CAPTION_SHADOW_XY_BLUR", "CAPTION_SHADOW_COLOR", "CAPTION_KEYWORD_HIGHLIGHT",
        "CAPTION_KEYWORD_COLORS", "CAPTION_MAX_LINES")}
    try:
        config.apply_caption_look(None, options.get("caption_text_color"), options.get("caption_outline_color"),
                                  False, False, options.get("caption_shadow"), False,
                                  options.get("caption_keyword_colors"), options.get("caption_lines"))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    finally:
        for name, value in probe.items():
            setattr(config, name, value)


@app.get("/fonts")
def caption_fonts() -> dict:
    """Font សម្រាប់ផ្ទាំង Captions › Font — តែអ្វីដែលដំឡើងរួច, ជាមួយ em_scale សម្រាប់ទំហំ preview."""
    return {"fonts": fonts.installed_fonts(), "default": config.CAPTION_FONT}


@app.get("/projects/{name}/cues")
def project_cues(name: str, words: int = 5, lines: int = 3) -> dict:
    """Cue នៃវីដេអូទាំងមូល (Edit Video preview): បន្ទាត់ និងពាក្យសំខាន់ដូច render."""
    try:
        data = whole_cues(_project_folder(name), words, lines)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"name": name, "ready": data is not None, **(data or {"cues": []})}


@app.get("/projects/{name}/clips/{index}/cues")
def clip_cues(name: str, index: int, words: int = 5, size: int = 100,
              position: str = "auto", lines: int = 3) -> dict:
    """Cue សម្រាប់ preview ផ្ទាល់លើ screen Subtitles — គណនាដោយ captions.py ពិត, គ្មាន render."""
    folder = _project_folder(name)
    try:
        cues = preview_cues(folder, index, words, size, position, lines)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if cues is None:
        raise HTTPException(status_code=404, detail=f"គ្មាន clip {index} ឬ transcript")
    return cues


@app.get("/projects/{name}/clips/{index}/file")
def clip_file(name: str, index: int, kind: str = "mp4") -> FileResponse:
    """បម្រើ `.mp4` (ឬ subtitle) របស់ clip មួយ ឲ្យ `<video>` ក្នុង browser ចាក់បាន.

    `FileResponse` គាំទ្រ HTTP Range ដូច្នេះការរំកិល (seek) ដំណើរការ.
    """
    found = media.clip_file(_clips_of(name), index, kind)
    if found is None:
        raise HTTPException(status_code=404, detail=f"គ្មាន {kind} សម្រាប់ clip {index}")
    path, media_type = found
    return FileResponse(path, media_type=media_type, filename=path.name)


@app.get("/projects/{name}/clips/{index}/thumb")
def clip_thumb(name: str, index: int) -> FileResponse:
    """រូបតូចមួយពី clip — FFmpeg ដកវាលើកដំបូង រួចរក្សាទុកជា .jpg."""
    found = media.clip_file(_clips_of(name), index, "mp4")
    if found is None:
        raise HTTPException(status_code=404, detail=f"គ្មាន clip {index}")
    image = media.thumbnail(found[0])
    if image is None:
        raise HTTPException(status_code=404, detail="ដក frame មិនបាន")
    return FileResponse(image, media_type="image/jpeg")


@app.get("/projects/{name}/clips")
def project_clips(name: str) -> dict:
    """clip ដែល pipeline សរសេររួច — អានពី `clips.json` និង file ជុំវិញវា.

    Project ដែលធ្លាប់រត់ តែមិនទាន់មាន clip ត្រឡប់បញ្ជីទទេ (200), មិនមែន 404 —
    UI សួរវាមុនពេល render ចប់ ហើយ 404 រាល់ដងគ្រាន់តែបំពេញ console ដោយ error.
    """
    items = clips_of_project(PROJECT_ROOT / "output" / name)
    if not items:
        # គ្មាន file -> សាកមើលក្នុង database (folder អាចត្រូវលុប)
        items = db.project_clips(name)
    # project ដែល job ទើបចាប់ផ្តើម មាន row ក្នុង database មុន folder (audio បង្កើតវា) — ជា project ដែរ
    known = (PROJECT_ROOT / "output" / name).is_dir() or any(
        item["name"] == name for item in db.list_projects())
    if not items and not known:
        raise HTTPException(status_code=404, detail="រកមិនឃើញ project នេះ")
    # ♡ / 👎 ពី project.json (ស្គាល់ clip តាមចន្លោះពេល)
    ratings = manage.read_ratings(PROJECT_ROOT / "output" / name)
    for item in items:
        item["rating"] = ratings.get(manage.rating_key(item["start"], item["end"]))
    return {"name": name, "clips": items}


class RatingRequest(BaseModel):
    rating: str | None = None       # "like" | "dislike" | None (លុប)


@app.put("/projects/{name}/clips/{index}/rating")
def rate_clip(name: str, index: int, request: RatingRequest) -> dict:
    """♡ / 👎 លើ clip មួយ — Filter លើ Review ប្រើវា. សរសេរតែ project.json (មិនប៉ះ clip)."""
    folder = _project_folder(name)
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="រកមិនឃើញ project")
    clip = next((item for item in clips_of_project(folder) if item["index"] == index), None)
    if clip is None:
        raise HTTPException(status_code=404, detail="រកមិនឃើញ clip")
    try:
        manage.write_rating(folder, clip["start"], clip["end"], request.rating)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    return {"index": index, "rating": request.rating}


class ExportRequest(BaseModel):
    """អ្វីដែល UI ផ្ញើពេលចុច Export."""

    destination: str | None = None      # None = កន្លែងលំនាំដើម
    clips: list[int] | None = None      # None = clip ទាំងអស់
    kinds: list[str] = ["mp4"]          # mp4 និង/ឬ srt, vtt, ass


class RevealRequest(BaseModel):
    path: str


def _export_kinds(kinds: list[str]) -> tuple[str, ...]:
    """ទទួលតែ kind ក្នុង `media.EXPORTABLE` — UI មិនអាចសុំចម្លង `.exe` (ឬ preview) បានទេ."""
    chosen = tuple(kind for kind in kinds if kind in media.EXPORTABLE)
    if not chosen:
        raise HTTPException(status_code=400, detail=f"kind មិនស្គាល់: {kinds}")
    return chosen


def _export_plan(name: str, kinds: tuple[str, ...],
                 indexes: list[int] | None) -> list[dict]:
    clips = _clips_of(name)
    if not clips and not (PROJECT_ROOT / "output" / name).is_dir():
        raise HTTPException(status_code=404, detail="រកមិនឃើញ project នេះ")
    return export.plan(clips, indexes, kinds)


@app.get("/projects/{name}/transcript")
def project_transcript(name: str) -> dict:
    """Transcript ផ្ទាល់សម្រាប់ screen Processing (start/end/text + clip ដែល AI ពិចារណា).

    ឆ្លើយ 200 ជានិច្ច ទោះ file មិនទាន់មាន: project ថ្មីមិនទាន់មាន folder ពេល job ចាប់ផ្តើម
    ហើយ 404 រាល់ពេលសួរគ្រាន់តែបំពេញ console. ឈ្មោះមិនអាចមាន `..` ឬ `/` ទេ
    ដូច្នេះ URL មិនអាចអាន file ក្រៅ output/ បាន.
    """
    return {"name": name, **transcript_preview(_project_folder(name))}


VIDEO_TYPES = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
               ".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo"}


@app.get("/source")
def source_video(path: str) -> FileResponse:
    """វីដេអូ**ដើម** សម្រាប់ preview ក្នុង Edit Video — **អានតែប៉ុណ្ណោះ** (FileResponse មិនសរសេរអ្វីទេ).

    ទទួលតែ file វីដេអូ ដូច /probe; Range request ដំណើរការ ដូច្នេះ player រំកិលបាន.
    sidecar ស្តាប់តែ 127.0.0.1 ហើយ CORS អនុញ្ញាតតែ app — ទំព័រផ្សេងសួរមិនបាន.
    """
    video = Path(path)
    if video.suffix.lower() not in media.VIDEO_SUFFIXES:
        raise HTTPException(status_code=400, detail="មិនមែន file វីដេអូ")
    if not video.is_file():
        raise HTTPException(status_code=404, detail="រកវីដេអូមិនឃើញ")
    return FileResponse(video, media_type=VIDEO_TYPES.get(video.suffix.lower(), "video/mp4"))


@app.get("/projects/{name}/words")
def project_words(name: str) -> dict:
    """ពាក្យ + pause សម្រាប់ Edit Video. `ready: false` = មិនទាន់ transcribe (UI ចាប់ផ្តើម
    `--transcribe-only`) — 200 ជានិច្ច ដូច /transcript ដើម្បីកុំបំពេញ console ដោយ 404."""
    data = editor.words_of(_project_folder(name))
    return {"name": name, "ready": data is not None, **(data or {"items": []})}


class TranscriptExportRequest(BaseModel):
    format: str = "txt"  # txt | srt
    cuts: list[list[float]] = Field(default_factory=list, max_length=20000)  # ការលុបរបស់ editor (ឥឡូវ)
    inserts: list[dict] = Field(default_factory=list, max_length=200)  # ផ្នែកដែលបន្ថែម (ដូច Export)
    order: list[list[float]] = Field(default_factory=list, max_length=2001)  # លំដាប់ប្លុក (ដូច Export)


@app.post("/projects/{name}/transcript/export")
def export_transcript(name: str, request: TranscriptExportRequest) -> dict:
    """⬇ ក្នុង Edit Video: transcript (ដូចវីដេអូដែល Export នឹងចេញ) ជា .txt / .srt ក្នុង folder Export
    (`~/Videos/ClipForge/<project>/`) ដោយមិនសរសេរពីលើ file ចាស់ ("... (2).txt").

    folder មិនមកពី request ទេ ដូច្នេះ request មិនអាចឲ្យ sidecar សរសេរកន្លែងផ្សេងបាន."""
    folder = _project_folder(name)
    if any(len(pair) != 2 for pair in request.cuts):
        raise HTTPException(status_code=400, detail="ចន្លោះនីមួយៗត្រូវជា [start, end]")
    try:
        text = editor.transcript_text(folder, request.format, request.cuts, manage.clean_inserts(request.inserts),
                                      manage.clean_order(request.order))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    if text is None:
        raise HTTPException(status_code=404, detail="មិនទាន់មាន transcript")
    destination = export.default_destination(name)
    destination.mkdir(parents=True, exist_ok=True)
    title = export.safe_part(manage.read_title(folder) or name) or "transcript"
    path = export.free_path(destination, f"{title} - transcript.{request.format}")
    path.write_text(text, encoding="utf-8")
    return {"name": name, "path": str(path), "bytes": path.stat().st_size, "format": request.format}


class CutsRequest(BaseModel):
    cuts: list[list[float]] = Field(default_factory=list, max_length=20000)
    transition: str = "punch"
    splits: list[float] | None = None  # ចំណុច Split លើ timeline; None = ទុកដែលមានស្រាប់
    inserts: list[dict] | None = Field(default=None, max_length=200)  # ផ្នែកដែលបន្ថែម; None = ទុកដែលមាន
    order: list[list[float]] | None = Field(default=None, max_length=2001)  # លំដាប់ប្លុក; None = ទុកដែលមាន


@app.get("/projects/{name}/cuts")
def project_cuts(name: str) -> dict:
    """cut list ដែល editor រក្សាទុក — បើក editor ម្តងទៀត ការលុបនៅដដែល."""
    return {"name": name, **manage.read_cuts(_project_folder(name))}


@app.put("/projects/{name}/cuts")
def save_project_cuts(name: str, request: CutsRequest) -> dict:
    """រក្សាទុក cut list ក្នុង project.json (មិនកាត់វីដេអូទេ — Export ទើបកាត់)."""
    folder = _project_folder(name)
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="រកមិនឃើញ project")
    if any(len(pair) != 2 for pair in request.cuts):
        raise HTTPException(status_code=400, detail="ចន្លោះនីមួយៗត្រូវជា [start, end]")
    try:
        return {"name": name, **manage.write_cuts(folder, request.cuts, request.transition, request.splits,
                                                  request.inserts, request.order)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


class PickRequest(BaseModel):
    video: str
    time: float
    x: float          # 0..1 នៃទទឹង frame
    y: float          # 0..1 នៃកម្ពស់


class TrackRequest(PickRequest):
    mode: str = "subject"   # subject (ប្រអប់ YOLOX) ឬ area (ការ៉េជុំវិញចំណុច)


def _picked_video(name: str, request: PickRequest) -> tuple[Path, tuple[int, int], float, float]:
    """វីដេអូដើមរបស់ project (ឈ្មោះ = stem) + ទំហំ + ចំណុចចុចជា pixel."""
    from pipeline.render import probe_dimensions

    video = Path(request.video)
    if video.suffix.lower() not in media.VIDEO_SUFFIXES or not video.is_file():
        raise HTTPException(status_code=400, detail="មិនមែន file វីដេអូ")
    if video.stem != name:
        raise HTTPException(status_code=400, detail="វីដេអូមិនមែនរបស់ project នេះ")
    if not (0 <= request.x <= 1 and 0 <= request.y <= 1):
        raise HTTPException(status_code=400, detail="x, y ត្រូវនៅចន្លោះ 0-1")
    size = probe_dimensions(video)
    return video, size, request.x * size[0], request.y * size[1]


@app.post("/projects/{name}/pick")
def pick_subject_box(name: str, request: PickRequest) -> dict:
    """ចុចលើ frame: ប្រអប់ subject (YOLOX) ដែលគ្របចំណុច និងប្រអប់ area — dialog បង្ហាញទាំងពីរ."""
    from pipeline.reframe import grab_frame
    from pipeline.subject_track import area_box, pick_subject

    video, size, x, y = _picked_video(name, request)
    box, label = pick_subject(grab_frame(video, request.time, size), size, x, y)
    return {"size": list(size), "subject": list(box) if label != "area" else None,
            "label": label, "area": list(area_box(size, x, y))}


@app.post("/projects/{name}/track")
def track_project_subject(name: str, request: TrackRequest) -> dict:
    """Apply ក្នុង dialog: តាមប្រធានបទពេញ scene នៅពេលនោះ (CPU, ~4 s ក្នុង scene 12 s) ហើយ
    រក្សាទុកផ្លូវក្នុង look របស់ project. មិនរត់ពេល job កំពុងរត់ (409) — CPU ដដែលនឹង render."""
    import time as clock

    from pipeline.subject_track import track_subject, tracker_name

    if request.mode not in ("subject", "area"):
        raise HTTPException(status_code=400, detail="mode ត្រូវជា subject ឬ area")
    if runner.active() is not None:
        raise HTTPException(status_code=409, detail="មាន job កំពុងរត់ — រង់ចាំវាចប់")
    folder = _project_folder(name)
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="រកមិនឃើញ project")
    video, size, x, y = _picked_video(name, request)
    scene = next((s for s in editor.scenes(video, folder) if s[0] <= request.time < s[1]), None)
    if scene is None:
        raise HTTPException(status_code=400, detail="ពេលនោះនៅក្រៅវីដេអូ")
    began = clock.time()
    try:
        track = track_subject(video, scene[0], scene[1], request.time, x, y, size, request.mode)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    look = manage.subject_scene(manage.read_look(folder), scene)
    look["subjects"] = [*look["subjects"], track.as_dict()]
    saved = manage.write_look(folder, look)
    return {"name": name, "track": track.as_dict(), "scene": scene, "size": list(size),
            "tracker": tracker_name(), "seconds": round(clock.time() - began, 1), "look": saved}


@app.delete("/projects/{name}/track")
def reset_project_subject(name: str, start: float, end: float) -> dict:
    """Reset ក្នុង dialog: ដកផ្លូវរបស់ scene នេះចេញ (AI សម្រេច crop ម្តងទៀត)."""
    folder = _project_folder(name)
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="រកមិនឃើញ project")
    return {"name": name, **manage.write_look(folder, manage.subject_scene(manage.read_look(folder), [start, end]))}


class MotionRequest(BaseModel):
    zoom: str = "off"
    zoom_amount: int = 8
    keywords: int = 0
    shake: str = "off"
    animation: str = "pop"


@app.get("/projects/{name}/motion")
def project_motion(name: str) -> dict:
    """ផ្ទាំង Motion ដែល Edit Video រក្សាទុក (លំនាំដើម បើមិនធ្លាប់ប្តូរ)."""
    return {"name": name, **manage.read_motion(_project_folder(name))}


@app.get("/projects/{name}/motion/cues")
def project_motion_cues(name: str) -> dict:
    """ពេលពាក្យសំខាន់ និងសំឡេងខ្លាំង ក្នុងវីដេអូទាំងមូល — preview របស់ផ្ទាំង Motion ប្រើកូដដដែលនឹង render."""
    from pipeline import motion
    from pipeline.transcribe import load_transcript

    folder = _project_folder(name)
    transcript = load_transcript(folder / "transcript.json")
    if transcript is None:
        return {"name": name, "ready": False, "keywords": [], "loud": []}
    words = [w for s in transcript.segments for w in s.words]
    return {"name": name, "ready": True, "keywords": motion.keyword_moments(words, 0.0),
            "loud": [list(pair) for pair in motion.loud_ranges(folder / "audio.wav", 0.0, transcript.duration)]}


@app.put("/projects/{name}/motion")
def save_project_motion(name: str, request: MotionRequest) -> dict:
    folder = _project_folder(name)
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="រកមិនឃើញ project")
    try:
        return {"name": name, **manage.write_motion(folder, request.model_dump())}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


class LookRequest(BaseModel):
    background: str = "blur"
    blur: int = 33
    color: str = "#000000"
    image: str | None = None
    radius: int = 0
    spacing: int = 0
    tracking: bool = True
    no_track: list[list[float]] = Field(default_factory=list, max_length=5000)
    subjects: list[dict] = Field(default_factory=list, max_length=200)
    transform: dict | None = None  # Transform video {x, y, scale, crop}; None = AI layout


@app.get("/projects/{name}/look")
def project_look(name: str) -> dict:
    """Background / Tracker ដែល Edit Video រក្សាទុក (លំនាំដើម បើមិនធ្លាប់ប្តូរ)."""
    return {"name": name, **manage.read_look(_project_folder(name))}


@app.put("/projects/{name}/look")
def save_project_look(name: str, request: LookRequest) -> dict:
    """រក្សាទុក look ក្នុង project.json; រូប background ត្រូវចម្លងចូល output/<name>/."""
    folder = _project_folder(name)
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="រកមិនឃើញ project")
    if any(len(pair) != 2 for pair in request.no_track):
        raise HTTPException(status_code=400, detail="ចន្លោះនីមួយៗត្រូវជា [start, end]")
    try:
        return {"name": name, **manage.write_look(folder, request.model_dump())}
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/projects/{name}/background")
def project_background(name: str) -> FileResponse:
    """រូប background ដែលបានចម្លង (preview ក្នុង Edit Video) — មានតែក្នុង output/<name>/."""
    image = manage.read_look(_project_folder(name))["image"]
    if not image:
        raise HTTPException(status_code=404, detail="គ្មានរូប background")
    return FileResponse(image)


@app.get("/image")
def image_file(path: str) -> FileResponse:
    """រូបដែលអ្នកទើបជ្រើស (មុនរក្សាទុក) សម្រាប់ preview — អានតែប៉ុណ្ណោះ, តែ jpg/png/webp."""
    image = Path(path)
    if image.suffix.lower() not in manage.IMAGE_SUFFIXES:
        raise HTTPException(status_code=400, detail="មិនមែនរូប")
    if not image.is_file():
        raise HTTPException(status_code=404, detail="រករូបមិនឃើញ")
    return FileResponse(image)


@app.get("/scenes")
def video_scenes(path: str) -> dict:
    """shot របស់វីដេអូដើម (menu Tracker "បិទ scene នេះ"); cache ក្នុង output/<stem>/ បើមាន."""
    video = Path(path)
    if video.suffix.lower() not in media.VIDEO_SUFFIXES:
        raise HTTPException(status_code=400, detail="មិនមែន file វីដេអូ")
    if not video.is_file():
        raise HTTPException(status_code=404, detail="រកវីដេអូមិនឃើញ")
    folder = PROJECT_ROOT / "output" / video.stem
    return {"scenes": editor.scenes(video, folder if folder.is_dir() else None)}


@app.get("/projects/{name}/cleanup")
def project_cleanup(name: str, pause: float = 0.5, fillers: bool = True) -> dict:
    """Speech cleanup: pause វែងជាង `pause` វិនាទី + ពាក្យ filler — ជាការស្នើសម្រាប់ពិនិត្យ."""
    if not 0.1 <= pause <= 10:
        raise HTTPException(status_code=400, detail="pause ត្រូវនៅចន្លោះ 0.1-10 វិនាទី")
    data = editor.cleanup_suggestions(_project_folder(name), pause, fillers)
    return {"name": name, "ready": data is not None,
            **(data or {"suggestions": [], "seconds": 0, "pauses": 0, "fillers": 0})}


@app.get("/projects/{name}/waveform")
def project_waveform(name: str) -> dict:
    """កម្ពស់ waveform (0..1) ពី audio.wav — timeline របស់ Edit Video."""
    peaks = editor.waveform(_project_folder(name))
    return {"name": name, "peaks": peaks or []}


@app.get("/projects/{name}/reframe")
def project_reframes(name: str) -> dict:
    """លទ្ធផល AI Reframe (វីដេអូទាំងមូលជាបញ្ឈរ) — បញ្ជីទទេ បើមិនទាន់ធ្លាប់ reframe."""
    return {"name": name, "results": reframe_outputs(_project_folder(name))}


@app.get("/projects/{name}/reframe/{folder}/file")
def reframe_file(name: str, folder: str, kind: str = "mp4") -> FileResponse:
    """`full*/clip_01.<kind>` — folder និង kind ពិនិត្យតាមបញ្ជីតឹង ដូច្នេះ URL អានអ្វីផ្សេងមិនបាន."""
    if not REFRAME_FOLDER.match(folder) or kind not in REFRAME_KINDS:
        raise HTTPException(status_code=400, detail="folder ឬ kind មិនត្រឹមត្រូវ")
    path = _project_folder(name) / folder / f"clip_01.{kind}"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"គ្មាន {kind}")
    media_type = {"mp4": "video/mp4", "srt": "text/plain; charset=utf-8", "vtt": "text/vtt; charset=utf-8"}[kind]
    return FileResponse(path, media_type=media_type)


@app.get("/projects/{name}/reframe/{folder}/thumb")
def reframe_thumb(name: str, folder: str) -> FileResponse:
    """រូបតូចនៃលទ្ធផលវីដេអូទាំងមូល — ទំព័រ Review បង្ហាញវាជាកាតដូច clip."""
    if not REFRAME_FOLDER.match(folder):
        raise HTTPException(status_code=400, detail="folder មិនត្រឹមត្រូវ")
    image = media.thumbnail(_project_folder(name) / folder / "clip_01.mp4")
    if image is None:
        raise HTTPException(status_code=404, detail="គ្មានរូប")
    return FileResponse(image, media_type="image/jpeg")


@app.post("/projects/{name}/reframe/{folder}/export")
def export_reframe(name: str, folder: str, request: ExportRequest) -> dict:
    """ចម្លងវីដេអូ reframe (និង .srt) ទៅ folder export — export.plan/copy_plan ដដែលនឹង clips,
    ដូច្នេះមិនសរសេរជាន់លើទេ ("(2)" ក្បែរ file ចាស់)."""
    if not REFRAME_FOLDER.match(folder):
        raise HTTPException(status_code=400, detail="folder មិនត្រឹមត្រូវ")
    found = next((item for item in reframe_outputs(_project_folder(name)) if item["folder"] == folder), None)
    if found is None:
        raise HTTPException(status_code=404, detail="គ្មានលទ្ធផល reframe នេះទេ")
    title = f"{name} - Reframe {found['aspect'].replace(':', 'x')}"
    items = export.plan([{"index": 1, "title": title, "files": found["files"]}], None,
                        _export_kinds(request.kinds))
    destination = Path(request.destination) if request.destination else export.default_destination(name)
    return export.copy_plan(items, destination)


@app.get("/projects/{name}/export")
def export_preview(name: str, kinds: str = "mp4") -> dict:
    """អ្វីដែល Export **នឹង** សរសេរ និងទៅ folder ណា — មិនប៉ះ disk ទេ.

    UI ហៅវាមុនពេលចុច ដើម្បីបង្ហាញឈ្មោះ file និងទំហំសរុប. វាប្រើ `export.plan()`
    ដូច POST ដែរ ដូច្នេះការបង្ហាញជាមុន និងលទ្ធផលពិតមិនអាចខុសគ្នា.
    """
    chosen = _export_kinds(kinds.split(","))
    items = _export_plan(name, chosen, None)
    # ទំហំ/fps/codec ពិតមកពី clip ទីមួយ — dialog បង្ហាញវាជា "Resolution"/"Quality",
    # ហើយលេខទាំងនោះត្រូវជារបស់ file មិនមែនជារបស់ config.
    first = next((file["source"] for item in items for file in item["files"]
                  if file["kind"] == "mp4"), None)
    return {
        "name": name,
        "destination": str(export.default_destination(name)),
        "format": media.probe_video(Path(first)) if first else None,
        "clips": items,
        "bytes": sum(file["bytes"] for item in items for file in item["files"]),
        "mb": round(sum(file["bytes"] for item in items
                        for file in item["files"]) / 1e6, 2),
    }


@app.post("/projects/{name}/export")
def export_project(name: str, request: ExportRequest) -> dict:
    """ចម្លង clip ដែលជ្រើសទៅ folder — ឈ្មោះអានបាន, មិនសរសេរពីលើអ្វីទាំងអស់."""
    chosen = _export_kinds(request.kinds)
    items = _export_plan(name, chosen, request.clips)
    if not any(item["files"] for item in items):
        raise HTTPException(status_code=400,
                            detail="គ្មាន file ឲ្យ export (clip មិនទាន់ render?)")
    destination = (Path(request.destination) if request.destination
                   else export.default_destination(name))
    try:
        return export.copy_plan(items, destination)
    except OSError as e:
        # folder មិនអាចបង្កើត (drive មិនមាន, គ្មានសិទ្ធិ) — កំហុសរបស់អ្នកប្រើ មិនមែន bug
        raise HTTPException(status_code=400,
                            detail=f"សរសេរចូល folder នេះមិនបាន: {e}") from e


class RenameRequest(BaseModel):
    title: str = Field(max_length=200)


@app.patch("/projects/{name}")
def rename_project(name: str, request: RenameRequest) -> dict:
    """ប្តូរ**ឈ្មោះបង្ហាញ**។ folder មិនផ្លាស់ទីទេ — វាចងនឹងឈ្មោះ file វីដេអូ (server/manage.py)."""
    folder = _project_folder(name)
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="រកមិនឃើញ project")
    title = manage.write_title(folder, request.title)
    return {"name": name, "title": title or name}


@app.delete("/projects/{name}")
def delete_project(name: str) -> dict:
    """ផ្ញើ `output/<name>` ទៅ Recycle Bin ហើយលុប project ពី database.

    វីដេអូដើមមិនត្រូវបានប៉ះទេ (វានៅក្រៅ output/)។ មិនលុបពេល job របស់ project នេះកំពុងរត់ —
    FFmpeg កំពុងសរសេរ file ក្នុង folder នោះ។
    """
    folder = _project_folder(name)
    output_root = (PROJECT_ROOT / "output").resolve()
    if folder.exists() and folder.resolve().parent != output_root:
        raise HTTPException(status_code=400, detail="folder នេះមិននៅក្នុង output/")
    active = runner.active()
    if active is not None and active.out_dir.name == name:
        raise HTTPException(status_code=409, detail="project នេះកំពុងមាន job រត់ — បោះបង់ job សិន")
    if not folder.is_dir() and not any(item["name"] == name for item in db.list_projects()):
        raise HTTPException(status_code=404, detail="រកមិនឃើញ project")
    recycled = folder.is_dir()
    if recycled:
        try:
            manage.recycle(folder)
        except OSError as error:
            # database មិនប៉ះ បើ folder នៅតែមាន — project មិនត្រូវពាក់កណ្តាលលុបទេ
            raise HTTPException(status_code=500, detail=f"ផ្ញើទៅ Recycle Bin មិនបាន: {error}")
    db.delete_project(name)
    return {"name": name, "recycled": recycled}


@app.post("/reveal")
def reveal_path(request: RevealRequest) -> dict:
    """បើក folder ក្នុង File Explorer (បន្លិច file បើ path ជា file).

    Sidecar ចង link តែ 127.0.0.1 ហើយ CORS អនុញ្ញាតតែ origin របស់ app —
    ដូច្នេះមានតែ UI ក្នុងម៉ាស៊ីននេះអាចហៅវា.
    """
    if not export.reveal(Path(request.path)):
        raise HTTPException(status_code=404, detail="path នេះមិនមាន")
    return {"ok": True}


@app.websocket("/jobs/{job_id}/events")
async def job_events(socket: WebSocket, job_id: str) -> None:
    """ផ្ញើបន្ទាត់ថ្មី + ស្ថានភាពរាល់ពេលមានអ្វីផ្លាស់ប្តូរ.

    WebSocket ព្រោះ job រត់រាប់នាទី ហើយ UI ត្រូវឃើញវឌ្ឍនភាពផ្ទាល់ — polling
    រាល់វិនាទីក៏បានដែរ តែ WS មិនខ្ជះខ្ជាយ។
    """
    await socket.accept()
    job = runner.jobs.get(job_id)
    if job is None:
        await socket.send_text(json.dumps({"error": "រកមិនឃើញ job"}))
        await socket.close()
        return

    sent = 0
    last_state = None
    try:
        while True:
            if len(job.log) > sent:
                for line in job.log[sent:]:
                    await socket.send_text(json.dumps({"line": line}))
                sent = len(job.log)
            if job.state != last_state or sent:
                await socket.send_text(json.dumps({"status": job.as_dict()}))
                last_state = job.state
            if job.state != "running":
                break
            await asyncio.sleep(0.4)
    except WebSocketDisconnect:
        return
    await socket.close()
