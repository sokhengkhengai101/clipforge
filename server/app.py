"""Sidecar HTTP សម្រាប់ UI (Phase 1).

រត់៖  python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
សាក៖  http://127.0.0.1:8765/docs

វាចង link តែ **127.0.0.1** ប៉ុណ្ណោះ — app ក្នុងម៉ាស៊ីន មិនមែន server សាធារណៈ
(គោលការណ៍ "local-first, no uploads" របស់ project)។
"""

import asyncio
import json
import shutil
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel

import config
from server import db, media
from server.clips import clips_of_project
from server.jobs import PROJECT_ROOT, JobRunner

config.enable_utf8_output()

app = FastAPI(title="ClipForge sidecar", version="0.2.0")
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
    full: bool | None = None
    redo: str | None = None


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
    }


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


@app.get("/projects")
def list_projects() -> list[dict]:
    """project ទាំងអស់ — database **បូក** folder ក្នុង `output/`.

    Database ដឹងពី job (ពេល, ស្ថានភាព) តែវាទើបមានពេល Phase 1B; project ដែល
    សង់ដោយ CLI មុននោះមានតែ folder. UI ត្រូវឃើញទាំងពីរ.
    """
    projects = db.list_projects()
    known = {item["name"] for item in projects}
    out_root = PROJECT_ROOT / "output"
    for folder in sorted(out_root.iterdir()) if out_root.is_dir() else []:
        if not folder.is_dir() or folder.name in known:
            continue
        found = clips_of_project(folder)
        if not found:
            continue
        projects.append({
            "id": -len(projects) - 1,          # លេខអវិជ្ជមាន = មិនមានក្នុង database
            "name": folder.name,
            "video": "",                        # មិនដឹង path ដើមទេ
            "created": folder.stat().st_mtime,
            "clips": len(found),
            "jobs": 0,
            "last_state": None,
        })
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


def _clips_of(name: str) -> list[dict]:
    items = clips_of_project(PROJECT_ROOT / "output" / name)
    return items or db.project_clips(name)


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
    if not items and not (PROJECT_ROOT / "output" / name).is_dir():
        raise HTTPException(status_code=404, detail="រកមិនឃើញ project នេះ")
    return {"name": name, "clips": items}


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
