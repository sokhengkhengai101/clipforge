# ClipForge Studio

Local-first desktop app that turns long videos (podcasts, webinars, streams) into short vertical clips with AI-picked highlights, captions (EN + Khmer), face-tracked reframing, and silence/filler removal. Everything runs on the user's computer — no uploads.

## How to work with me (the developer)

- I am learning. Explain each step in **Khmer**, keeping technical terms in **English** (e.g. "យើងប្រើ `subprocess` ដើម្បីហៅ FFmpeg").
- Work in **small steps**. After each step: tell me what you did, why, and how I can test it myself. Wait for me before the next big step.
- Prefer simple, readable code over clever code. Add short comments where a beginner would get stuck.
- When you introduce a new concept (e.g. word timestamps, JSON schema, async), explain it in 2–3 sentences with a tiny example.
- Never delete or modify my original video files. Write outputs to `output/`.

## Current phase: Phase 0 — Foundations (Python CLI only, no UI)

Goal: `python make_clips.py podcast.mp4` → 5 vertical clips with burned-in captions in `output/`.

Gate to move to Phase 1: the script reliably produces 5 clips I would actually post.

**Gate met (2026-10-17)**, judged on three sources: a 35-min 640x360 podcast, a 47-min 1080p
interview ("1: can post all"), and a 70-min 1280x720 two-person podcast ("clip 5 is good"). Not
yet tested on screen-share, webinar or gaming footage. Phase 1 has not started -- ask first.

Pipeline (one module per step, in `pipeline/`):
1. `audio.py` — extract audio with FFmpeg → WAV 16 kHz mono
2. `transcribe.py` — faster-whisper → segments + **word-level timestamps** → cache to `output/<name>/transcript.json` (skip if cache exists)
3. `highlights.py` — chunk transcript (~5 min, 30 s overlap) → LLM → JSON clips `{start, end, title, hook, type, score, reason}` → validate with pydantic → dedupe overlaps → top N by score
4. `boundaries.py` — snap start/end to nearest sentence boundary, add 0.3 s padding, keep 15–90 s.
   A "sentence" also ends at a pause over 1 s, because Whisper drops punctuation; those ends are
   marked `hard=False` and the end-snapping prefers a real `.?!` within `SNAP_HARD_END_SEC` (4 s)
   so a clip stops on a finished thought. Measured on a 70-min podcast: 97 of 868 sentences (11%)
   end on a pause, and the rule took clips ending on punctuation from 12/15 to 13/15 with no
   change on the 47-min interview (14/14 before and after).
   It also drops sponsor reads: `find_ad_spans()` looks for start phrases ("sponsored by") and
   call-to-action phrases ("use code", "% off", "com slash"). A CTA sits at the *end* of a read, so
   it reaches back `AD_CTA_LEAD_SEC` (90 s), while a start phrase is cut at its own first word.
   Seeds within 90 s merge, because two sponsor reads run back to back (measured gap: 81 s).
   Measured on the 70-min podcast: 2 spans, 304 s (7.5%), clips touching an ad 2 -> 0, one pure-ad
   clip dropped and one trimmed from 23 s to 28 s of real story. The 47-min interview has 0 spans
   and is unchanged.
   The start gets the same treatment: a clip must not open on "Yeah," — the first second decides
   whether anyone keeps watching. Snapping skips sentences that are pure acknowledgement and then
   drops leading filler words, including phrases ("you know"), passing over a connector between two
   of them ("Yeah, so yeah, please go back..." opens on "please"). Padding is clamped to word
   boundaries, not sentence boundaries, or the 0.3 s lands inside the filler word and the viewer
   hears its tail. Measured: podcast clips opening on filler 3/15 -> 0/15, interview 0/14 either way.
   Candidates carry a **rubric** instead of one number: `grades.hook / .flow / .value`, each 0-100
   with a reason, weighted 0.35/0.25/0.30 into a score out of 100 and letter grades computed in
   code (`letter_for`), which is the OpusClip clip card. `trend` is left out: it needs outside data
   about what is topical, which a local model would only guess.
   It did **not** fix score inflation, which is why it was built. Measured on the same podcast: one
   1-10 score gave only 8 and 9 across 15 candidates (sd 0.40, i.e. 4.0 out of 100), while the
   rubric gives 80-86 across 9 (sd **2.36**) -- averaging three clustered numbers has *less* spread
   than one. The second-pass `rank_clips` is still what orders clips. What the rubric does buy is
   the explanation: per-dimension letters and reasons. It costs about 70% more time in the
   highlights step (182-230 s per chunk against ~126 s), because the model writes more JSON.
5. `captions.py` — build `.ass` subtitle file per clip (≤ 2 lines, ≤ 32 chars/line, keyword
   highlight in #FFD23F). A cue never **ends** on a linking word (`CAPTION_NO_BREAK_AFTER`:
   articles, prepositions, auxiliaries, conjunctions): the viewer would read "...behind the" and
   wait for the next cue to learn what "the" was. Splitting evenly by word count did that on 21%
   of podcast cues and 27% of interview cues; carrying the trailing word into the next cue instead
   takes both to 1-2%, at the cost of ~8% more cues. Delaying the break by a word does not work,
   because those cues are already at `--caption-words`.
   A cue also ends at a silence over `CAPTION_PAUSE_SEC` (0.5 s), or the text sits frozen on
   screen through it: 4-9% of cues spanned a gap that long, the worst holding five words for 5.3 s.
   `check_cues()` runs the research checklist over the real cues after captions are built and
   prints what it finds (words/chars/lines over the limit, cues under 0.25 s, overlaps, cues ending
   on a linking word, highlight ratio outside 10-35%, text outside the safe zone). On the current
   clips it reports 3 problems in 123 cues and 3 in 95; the podcast one that stays is the word
   "yet" ending a sentence in 0.14 s, where merging forward would mix two sentences and merging
   back would break the word limit.
   Each clip also gets `.srt` and `.vtt` next to its `.mp4` (`CAPTION_SIDECARS`), for uploading to
   a platform or reading with a screen reader. Those files keep the real text -- original case and
   punctuation, display line breaks joined -- while the burned `.ass` stays uppercase and stripped,
   because the 16-character lines are a vertical-video layout, not a caption format.
6. `render.py` — FFmpeg: trim → center-crop 9:16 → scale 1080×1920 → burn ASS → H.264 MP4

All six steps are implemented and run end to end. Measured on a 35-min 640×360 podcast:
audio 6 s, transcribe 8 min (GPU), highlights 8 min 33 s (7b), boundaries and captions under a
second, render 39 s for five clips. Re-running with every cache warm takes about 40 s.

Known limits to judge clips against:
- Center-crop assumes a talking head. On screen-share footage it cuts the slide in half, and a
  640×360 source upscaled to 1080×1920 is visibly soft. Use a 1080p source for clips worth posting.
- `--redo <step>` re-runs one step (audio, transcribe, highlights, render, or all); `--force` is
  the same as `--redo all`.
- `clips.json` holds the whole ranked list and is written only when the ranking actually ran.
  It used to store the list already cut to `--max-clips`, so `--max-clips 2` silently threw away
  the approved selection and every later run rendered two clips.
- `.ass` and `.mp4` for a clip must share a folder: render runs FFmpeg with `cwd` set to that
  folder so the `ass=` filter never sees a Windows path (`:` and `\` are filtergraph syntax).
- A face is only used for a `single` crop when it shows up in at least `FACE_PRESENCE_MIN` (half)
  of the shot's sample frames. On wildlife footage a 14.8 s shot had the presenter in the first
  sample only, and the static box then framed his chest for the last 10 s. Those shots fall back
  to a centre crop.
- Short sources are a poor fit for clip-finding. A 56 s wildlife video gave one 7 s candidate that
  boundary-snapping stretched to 42 s, crossing a 26.5 s silence to reach `MIN_CLIP_SEC`. Use
  `--full` for anything near clip length.
- `SCENE_THRESHOLD` is 0.2. At 0.3 it missed real cuts twice: the montage at 33.78-40.46s of the
  47-min interview (0.2 finds 34.33, 35.91, 39.29) and a cut at 50.76 s in the wildlife clip, where
  one shot held both a centred presenter and a two-shot, so the panel boxes from one framing showed
  bushes in the other. Measured when lowering it: the podcast plans identically, the interview
  moves 3 s between layouts, the wildlife clip loses a bogus split, and planning takes the same
  time.

Out of scope for Phase 0: per-frame MediaPipe tracking, diarization, Khmer
translation, UI, batch. (Sampled face tracking inside a shot is in, see Layout below.)

## Tech choices

- Python 3.14.3 (the only version installed on this machine), virtualenv in `.venv/`
- FFmpeg (system binary, called via `subprocess`)
- `faster-whisper` — auto-detect via `config.detect_device()`. This machine: GTX 1060 3GB (Pascal,
  no float16) → GPU uses `medium` + `int8_float32`; CPU fallback uses `small` + `int8`.
  `large-v3` does not fit in 3GB VRAM. Measured on a 30 s clip: GPU `medium` 4.0x realtime,
  CPU `small` 1.4x realtime.
- GPU needs CUDA 12 DLLs (`requirements-gpu.txt`): CTranslate2 is built against CUDA 12 but this
  machine has CUDA 13. `config.enable_cuda_dlls()` adds the pip-installed DLLs to the search path
  AND preloads them by full path — the preload is what actually makes CTranslate2 find them.
  Without them Whisper silently falls back to CPU, so `transcribe()` reports it via `on_fallback`.
- `faster-whisper` cannot decode media on this setup (PyAV 19 removed the `metadata_errors` arg it
  passes). `transcribe.py` reads the WAV itself (`wave` + numpy) and hands Whisper a float32 array.
- LLM: **Ollama** locally (default `qwen2.5:7b-instruct`, configurable in `config.py`)
  Measured on a 35-min transcript (8 chunks): `qwen2.5:7b-instruct` 8m33s, clips averaged 32s and
  2 of 5 landed in the 25-60s target; `qwen2.5:3b` 2m16s but clips averaged 8s and none reached
  15s, so 3b is only useful for smoke-testing the pipeline, not for real clips.
  Use `--redo highlights` while tuning prompts — `--force` re-runs the 8-minute transcribe.; optional Anthropic API via `ANTHROPIC_API_KEY` env var. Wrap both behind one `llm.py` interface.
- `pydantic` for validating LLM JSON, `typer` for the CLI, `rich` for progress output
- Tests: `pytest` with a short sample clip in `tests/fixtures/`

## Subject detection (reframing any video, not just podcasts)

`pipeline/subjects.py` runs YOLOX-S (COCO, 80 classes) from opencv_zoo through `cv2.dnn` and keeps
the people and animals. `plan_shot` uses it **after faces**: face -> body/animal -> motion ->
centre crop, controlled by `USE_SUBJECTS`.

Why: the face detector covers a podcast completely and a wildlife video barely half the time.
Sampling 40 frames of each test video, frames with any usable subject:

| video | face only | + YOLOX |
|---|---|---|
| wildlife, 56 s | 47% | **80%** |
| three-person podcast | 100% | 100% (`person` x3 per frame) |
| interview | 95% | 100% |

A rhino comes back as `sheep` or `bear` -- COCO has no rhino -- which is enough, since the planner
only needs "a large subject is here". YOLOX is anchor-free, so decoding is
`(prediction + grid) * stride`, then NMS; it costs about 175 ms per frame on the CPU, and we sample
a few frames per shot. The model is 34 MB: `python check_env.py` prints the curl command for it.

`motion_centre()` is the last resort when neither a face nor a subject is found -- dust, a blurred
animal running. It diffs six small frames across the shot and takes the weighted centre of the
pixels that move most. A panning camera moves every pixel, which makes that centre meaningless, so
it is rejected when the motion map is too uniform: measured `mean/max` is 0.90 for a synthetic pan
and 0.54 for a real one, against 0.21-0.32 where something in the frame moves.

Signals together, on 40 sampled frames (face first, then subject, then motion):

| video | face | subject | motion | nothing |
|---|---|---|---|---|
| wildlife | 18 | 12 | 9 | **1** (97% covered, was 47%) |
| podcast | 40 | 0 | 0 | 0 |
| interview | 38 | 2 | 0 | 0 |

A body box centred would frame the chest, so `head_of()` turns it into a `Face` covering the top
`SUBJECT_HEAD_RATIO` (25%) of the box; everything downstream already speaks `Face`. The same
presence rule applies as for faces -- a subject seen in one sample frame does not get the shot.
Subjects feed single crops only, never split, since a body box carries no identity.

What it changed, measuring whether the subject's centre falls inside the crop the planner chose:

| video | before | after |
|---|---|---|
| wildlife | 59% | **81%** |
| interview | 94% | 97% |
| podcast | identical plan (faces answer every frame) | |

It costs YOLOX inference only on shots with no face: the wildlife clip plans in 10.9 s instead of
7.3 s, the interview 41 s instead of 30 s, the podcast unchanged. Where the crop still misses, the
subject moved inside a shot whose box is static, or the person's head is outside the source frame
(at 19.2 s the presenter is cut by the frame edge, so the crop shows his torso -- OpusClip's own
reframe of that moment does the same).

## Project layout

```
clipforge/
├─ CLAUDE.md
├─ make_clips.py        # CLI entry (typer)
├─ config.py            # defaults: clip length, max clips, model names, device auto-detect
├─ check_env.py         # doctor script: Python/FFmpeg/GPU/Ollama check
├─ pipeline/            # audio, transcribe, highlights, boundaries, captions, render, llm
├─ prompts/             # podcast_highlights.md (LLM prompt, versioned)
├─ server/              # Phase 1 sidecar: app.py (FastAPI), jobs.py (subprocess), db.py (SQLite)
├─ design/              # 1F source of truth: HANDOFF.md, TOKENS.md, screens/*.html
├─ ui/                  # Phase 1 React UI (Vite + Tailwind); src/kit/ = 1F components
│  ├─ src-tauri/       # Phase 1D desktop shell (Rust): window + starts the sidecar
│  └─ scripts/         # shot.mjs (Playwright), window-shot.ps1 (desktop window)
├─ tests/
└─ output/              # git-ignored
```

## Phase 1 (started 2026-10-18)

Tauri 2 (Rust) + React/TypeScript + Tailwind + shadcn/ui over a Python sidecar. This machine
already has Node 24.13 and Rust 1.99, so nothing large needs installing; FastAPI and uvicorn do.

Order: **1A sidecar**, **1B SQLite**, **1C React**, **1D Tauri** and **1E** (done). 1E built every
Figma screen Phase 1 can honestly back -- 01 Models, 02 Home, 03 Processing, 04 Review, 05 Export --
and left 06 Silence & Filler Cleanup (Phase 2 pipeline work), 07 Brand Kits and 08 Batch Queue
(Phase 3) unbuilt rather than drawn and inert. The UI is built against the sidecar in a plain
browser first, so there is no Rust rebuild loop while the screens take shape.

**Gate to move to Phase 2** (not met yet -- the developer judges it, as with Phase 0): on a video
that has never been processed, the desktop app takes it from drop to exported clips with no
terminal, and the developer would post the result. Verified so far: every screen works in the real
window (below); Start inside the app runs the pipeline to `done` (76 s with warm caches, see the
incident below); a real Explorer drop picks the video from any screen (measured, see "Drop only worked on Home" below).
**Cold run inside the app, measured 2026-10-19** on `How-AI-agents.mp4` (35:25) after deleting only
`output/How-AI-agents/`: chosen and started from Import in the real window (`tauri.localhost`, its own
uvicorn), no terminal. Steps from the Processing screen: audio 3 s, transcribe 7 min 18 s (GPU,
`medium`), **highlights 19 min 30 s** (`qwen2.5:7b-instruct`), boundaries 12 s, captions 19 s, render
37 s -- `done` in **28 min**. Highlights is the long pole: 8 min 33 s before the rubric, and the
rubric's ~70 % estimate predicted ~14.5 min, so the measured cost is higher than recorded. Result: five
1080x1920 clips (0:17-1:09) with rubric letters (88-90), `cache_version` 5, `.srt/.vtt` beside each;
clip 4 (1:09, "email sponsorship") was read and is a story about screening sponsor emails, not an ad
read. The original's size, mtime and SHA-256 were identical before and after. Seen on the way: the
known 404 on `/projects/<name>/clips` for a video with no folder yet (twice, before transcribe), and a
`tauri dev` build of `app.exe` that loads `localhost:5173` -- rebuild with
`npx tauri build --debug --no-bundle` before driving the window. Still the developer's call: whether
these clips are worth posting.

`server/` holds the sidecar, bound to 127.0.0.1 only (the project uploads nothing):

    python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
    http://127.0.0.1:8765/docs

`GET /` redirects to `/docs`, so opening the port in a browser is not a 404.
`GET /health`, `GET /videos`, `POST /jobs`, `GET /jobs` (session + history),
`GET /jobs/{id}`, `DELETE /jobs/{id}`, `GET /projects`, `GET /projects/{name}/clips`, and
`WS /jobs/{id}/events` for live log lines and status.

**The sidecar spawns `make_clips.py` as a subprocess** rather than importing the pipeline. The
orchestration is 330 lines interleaved with `console.print`, and extracting it now would risk a CLI
that works. A subprocess also isolates crashes and makes cancelling a kill. Job options map
straight to CLI flags (`max_clips=3` -> `--max-clips 3`).
Progress comes from **the files the pipeline already writes** (`audio.wav`, `transcript.json`,
`highlights.json`, `clips.json`, then `.ass` and `.mp4` in the clips folder), not from parsing
console text. One job at a time: a second `POST /jobs` returns 409, because Whisper and Ollama
share one 3 GB GPU.
Measured end to end through the API: the 56-second wildlife video ran to `done` in 34.3 s with
6/6 steps and 37 log lines streamed over the WebSocket.

**`server/db.py` — SQLite (1B).** The pipeline already leaves its state on disk, so the database
is not there to hold the clips again; it is there to hold what the files cannot say: *which jobs
ran, when, how long, and why one failed*. `clips.json` only describes the newest run. Three tables
in `output/clipforge.db` (git-ignored, 28 KB after one job): `project` (one row per `output/<name>/`
folder, unique by name), `job` (id, args as JSON, state, step, error, started/finished), and
`clip` (the ranked list, unique by `(project_id, idx)` and rewritten whole on each run).
`JobRunner` writes a `job` row on `start()` and updates it once on finish; a `done` job also
writes its clips. `server/clips.py` reads `clips.json` for both the API and the database, so the
two can never disagree.
A new connection is opened per operation: sqlite3 connections are not thread-safe and jobs run in
their own thread, while the writes are a handful per job. `connect()` is a `@contextmanager`
because `with sqlite3.connect(...)` commits but **does not close** — the handle stays open and
Windows then refuses to delete the file, which is how a test found it.
Measured end to end: a job through the API wrote one project, one `job` row (35.4 s, step
`render`) and one clip (`Daily Rhino Monitoring`, 11.2-53.1 s, 70 C+); after killing and
restarting uvicorn, `GET /jobs` still returns that job with `from_history: true` while
`GET /jobs?history=false` returns `[]`.

**`ui/` — React (1C).** Vite 8 + React 19 + TypeScript + Tailwind 4, scaffolded with
`npm create vite@latest ui -- --template react-ts`. `npm run dev` serves port 5173 and
**proxies `/api/*` to 127.0.0.1:8765** with `ws: true`, so the browser sees one origin (no CORS
header to add on the Python side) and `src/api.ts` only ever writes `fetch('/api/health')`.
Tailwind is the `@tailwindcss/vite` plugin, not PostCSS, and it must be **4.3 or newer**: 4.1
declares `peer vite@^5 || ^6 || ^7` and npm refuses to install it next to Vite 8.
The Figma tokens live in one `@theme` block in `src/index.css` (`--color-app`, `--color-panel`,
`--color-card`, `--color-accent`, `--color-keyword`), which is what makes `bg-panel` and
`text-accent` exist as classes; 1E replaces the rest of the styling, not these names.

Starting a job and watching it: `useJob()` (`src/useJob.ts`) posts to `/api/jobs`, then opens the
WebSocket and keeps `status` and the log lines in state. The six steps are drawn from the same
list as `server/jobs.py` STEPS.
Progress now separates **cached from fresh**: the markers are files, so a project that has run
before showed 6/6 the moment the job started, which is a lie. `Job.cached` is the set of markers
that already existed at `start()` *minus* the steps `--redo`/`--force`/`--full` will rewrite
(`steps_redone()`, since `--redo` overwrites files rather than deleting them), and `progress()`
reports `cached`, `fresh` and `done`. Measured through the Vite proxy on the wildlife video with
`redo=render`: `cached` = audio/transcribe/highlights/boundaries, `fresh` = captions/render,
41 log lines and 56 status messages over the WebSocket, `done` in 23.5 s.

**Figma (1E, brought forward).** The design file is read through the Figma MCP server, not by eye:
`get_metadata` lists the eight screens, `get_variable_defs` gives the real variables, and
`get_design_context` returns reference code plus a render of a screen.
That server is the **claude.ai Figma connector** (account-level, `claude mcp list` shows it as
connected), not an entry in a project `.mcp.json` -- a second entry pointing at the same
`https://mcp.figma.com/mcp` only waits for approval and duplicates the tools. MCP tools are
registered when the process starts, so authorising a connector in `/mcp` does not reach a session
that is already running: Claude Code has to be restarted (`claude --continue` brings the
conversation back) before the figma tools can be called. The tokens in
`src/index.css` are those variables (`bg/app` -> `--color-bg-app`, so the class is `bg-bg-app`),
including ones CLAUDE.md had never recorded: `bg/hover #2c3140`, `border/default #2e3340`,
`border/strong #454b5c`, `accent/soft #2a2350`, `text/primary #f2f4f8`, `text/secondary #9aa1b2`,
`status/success #3dd68c`, radius 6/10/14, and the type scale (Display 28/36 ... Label 11/16 with
0.66 px tracking), which are `@utility text-display`, `text-label` and so on.
The 22 icons are downloaded into `ui/src/assets/figma/` -- Figma's asset URLs expire in 7 days,
so nothing may point at them at runtime.
**Screen "03 · Processing" (node 10:414) is implemented** as `components/Processing.tsx`, with
`TitleBar`, `Sidebar` and `Badge` beside it. It is bound to the real job, which means three panels
of the design hold different content: the design's 8 pipeline steps are our 6 (its "Detect speech"
with Silero VAD and "Identify speakers" with pyannote are Phase 2), its "Live transcript" is our
pipeline log, and its SPEAKERS / GPU LOAD stats are STATE / ELAPSED / LOG LINES / CLIPS, because
those are numbers we actually have. The sidebar's other pages are drawn but inert.
`ui/scripts/shot.mjs` (Playwright, a dev dependency) drives the page in a real browser at
1440x900 and reports console errors, failed requests, every icon's rendered size and what the
Review screen actually loaded -- that is how these screens were checked against the Figma render
rather than assumed. `--job` also clicks Start and screenshots a run. Measured on the last run:
27 icons load, 5 thumbnails, the video reports 1080x1920, 28 cues parsed, no console errors and
no failed requests. A cancelled video request (`ERR_ABORTED`) is ignored, since the browser aborts
the stream whenever the clip changes.

**Screen "04 · Review & Edit" (node 7:2) is implemented** as `components/Review.tsx`: the clip
list with real thumbnails, the clip playing in a `<video>`, the rubric panel, and the caption
settings, which start a `--redo render` job rather than only looking like controls.
It needs three endpoints (`server/media.py`): `GET /projects/{name}/clips/{i}/file?kind=mp4|ass|srt|vtt`,
and `/thumb`, which runs FFmpeg once and keeps the `.jpg` beside the clip. The URL carries the
clip **number**, never a path, and the path comes from `clips.json`, so `../` in a URL means
nothing. `FileResponse` answers Range requests (measured: 206 with 1000 bytes), which is what lets
the video seek. The transcript under the player is the clip's own `.vtt` parsed in the browser
(`src/vtt.ts`), and clicking a line seeks the video.
`GET /projects/{name}/clips` now returns an empty list for a project that has run but has no clips
yet, and 404 only for a project that does not exist; it used to 404 on every poll before render
finished and fill the browser console.
What the design shows and we do not have: the waveform, speaker labels, per-word cutting, the
Reframe and Cleanup tabs (drawn, inert) and the three toggles. Clips scored before the rubric have
no `grades`, and the panel says so instead of drawing empty bars.

**Screen "02 · Home / Projects" (node 8:238) is implemented** as `components/Home.tsx`: the drop
zone, the nine preset cards, the samples list and the recent projects.
The nine presets are in `src/presets.ts` and each one is **the flag bundle it would really run**
(`Podcast Clips` = `--max-clips 5`, `Caption Studio` = `--redo render --caption-words 4`,
`Long Video` = `--max-clips 10`, `Auto Reframe` = `--aspect 9:16 --layout auto`,
`Interview & Webinar` = `--layout fill,split,fit`); hovering a card shows those flags. The four
that need Phase 2 or 3 work (silence removal, Khmer subtitles, gaming, batch) are drawn at half
opacity, badged `PHASE 2` / `PHASE 3` and cannot be clicked, instead of pretending to run.
A browser is not allowed to read a dropped file's path, only its name, so the drop zone matches
the name against `samples/` and otherwise asks for the full path to be pasted (the Tauri build in
1D can take the drop itself). `Import folder (batch)` is inert, as batch is Phase 3.
`GET /projects` now merges the database with the folders in `output/`: the DB only knows about
runs made through the sidecar, while most projects on this machine were made by the CLI, and the
UI has to show both (a folder-only project gets `jobs: 0` and no video path, so it can be reviewed
but not re-run).
Two things the screen made visible, both now fixed: a job row stays `running` for ever when the
sidecar is killed mid-run, so `db.interrupt_stale_jobs()` marks those `interrupted` at startup and
the card reads STOPPED rather than PROCESSING; and `tests/test_server.py` was writing into the
real `output/clipforge.db`, which is why a project called `v` with 27 runs (from `tmp/v.mp4`)
appeared in the list -- the fixture now points `db.DB_PATH` at a tmp file.

**1D: the desktop app.** `ui/src-tauri/` is a Tauri 2 shell (Rust 1.99, WebView2 155 on this
machine). `npm run app` opens it, `npm run app:build` would build an installer.
The Rust side does two things. It **starts the Python sidecar itself** (`src/sidecar.rs`): it
walks up from the working directory and the exe looking for a folder that holds both
`server/app.py` and `.venv`, runs `uvicorn` there with `CREATE_NO_WINDOW` so no console flashes,
and skips all of it when port 8765 already answers (so `uvicorn` started by hand keeps working).
On `RunEvent::Exit` it kills the child. Measured: the app's uvicorn is a child of `app.exe`, and
closing the window leaves no python process and port 8765 free. A crash or Task Manager kill
skips that handler and would leave uvicorn running -- a job object would fix it if it ever bites.
Nothing is bundled yet: an installer built today would not find Python, since packaging the
interpreter (PyInstaller or similar) is its own job.
The window has `decorations: false`, so the title bar **from the design** is the real one, with
`data-tauri-drag-region` and three coloured dots for close, minimise and maximise. **Neither ever
worked** until the 1F kit, and nothing measured it: Tauri 2's `core:default` grants only read-only
window commands, so `minimize`, `toggle_maximize` and `start_dragging` came back "not allowed"
(checked by invoking them through CDP; `is_maximized` was allowed as the control), and the title
bar called them with no `.catch`. `capabilities/default.json` now adds exactly
`core:window:allow-close`, `-minimize`, `-toggle-maximize` and `-start-dragging`; measured after:
maximise toggles `false -> true -> false`, minimise reports minimised, drag is allowed.
In the app the page is served from `tauri.localhost`, so there is no Vite proxy: `src/api.ts`
switches between `/api` (browser) and `http://127.0.0.1:8765` (desktop) by looking for
`__TAURI_INTERNALS__`, and the sidecar now carries `CORSMiddleware` that allows **only** the Tauri
and dev-server origins -- measured: `http://tauri.localhost` gets the allow header and
`https://evil.example.com` does not.
Dropping a file finally works properly: a browser is only given the file's name, but Tauri's
`onDragDropEvent` gives the full path, so `src/useFileDrop.ts` listens for it when running in the
app (imported dynamically, so the browser build puts it in a chunk it never loads).
`ui/scripts/window-shot.ps1` captures the desktop window with `PrintWindow(..., PW_RENDERFULLCONTENT)`;
`CopyFromScreen` was wrong, because Windows refuses to raise a window on request and the capture
then shows whatever is actually in front.

**1E: Export (the sidecar half).** Screen 05 needs a folder someone can upload from, not
`output/<name>/clips/clip_01.mp4`: that name says nothing on a phone, and `--redo render` rewrites
those files under you. `server/export.py` copies them out instead, naming each
`01 - <title>.mp4` so sorting by name is the ranking order, and it **never overwrites** -- a second
export of the same clip lands beside the first as `01 - <title> (2).mp4`, the way Windows copies.
Titles lose the characters Windows rejects (`<>:"/\|?*`, control characters) and are cut to 60,
since the whole path has to stay under 260.
`GET /projects/{name}/export` returns what an export *would* write (new names, bytes, total)
without touching the disk; `POST` does it with `{destination, clips, kinds}`. Both call the same
`plan()`, so the preview cannot disagree with the result. `kinds` is checked against `media.KINDS`,
so the UI cannot ask it to copy an `.exe`, and a file that fails goes into `skipped` with its
reason rather than aborting the other four. `POST /reveal` opens the folder in Explorer
(`explorer /select,<file>` for a file, which returns exit code 1 even when it works, so the result
is ignored). Every file carries `bytes` as well as `mb`, because an `.srt` is a few KB and
`round(mb, 2)` printed it as "0.0 MB". The default destination is
`~/Videos/ClipForge/<project>/`, computed in Python only, so the UI never joins that path itself.
Measured on `How-AI-agents` (5 clips, 9.25 MB): the preview lists `01 - Proper Skill Creation
Process.mp4` through `05 - Sponsor Emails and Agent Efficiency.mp4`; exporting clips 1 and 4 twice
leaves four files with the second pair suffixed `(2)`; the sources in `output/` are unchanged.
Asking for `srt,vtt` there returns neither, because that project was rendered before
`CAPTION_SIDECARS` -- the plan only lists files that exist.

Building it turned up why most projects on this machine were invisible to the UI:
`load_clips()` rejects a `clips.json` whose `cache_version` is not the current one (5), and 4 of
the 6 real projects are version 2. For the pipeline that answer is right -- an old cache means
"run the LLM again" -- but `server/clips.py` and `review.py` were using the same function to
*display* finished work, so a project with five rendered `.mp4`s showed up with no clips at all.
Those two now pass `any_version=True`. The schema tolerates it: a clip from before the rubric has
no `grades`, which `Clip` already accepts (that old file reads back as `90 A-`).

**Screen "05 - Export dialog" (node 11:723) is implemented** as `components/ExportDialog.tsx`,
opened by the Export button on Review. In the design it is not a page: a scrim with a 600x780
dialog over screen 04, so it is a modal here too.
Export **copies** finished files; it never re-renders. Three panels of the design mean something
slightly different because of that, and the dialog says so rather than pretending:
PLATFORM PRESET became `PLATFORM FIT`, which reads the clip's real aspect from `ffprobe` and shows
which platforms it already fits (9:16 -> TikTok, Reels, Shorts; YouTube dimmed with "needs a
re-render at 16:9"); it is drawn in `accent-soft`, not filled accent, so four lit buttons do not
read as four selected ones. "Burn captions" is on and locked, because captions are burned at
render. "Add brand logo" is Phase 3, dimmed and badged like the Home presets.
Resolution and Quality are the file's own numbers (`media.probe_video`, one `ffprobe` on the first
clip): the design mock says "30 fps · 12 Mbps" and the real clips say 29.97 fps and 6.0 Mbps.
The file-name field is read-only and states the rule (`{clip_no} - {title}.mp4`) instead of
offering a template, since the number is what keeps sorting by name equal to the ranking.
The preview asks for `mp4,srt,vtt` once and the subtitle toggle filters client-side, so flipping it
does not re-ask the sidecar. After copying, the dialog shows the real path, the file names written
and an Open folder button (`POST /reveal`).
Measured through Playwright against the real sidecar on `Taylor_Tomlinson`: the dialog opens with
5 clips ticked, `PLATFORM FIT · 9:16`, `1080 × 1920 · 29.97 fps`, `H264 · 6.0 Mbps`, footer
"5 videos + 10 subtitle files · 118.7 MB"; unticking four and exporting wrote
`01 - Comedy vs. Real Life.mp4/.srt/.vtt` (26.5 MB) with no console errors and no failed requests.
`ui/scripts/shot.mjs` now opens the dialog on every run and takes `--export-to <dir>` to do a real
copy somewhere other than `~/Videos`.

One thing this screen fixed: `/projects` counted every clip in `clips.json`, including ones that
were never rendered, so `sample_5s` (a `clips.json` with no `clips/` folder at all) showed READY
and a thumbnail request that 404'd on every load; it now counts only clips with an `.mp4`.

**Screen "01 - Onboarding · AI models" (node 11:576) is implemented** as `components/Models.tsx`,
reached from the sidebar's Models entry, which is now a real page rather than a SOON label.
The design draws it as step 3 of a four-step wizard (Welcome / Hardware / AI models / Preferences)
whose other three steps do not exist in the file, and the card's own Khmer line says the choice can
be changed later "in Models" -- so it is built as that page, without the stepper.
A **model pack is a flag bundle**, the same idea as the Home presets, and `make_clips.py` already
had the flags: Lite is `--whisper-model small --model qwen2.5:3b`, Standard is
`medium` + `qwen2.5:7b-instruct`, Pro is `large-v3` + `qwen2.5:14b`. `JobRequest` gained `model`
and `whisper_model`, and `jobs.py` turns them into flags with no extra code. Picking a pack changes
what every job runs: measured in the browser, clicking Lite moves the footer line from
`--whisper-model medium --model qwen2.5:7b-instruct` to `--whisper-model small --model qwen2.5:3b`.
BEST FIT is computed from real VRAM, not drawn: `server/env.py` asks `nvidia-smi` for the card and
its memory (ctranslate2 only says how many CUDA devices exist), and Pro is disabled and badged
TOO BIG on this machine because large-v3 does not fit in 3 GB.
`GET /env` is the doctor script as JSON -- `check_env.py` prints for a human and returns a count,
while the UI needs the values. It reports device/model/compute, GPU name and VRAM, RAM
(`GlobalMemoryStatusEx` through ctypes, since Windows has no `os.sysconf`), free disk, FFmpeg,
Ollama reachability with the models pulled and their sizes, the Whisper sizes in the Hugging Face
cache, the three ONNX models with the `curl` line for any that is missing, and whether
`ANTHROPIC_API_KEY` is set (never the key). A test caught the cache lookup merging every candidate
folder; huggingface_hub uses exactly one, so the first env var that is *set* wins and the default
is only a fallback -- otherwise the page lists models Whisper would not find.
The design's download bar is a progress bar for a download manager we do not have (Whisper pulls
itself from Hugging Face on first use, LLMs come from `ollama pull`), so the row says what is
already on the machine and prints the exact command for anything missing.
Measured on this machine: `NVIDIA GeForce GTX 1060 · 3.0 GB VRAM`, `16.0 GB RAM`, `156.6 GB free`,
FFmpeg ready; whisper cache base/medium/small/tiny; Ollama has qwen2.5:3b (1.9 GB) and
qwen2.5:7b-instruct (4.7 GB); all three ONNX models present (0.2 / 38.7 / 35.9 MB). No console
errors, no broken icons.

**Checked in the desktop app, not only the browser.** Every measurement of screens 01, 04 and 05
above came from Chromium through the Vite proxy, which is a different path from the product:
the app loads the page from `tauri.localhost` and calls `127.0.0.1:8765` directly, through CORS,
with uvicorn as a child of `app.exe`. `ui/scripts/app-shot.mjs` drives the **real window**:
WebView2 speaks CDP, so the app is started with
`$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"` and Playwright attaches
with `connectOverCDP`. It needs the frontend built into the exe, which `tauri dev` does not do
(that loads `localhost:5173`, an origin the CORS list already allows), so the build is
`npx tauri build --debug --no-bundle` (5m43s cold, reusing the dev artifacts).
Measured: origin `http://tauri.localhost`, the app started its own uvicorn (parent `app`), all 15
sidecar calls 2xx -- `/env`, five thumbnails, `/clips`, the mp4 as 206, the vtt,
`GET`/`POST /export`, `/reveal` -- no console errors. Exporting one clip wrote the mp4, srt and vtt,
and **Open folder** really opened Explorer on that folder (checked through
`Shell.Application().Windows()`, not by eye). Closing the window left no python process and both
8765 and 9222 free.
A real window keeps its state between runs, unlike a fresh browser page: a dialog left open by one
run covers the sidebar for the next, so the script presses Escape first.

**Incident: a screenshot script started the pipeline.** The Home screen's Start button reads
`Start ${chosen.name}`, and in the app `chosen` was still `Taylor_Tomlinson.mp4` from the previous
run, so the selector `getByRole('button', { name: /Taylor_Tomlinson/ }).first()` matched **Start**
before the project card and a real job ran (`--max-clips 5 --model qwen2.5:7b-instruct
--whisper-model medium`). Every step was cached, so it re-rendered the same five clips in 76 s;
they were checked afterwards (all 1080x1920, same sizes) and the source video was never touched.
It was left to finish because killing a render can leave a half-written `.mp4`. `shot.mjs` had the
same selector and only got away with it because a fresh browser picks a different video.
Both scripts now match the card with `/^(?!Start ).*Taylor_Tomlinson/`, refuse to start while a
job is running, and check `/health` after the project click and at the end: a job that appears
is cancelled at once -- it is still in cached steps then, before any clip is written -- and the run
fails naming the click. Re-run under the same conditions: no job started.

**Drop only worked on Home -- found by the developer, not by a test.** "I can not drop video":
dragging from Windows File Explorer did nothing while the app was on Review, Models or Processing.
The Tauri listener lived inside `DropZone`, which only mounts on Home, while Tauri delivers a drop
for the **whole window**; on every other screen nobody was listening and the drop vanished without
a sign. 1D had written "dropping a file finally works properly" with no measurement, and the
Phase 1 gate repeated it -- it had only ever been true on one screen.
The listener now lives in `App`: a drop on any screen chooses the video and returns to Home, where
the Start button is. Moving it up exposed a second bug: `App` re-renders on every WebSocket message
of a running job, and with `onPath` in the effect's deps the listener was torn down and
re-registered (an IPC round trip to Rust) each time, so a drop landing in that gap was lost. A
`useRef` keeps one listener for the app's lifetime, and the registration has a `.catch` -- before,
a failed `listen` would have stopped drops with no trace.
The diagnosis split the path in two. Emitting `tauri://drag-drop` from JS
(`__TAURI_INTERNALS__.invoke('plugin:event|emit', ...)`) proved the JS side picked the path; that
cannot show whether Windows delivers a drop at all, so `ui/scripts/native-drop.ps1` does a real
OLE `DoDragDrop` with `CF_HDROP` -- what Explorer does -- pressing the mouse on its own small form
and releasing over the app. `effect=Copy` means Tauri accepted the drop.
Measured on `npm run app` with the fix: from Models, dropping `Table For Four.mp4` -> Home with
"Picked D:\Projects\clipforge\samples\Table For Four.mp4"; from Review, `How-AI-agents.mp4` ->
same; both `effect=Copy`, no console errors, no job started. Two traps on the way, both in the
test, not the app: a path written through a shell heredoc came out with single instead of doubled backslashes, so JS read them as escapes and dropped them
(build Windows paths with `String.fromCharCode(92)` in scripts), and `npm run app` rebuilds
`app.exe` as a dev build that loads `localhost:5173`, so launching that exe without Vite shows
"connection refused".

**The launch bar -- a state the Figma file does not have.** With drop fixed, the next step was
still lost: Start sat in the header of "Videos in samples/", below the drop zone and ten preset
cards, at the bottom edge of a 900 px window, while the button beside the path, "Use this file",
re-chose the file already chosen and changed nothing visible. Home now ends in a bar that is
always on screen (`LaunchBar` in `Home.tsx`; the page scrolls above it): the chosen video's name
and path, a PRESET cell and a MODELS cell each with the real flags they add, Review N clips when
the project has clips, and the only Start button. The page is a recipe -- video, preset, models
-- and the bar reads it back before anything runs. It replays a 1.4 s `animate-arrive` tint
(`index.css`) whenever the chosen video changes, keyed on its path, so a drop or a click on a
sample visibly lands. "Use this file" became "Use this path", which is what it acts on.
Lint caught the first version setting state in an effect to copy the dropped path into the input;
`DropZone` is now keyed on `dropped`, so a new drop starts it fresh with that path. It also found a
zero-width space hidden in a Khmer comment in `ExportDialog.tsx`.
Measured in `npm run app` with a real OLE drop from Review: Home with the bar reading
`Rhino Charge Ivan Carter.mp4`, its path, Podcast Clips `--max-clips 5`, Standard
`medium · qwen2.5:7b-instruct`, Review 1 clip, Start; the screenshot 250 ms after the drop shows
the tint; no console errors, no job started.

**1F: the Khmer Clip Studio UI (`design/`), started 2026-10-18.** The handoff was written for a
PyQt5 app (`QWebEngineView`, `QThread`, folders `analysis/` and `reframe/`), and this project is
none of that: a grep finds no Qt at all. Its "Option B" -- Python backend, HTML UI in a web view, a
bridge for calls and progress -- is what 1A-1D already built under other names (Tauri + WebView2
for the view, FastAPI HTTP + WebSocket for the bridge, a subprocess for the worker, `DELETE
/jobs/{id}` for cancel). `pipeline/` imports no web/CLI/console code and prints nothing; the one
place logic and output mix is `make_clips.py` (431 lines, 54 `console.print`), which the sidecar
already sidesteps. So 1F **re-skins the React screens** rather than choosing A or B, and leaves
`pipeline/`, `make_clips.py` and the API alone except for thin adapters it names.
Decisions taken with the developer: re-skin Tauri + React; `design/` replaces Figma (product name
Khmer Clip Studio, gold accent, Kantumruy Pro, Khmer UI text); the sign-in / OTP / minutes /
billing / upgrade screens are **stubs with no network**, because metering minutes of local work
needs a server and CLAUDE.md promises no uploads. Features the screens draw that the backend lacks
-- Khmer ASR and EN->KM (Phase 2), pause, a multi-project queue (Phase 3), editing cues, trimming,
manual crop, "time saved" -- are listed in the plan and get adapters or stubs, not new algorithms.

**Step 0, the foundation, changes no existing screen.** Tokens from `TOKENS.md` sit in a second
`@theme` block in `index.css`, named as in `TOKENS.md` except where they would collide with the
Figma tokens still serving old screens: accent -> `gold`, success -> `ok`, warning -> `warn`
(renamed back once the last screen moves). Five colours the screens use but `TOKENS.md` omits were
measured and added (`raised-3` #3A4152, `raised-4` #4A5266, `text-5` #5A6278, `ok-text`,
`info-ink`). The type scale is `type-page` ... `type-chip`, sized from what the screens use (14px
189x, 13px 132x, 15px 89x; weight 700 dominates at 181x) with 1.6-1.7 line height for Khmer body
text, so stacked consonants clear the next line.
Kantumruy Pro is **bundled** from `@fontsource/kantumruy-pro` 5.3.0 (OFL-1.1, pinned): Vite copies
the khmer and latin `.woff2` subsets into `dist/`, and a check of the kit page found the faces
loaded from the local server with **no** request leaving the machine; the screens themselves load
Google Fonts, which the handoff forbids at runtime.
`ui/src/kit/` holds the components, each value taken from the HTML: `Button` (primary 44 px,
`0 22px`, radius 10), `TextField` (46 px, filled, no border), `Select`, `Segmented` (light / gold /
pill), `Switch` (46x26), `Chip`, `Progress` (10 px), `Dialog` (scrim `rgba(5,7,10,.74)`, radius 18,
40 px close), `TopBar` with `WindowControls` (44x36), and the design's inline SVG icons with their
paths copied, not redrawn. The design has no switch "off" state; it is drawn from tokens
(`raised-3` track, `text-4` knob) and says so. `ui/kit.html` (dev only, not in the build) shows all
of them with strings from the screens: `http://localhost:5173/kit.html`.
Three things the checks caught: the Vite server `tauri dev` had started before the CSS edit kept
serving the old stylesheet (every new rule absent, the build fine -- restart it after a `@theme`
change); keyboard focus was invisible, because in Tailwind 4 `outline-none` sets
`--tw-outline-style: none` and `focus-visible:outline-2` inherits it, so the kit adds
`focus-visible:outline-solid` (measured after: solid 2 px gold on every control); and the window
permissions above.

**Step 1, Home (`design/screens/Home.html`), is built** as `screens/HomeScreen.tsx` with
`screens/AppSidebar.tsx`, and the app now opens on it. `screens/` holds the 1F screens and
`components/` the Figma-era ones, so the migration shows in the tree. The new Home takes the whole
window -- sidebar, window controls and drag area are its own -- while the screens not yet migrated
keep the old title bar and sidebar, whose logo now leads back to the new Home.
The new Home is a landing page, not the import page: the drop zone, samples, recent projects and
launch bar live on the old Home, now the view `projects` ("Projects របស់ខ្ញុំ"), until step 2
(`Main.html`) replaces it. Every way in leads there with something real: a tool card or "Import
វីដេអូ" picks its preset and opens it, a drop anywhere opens it with the file chosen.
The eight tool cards (`screens/tools.ts`) carry the design's Khmer strings and point at presets
in `presets.ts`, which stays the single source of whether something runs: Podcast Clips, វីដេអូវែង
-> ១០ Clips (`--max-clips 10`, matching the card), Auto Reframe and Interview & Webinar run; Silence,
English -> ខ្មែរ and Agency Batch take their PHASE badge from their preset; Auto Subtitles, the
Subtitle Studio hero and "Subtitles ខ្មែរ" in quick access are Khmer subtitles, which is Phase 2, so
they are dimmed with a badge rather than pointed at the English caption restyle. The Auto Clip
hero keeps the design's line about accurate Khmer subtitles; until Phase 2 that line is ahead of
the pipeline.
Design gaps filled from the tokens: the sidebar gains Settings (from `Projects.html`'s sidebar, the
same component) because Models had no other way in from Home; the Free plan card, Upgrade,
ចូលគណនី, ជំនួយ and Menu open `PreviewDialog`, which says the app needs no account and that these are
not built, instead of being dead buttons; the hero `basis` is 420 rather than 380, because at the
1100 px minimum window 380 just fits and both titles and buttons wrapped; chips never wrap.
Measured: in the browser, 8 tools with 4 enabled, Upgrade opens "គណនី និង Billing", the
"កែវីដេអូ" tab leaves 2, clicking Auto Reframe lands on Projects with PRESET Auto Reframe and no
job started, no horizontal scroll at 1100 px. In `npm run app`: the Home's Maximize button
toggles `false -> true -> false`, Minimize minimises, a real mouse drag on the empty top row moved
the window by exactly the mouse's (120, 80) twice, a real OLE drop on Home opened Projects with
`Out of Pocket.mp4` chosen, and `app-shot.mjs` (which now reloads to Home and reaches Models
through Settings) still runs Review and Export with no problems.
One test trap: a script that minimised the window and then dragged it got (0, 0) -- the same drag
from a normal window works every time.
**Scrollbars, found by the developer** ("when minimize form i see vertical scroll bar"): headless
screenshots draw no scrollbars, WebView2 does. Measured in the app with the window restored
down: the document never scrolled, but the Home's `main` did (828 px in 794 at 1426x794, 1081 in
694 at the 1100x700 minimum), with Windows' default 15 px light scrollbar on the dark UI, because
`color-scheme` was `normal`. Worse, the top row with the window buttons and the drag area sat inside
that scroller, so scrolling down took the Close button and the drag area off screen. Now `:root`
has `color-scheme: dark` and every element a thin `raised-3` scrollbar (10 px), the top row is
outside the scroller, and the content keeps `scrollbar-gutter: stable` so the cards do not jump
when the bar appears; measured after, scrolling 387 px to the bottom leaves Close at y = 20.
The project has no formatter configured: `npx prettier` fetched one with its defaults and turned a
file to semicolons and double quotes; the house style is no semicolons, single quotes, ~100 cols. And one leftover worth fixing later: choosing a video that
has never been processed asks `/projects/<name>/clips`, which 404s by design, and the browser logs
that 404 although the client handles it.

**Cleanup before step 2** (asked for: "optimize code and clean code"). Every removal was checked,
not guessed: lint went from 4 warnings to 0 -- `stepStates` (logic, not a component) moved out of
`Pipeline.tsx` into `src/progress.ts`, the Review transcript resets through a `key` instead of
`setState` in an effect, and `connect()` no longer clears the error before its first `await` (the
Retry click does; the one remaining lint hit on calling it from the mount effect is a false positive,
silenced on that line with the reason). The focus ring the kit needed in ten places is
`kit/styles.ts` `focusRing`, so the Tailwind 4 `outline-solid` fix lives once. Three SVGs nothing
imported were deleted (`pause`, `play-big`, `step-check`), and an AST scan found five Python imports
nothing used (`build_ass`, `compute_crop`, `render_clip` in `make_clips.py`, `FFmpegError` in
`render.py`, `config` in `jobs.py`), each confirmed not re-imported through those modules. After:
490 tests pass, `make_clips.py --help` runs, `shot.mjs` reports no problems.

**Step 2, Import (`design/screens/Main.html`), is built** as `screens/ImportScreen.tsx`, the view
`projects` ("Projects របស់ខ្ញុំ"). It replaces the Figma-era Home, which is deleted along with its
launch bar; `flagsOf` moved to `presets.ts`. It takes the whole window like Home: the kit `TopBar`
(whose logo now leads back to Home -- Main.html has no other way back), the "Projects ថ្មីៗ" sidebar
with real projects and Khmer relative days ("ថ្ងៃនេះ", "ម្សិលមិញ", "៣ ថ្ងៃមុន" from
`screens/khmer.ts`), and the real output folder, which `/health` now reports as `output_dir`.
**"ជ្រើសឯកសារពីកុំព្យូទ័រ" is a real Windows Open dialog**: `tauri-plugin-dialog` and
`@tauri-apps/plugin-dialog`, both pinned to 2.8.1 (17 days old; 2.8.3 was four days old and the
newest crate is a 3.0 alpha), with the capability granting only `dialog:allow-open`. In a browser
the button says it cannot read a path and focuses the path field.
What the design draws that the pipeline lacks, and what the screen does instead: the YouTube link
became the file-path field (the app downloads nothing); video language and subtitles offer English
and show ខ្មែរ / mixed dimmed as Phase 2; clip length has no flag, so its three options are disabled
under "AI picks 15-90 s"; "[២៣] នាទីនៅសល់" is hidden (no accounts); the hardware line names the
real device and model pack instead of an invented "about 5 minutes per hour"; ImportLowMinutes.html
is not built, there being no minutes. Clip count 5/10/15 is real (`--max-clips`) and starts from the
tool chosen on Home (Long Video -> 10), which a "ឧបករណ៍ ... ប្ដូរ" line now shows, since the design
gives the chosen tool no place. The app no longer picks the first sample as the chosen video; the
drop zone starts empty and shows a chosen state (tick, name, path) that the design does not draw.
Two layout bugs caught by measuring, both fixed: with the tool line and the samples row the start
button fell below a 1440x900 window, so the footer is `sticky`; and `sticky bottom-0` sat 40 px
above the bottom with content scrolling beneath it, because Chromium measures it from the scroll
container's content box and `main` had `pb-10` -- `main` now has no bottom padding.
Measured: in the browser, nothing chosen -> Start disabled, 7 options disabled, clips ៥ from Auto
Reframe; a sample chosen -> Start enabled, no job; the CTA stays on screen at 1280x800 and at the
1100x700 minimum. In `npm run app`: the Open dialog appears in 0.2 s, typing a path and Enter chose
`How-AI-agents.mp4`, Escape left the choice alone, a real OLE drop on Home landed on Import with
`Out of Pocket.mp4` and Start enabled, and `app-shot.mjs` still reaches Review and Export. One test
trap: `execFileSync` blocks Node's event loop, so a Playwright click started before it is not sent
until it returns -- click, await, then drive the dialog.

**White border and a window taller than the screen -- found by the developer** (screenshot: "why
have white border around form"). Two things in one picture. The 1px white line around the window is
Tauri's `shadow`, on by default: its own schema says that on Windows `true` "will make undecorated
window have a 1px white border" (on Windows 11 it means rounded corners instead). It is now `false`;
measured from screen pixels after, the outermost columns and rows are the app's own `#0B0D11` /
`#101318`. The cost is no shadow and square corners on Windows 11. The same screenshot showed the
start button under the taskbar: the window was 1440x900 logical, and a 1920x1080 screen at 125%
leaves 1536x824 above the taskbar, so 95 physical px hung below it -- the sticky footer was on screen
in the page and off screen in Windows. A smaller fixed size would only move the problem (150% leaves
less), so the window now starts hidden (`visible: false`) and `fit_to_work_area` in `lib.rs` clamps it
to the monitor's work area, centres it, then shows it; `minHeight` went from 700 to 640 so 150%
fits too. Measured after: 1800x1030 at x=60 on a 1920x1030 work area, `fits: True`.

**Step 3, Processing (`design/screens/Processing.html`), is built** as `screens/ProcessingScreen.tsx`,
the view `job`, full-window like Home and Import (keyed on the job id, so a new job starts clean).
The design's steps are our six, each with a Khmer line for what it does now; the headline follows
the job state (running / done / failed / cancelled); elapsed time is a client-side clock. The live
panel has two tabs: **Transcript** -- the first lines of `transcript.json`, which a new
`GET /projects/{name}/transcript` returns once transcribe is done (name guarded like the other
project routes), with the lines inside the chosen clips highlighted gold once highlights are done --
and **Log**, the pipeline's own lines from the WebSocket. Not drawn because we do not have them: a
percentage and an ETA (the step times vary from 0.1 s to 8 min, so any number would be invented).
"You can close this window" became "do not close the app while it runs", because closing kills the
sidecar and the job with it. Pause is drawn disabled (no pause in the pipeline). Queued.html is not
built: one job at a time is a rule (`409`), and a queue is Phase 3 batch. Import's Start button
reads "មើលការដំណើរការ" while a job runs and leads back here.
**Progress was lying on every re-run, fixed in `server/jobs.py`.** Starting a video that had run
before showed "ជំហាន ៦ / ៦" and every step "cached" at 0 s while the job then rendered for 26 s.
Three causes: (1) captions and render are never cached -- `make_clips` rebuilds every `.ass`, and an
`.ass` newer than its `.mp4` makes `render_clip` render again -- so `steps_redone()` now always
includes them; (2) a step that is not cached counted as done because its file *existed*, which an
overwrite from the last run satisfies, so `steps_on_disk(out_dir, since)` counts a file only when
its mtime is at or after the job's start (1 s slack for the Windows file clock); (3) FFmpeg writes
the `.mp4` in place, so it exists from the first frame and render read "done" 8 s early -- render,
the last step, now finishes when the process does. Measured on the wildlife video with warm caches:
0 s "៤ / ៦" with Subtitles active, 10 s "៥ / ៦" with Render active, 20 s "Clips រួចរាល់ហើយ!" and
"៦ / ៦"; cancelling right after Start reads "បានបោះបង់" with "៤ / ៦" and returns to Import; no
console errors, no failed requests. Checked in the browser against the real sidecar; not yet in
the desktop window.

**Step 4, Review (`design/screens/Review.html`), is built** as `screens/ReviewScreen.tsx` with
`screens/ReviewDialogs.tsx`, full-window, replacing the Figma-era `Review.tsx` and `ExportDialog.tsx`
(deleted with the 12 SVGs only they used). The list shows only clips with an `.mp4` -- `clips.json`
also holds the ranked clips past `--max-clips` -- each with a checkbox for export, the real thumbnail
with its rank, the letters, and the score coloured as in the design (80+ gold, 70s `raised-2`, below
`raised-3`). Sorting offers **លំដាប់ AI** (the default), ពិន្ទុ and ពេលវេលា: the design's "score"
order is not the ranking, because the rubric clusters and `rank_clips` orders the clips -- on
`Taylor_Tomlinson` clips #3 and #4 score 90 under #1 at 80. The design's "ពិន្ទុជាលេខគំរូ" note is
dropped, since these scores are real. "រក clips បន្ថែម" is real too: it re-runs with
`--max-clips` raised by up to 5 from the ranked list, so no transcribe and no LLM; it is disabled
with "AI found N clips -- all rendered" when the list has nothing more.
The preview is the real `<video>` with the design's buttons (previous / play-pause / next, time),
sized 9:16 to the window instead of a fixed 270x480, plus a thin seek bar the design lacks (reviewing
a clip needs to jump). The detail panel shows the "why AI picked this" card with the real Hook /
Flow / Value letters and the LLM's reasons (clips scored before the rubric say so), and the clip's
real cut points in the source with a bar of where it sits; the title and both cut fields are
read-only and say why -- the pipeline has no flag for a manual trim or a title edit. "កែ Subtitles"
opens a dialog with the two caption settings the pipeline has (`--caption-words`, `--caption-color`
from `CAPTION_COLOR_PRESETS`) that re-renders every clip, until Subtitles.html (step 5) exists.
The footer exports for real: the destination field starts at the sidecar's default, Export writes
MP4 + SRT (ExportDone.html's "MP4 9:16 1080p + SRT") for the ticked clips, and a dialog lists the
files with an Open folder button, until ExportDone.html (step 6).
Two sidecar bugs this screen turned up, both fixed with tests: (1) `/projects` took a DB project's
clip count from the database, which only a `done` job writes, so `The-Future-Mark-Zuckerberg` (an
interrupted job, then rendered by the CLI) showed 0 clips with five `.mp4`s on disk -- every
project now counts rendered clips from disk; (2) **Open folder on a file never worked**: the old
dialog revealed the folder, so the `/select` branch had never run. `subprocess` with a list quotes
`"/select,C:\...\01 - Comedy vs. Real Life (2).mp4"` as one argument when the path has spaces,
and Explorer then opens **Documents** -- measured through `Shell.Application().Windows()`. The
command is now a string, `explorer /select,"<path>"` (`export.explorer_select`), and the same check
after shows a window on the export folder.
Measured: in the browser, 5 rows and 5 thumbnails, the video 1080x1920 and at 1.5 s after Play,
next/previous, time sort `#2 #3 #5 #1 #4`, score sort `#3=90 #4=90 #1=80 #2=80 #5=80`, unticking
four reads "បានជ្រើស ១ ក្នុងចំណោម ៥ clips" / "Export ១ Clips", exporting wrote
`01 - Comedy vs. Real Life.mp4` + `.srt` and a second export added `(2)` beside them; no horizontal
scroll at 1440, 1280 and the 1100x700 minimum, footer on screen; no job started, no console errors.
In the desktop app (`tauri.localhost`, uvicorn started by `app.exe`): the same Review, play, export,
and Open folder opening Explorer on the export folder; closing the window freed 8765 and 9222.
`shot.mjs` and `app-shot.mjs` drive the new Review (and reach Models through Home -> Settings, since
Review has no sidebar). `src/vtt.ts` has no importer now and is kept for the Subtitles screen.

**Step 5, Subtitles (`design/screens/Subtitles.html`), is built** as `screens/SubtitlesScreen.tsx`,
opened by "កែ Subtitles របស់ clip នេះ" on Review (the interim caption dialog is gone). Decided with
the developer: **thin flags** for style, and cue text **read-only** for now.
The pipeline had two caption flags; the screen draws a dozen settings. Five thin flags were added,
each only setting a `config` value that already existed (`config.apply_caption_style`, called after
`apply_aspect`): `--caption-size` (70-120 % of the computed font; past 120 a 16-character line no
longer fits 1080 px), `--caption-outline` (0-8 px), `--caption-case upper|original`,
`--caption-position auto|top|middle|bottom` (top sits under `CAPTION_SAFE_TOP` + 4 %; a forced
position also makes `anchor_for` ignore the split seam, which is the only line changed in
`captions.py`), and `--no-captions`, which still writes `.ass/.srt/.vtt` but passes no `.ass` to
render and forces it (render otherwise keeps an `.mp4` that no newer `.ass` invalidates).
`JobRequest` carries them, and a test checks they reach the command line. Measured on the rhino
clip at a spoken cue: default lower third in capitals, `top` + 85 % + original case + 2 px outline
at the top, and `--no-captions` with none.
The screen: the left column is the clip's `.vtt` (28 cues on `Taylor_Tomlinson` clip 1) with the
playing cue marked "កំពុងចាក់" and followed while the video plays, a click seeks; the timeline in
the footer draws every cue as a block, gold for the playing one, and seeks on click or arrow keys;
Safe zone toggles bands drawn from `CAPTION_SAFE_TOP`/`CAPTION_SAFE_BOTTOM` (8 % / 18 %, the
numbers `check_cues` uses) rather than the design's 11 % / 22 %. Style lives in `src/captionStyle.ts`
as one `CaptionStyle` in `App`: Presets are flag bundles (គ្មាន captions, Bold លឿង, Karaoke = green,
ស្អាត ស = white, original case, 2 px, 90 %) and a style matching none reads "style ផ្ទាល់ខ្លួន";
Font has size, capitals and stroke; Effects has position, words per cue and the active-word colour.
Drawn but disabled, each saying why: editing text and search/replace (cues are rebuilt from the
transcript on every render), "AI is unsure of this word", font family (Khmer font comes with Phase 2
subtitles), shadow (fixed 1 px), animations other than the real Pop (active word at 110 %), Box and
Neon presets (need ASS box/glow), Khmer line splitting (Phase 2), the Layout/Background/Tracker
toolbar (Reframe is step 7), and the editor-tools column except Captions. "ប្រើ style នេះលើ clips
ទាំង N" is ticked and locked: one run renders every clip with one style. The preview plays the
**rendered** clip and says new style shows after Save; Save is `--redo render` with the style.
Three bugs found while measuring, fixed: (1) a re-render passed the preset's `--max-clips 5`, so a
10-clip project would have been cut to 5 -- re-render now sends the rendered count; (2) during
`POST /jobs` the app kept the **previous** job's status, so Processing flashed "Clips រួចរាល់ហើយ!"
from the last job (and a first job flashed Import) -- `useJob.start` clears the status and `App`
shows "កំពុងចាប់ផ្តើម job..." while `starting`; measured after: headlines go blank -> កំពុងបង្កើត
Clips -> Clips រួចរាល់ហើយ!; (3) the leftover `animate-arrive` CSS of the deleted launch bar.
Measured: in the browser 28 cues and 28 timeline blocks, the playing cue moves with playback,
clicking cue 6 seeks to 6.4 s, safe zone 2 bands -> 0, Bold preset selected by default, Karaoke
turns the colour green, a custom style deselects every preset, no horizontal scroll at 1440/1280/
1100x700 with the footer on screen, back returns to Review, no job without Save, no console
errors. Saving from the UI ran `--max-clips 1 ... --caption-position top --redo render` on the
rhino clip and the next save restored `auto` (both read back from the `job` table). In the desktop
app (`tauri.localhost`, own uvicorn) the same screen loads 28 cues with no problems, and closing the
window freed 8765. `shot.mjs` and `app-shot.mjs` open Subtitles from Review on every run.
Not known to the app: which style an existing clip was rendered with (the pipeline records no
style), so the screen starts from the `config.py` defaults.

**Live preview on Subtitles (2026-10-20), planned with the developer before building.** Asked for:
see a caption change at once, and the Captions button in Editor tools opens and closes the
Presets/Font/Effects panel. A burned clip cannot show a new style without drawing captions twice, so
the preview needs a clip **without** captions plus captions drawn by the page:
- `--clean-only` renders only `clips/clip_XX_clean.mp4` (no `.ass` burned, `render_all(suffix=)`) and
  skips the caption step entirely -- rebuilding `.vtt` with default flags would make the cue list
  disagree with a clip rendered in another style. On demand only (the developer's choice): the screen
  offers "បង្កើត preview ភ្លាមៗ", which runs it without leaving the screen; ordinary renders are not
  slower. The `clean` kind is served by `/file?kind=clean` but is not in `media.EXPORTABLE`. A clean
  copy older than `clips.json` is ignored (the AI picked again, clip 1 may be another clip); a style
  re-render rewrites `clip_XX.mp4` but not the picture, so it does not invalidate the preview.
- `GET /projects/{name}/clips/{i}/cues?words&size&position` returns the cues as the render would
  draw them, computed by `captions.py` itself (`wrap_into_cues`, `line_positions`, `anchor_for`,
  `word_intervals`, `display_word`). `apply_caption_style` mutates globals and multiplies the font
  size, so `preview_cues` holds a lock and restores every value it touches (a test calls it twice).
- Split clips: the render puts captions on the seam, and the plan that says which shots are split
  was computed and thrown away. Measured on `Taylor_Tomlinson` clip 1: the first preview drew the
  caption over the second speaker's face. Planning now also writes `clip_XX_layout.json`
  (`save_layout_summary`: each shot's kind + the dominant one), and `/cues` uses it; clips without
  it say so and offer to regenerate. After: lines at y 913/1004 of 1920 around the seam at 960.
- `CaptionOverlay` draws the cue in Montserrat ExtraBold (bundled, `@fontsource/montserrat` 5.3.0,
  OFL) with the active word coloured and stretched vertically 110 %. **ASS font size is not CSS
  font-size**: libass scales "110" to the font's win ascent + descent (Montserrat ExtraBold
  1109 + 453 of 1000 units), so the em is 0.640 x 110 -- measured from the `.ttf`, after the first
  side-by-side showed the preview 1.56x larger than the real frame. After the fix the preview and a
  frame of the rendered clip at the same time match in size and position.
Measured: style changes reach the preview in 55-84 ms with no job; the Captions button closes the
panel (preview 648 -> 1008 px wide) and reopens it; "បង្កើត preview" on the five Taylor clips took
52 s and left every `clip_0X.mp4` untouched; `--clean-only` on the rhino clip left `clip_01.mp4`,
`.vtt` and `.ass` byte-identical. In the desktop app: the clean video paints (mean brightness 78,
not black), two overlay lines, toggle and position changes work, no console errors. A browser test
note: a canvas cannot read a video from another origin (`127.0.0.1:8765` vs `tauri.localhost`), so
the app check screenshots the stage instead.

**Step 6, Export done (`design/screens/ExportDone.html`), is built** as
`screens/ExportDoneScreen.tsx`, the view `exported`: Export on Review now opens it with the real
`ExportResult` (the interim `ReviewDialogs.tsx` is deleted). Header: "Clips N រួចរាល់ហើយ!", the
real folder and what was written ("MP4 9:16 1080p + SRT", aspect and short side from `ffprobe`),
បើក Folder (`/reveal`, Explorer on the folder) and Project ថ្មី (Import with nothing chosen); the
crumb leads back to Review. Three panels of the design have no data behind them and hold real
numbers in the same shape instead: "time saved, 1 h 40 min vs about 2 h by hand" became **what AI
picked out of the video** -- the exported clips' total against the source length from
`transcript.json`, as two bars (`Taylor_Tomlinson`: 34 s out of 1:09:51); "AI-suggested TikTok
caption" became **the hook the LLM wrote** for the selected clip (`Clip.hook`, in the video's
language; a Khmer post caption does not exist); "Free plan minutes" became **the files written**,
with sizes and anything skipped. Each card has the real thumbnail, duration and resolution, and
"ចម្លង caption" copies title + hook.
Measured: in the browser after a real export, heading "Clips ១ រួចរាល់ហើយ!", subtitle
"... · MP4 9:16 1080p + SRT", "៣៤ វិនាទី", one card, two files, no problems. In the desktop app the
same, and the two things a browser test cannot show: "ចម្លង caption" put
"Comedy vs. Real Life\nAll of your time is spent..." on the Windows clipboard (read back with
`Get-Clipboard`), and បើក Folder opened Explorer on the export folder. Both check scripts now wait
for this screen instead of a dialog.

**Full re-test of steps 1-6 (2026-10-19) found one real bug.** Review kept its checkboxes, selected
clip, sort and folder in its own state, and Review unmounts when Subtitles or Export done opens. So
unticking 4 of 5, opening Subtitles and coming back read "បានជ្រើស ៥ ក្នុងចំណោម ៥" on clip 1, and
the next Export wrote **five** clips -- measured, not supposed. Those choices now live in `App`
(`screens/reviewChoices.ts`, keyed by project, storing the clips you *un*ticked so clips added by
"រក clips បន្ថែម" start ticked). Measured after: back from Subtitles and from Export done both read
"១ ក្នុងចំណោម ៥" on the same clip, and the export wrote one clip. The rest of the re-test passed
unchanged: 507 tests, tsc, lint, production build; in the browser every screen with
`problems: none`, a real job on the rhino video (0 s "៤ / ៦" -> "៥ / ៦" -> done at 30 s, cancel ->
"បានបោះបង់"), Review and Subtitles deep checks; in the desktop app Models, Review, Subtitles, Export
done, the clipboard and Explorer, with 8765 and 9222 freed on close.

**Startup time -- "when I open app very slow" (2026-10-20), measured, not guessed.** From launch to
the UI holding `/health`, `/videos` and `/projects`:

| how it is opened | window visible | sidecar listening | UI has data |
|---|---|---|---|
| `npm run app` (tauri dev) | 5.4 s | 8.1 s | **8.3-9.0 s** |
| built `app.exe` (`npx tauri build --debug --no-bundle`) | 0.1 s | 2.7 s | **2.8 s** |
| first open after a reboot | -- | Python import alone 16.5 s | ~17 s+ |

Where `npm run app` spends it: npm + Vite + the Tauri CLI + `cargo` before the exe even starts
(~5 s), then Vite transforms the modules in the page (~1.4 s) while the sidecar starts. The sidecar
alone is 1.2 s from spawn to listening, but 2.6 s inside the app because WebView2 starts at the same
moment; warm `import server.app` is 1.1 s, most of it `fastapi`, so deferring `numpy` (0.14 s) is not
worth it. The endpoints are not the problem: `/health` 12 ms, `/videos` 4 ms, `/projects` 12 ms,
`/env` 90-140 ms (Models page only). The cold 16.5 s is file access on first import after a reboot
(Defender scanning `.venv` is the usual cause on Windows; not changed, it is the developer's call).
One fix in code: the UI asked the sidecar once per **second**, so data could arrive up to 1 s after
the sidecar was ready; it now asks every 250 ms with the same 30 s budget -- measured after, data
0.1 s after the port opens (2.68 -> 2.76 s). `npm run app` is for changing code (hot reload); opening
the built exe is the fast way to use the app, but it must be rebuilt to pick up UI changes, and
`npm run app` overwrites it with a dev build that loads `localhost:5173`.

## Later phases (context only — do not build yet)

- Phase 2: MediaPipe face tracking reframe, bilingual EN + Khmer subtitles, interview Q&A finder, long video → 10 clips.
- Phase 3: gaming audio signals, brand kits, batch queue, installer.
- Presets are JSON configs over the same engines (e.g. `presets/podcast.json`).

## Design references

- **Source of truth since 2026-10-18: `design/`** (Khmer Clip Studio handoff). `design/HANDOFF.md`
  holds the rules and the screen order, `design/TOKENS.md` the colours, type and components, and
  `design/screens/*.html` one static screen each (open `design/index.html`, compare at 1280x800).
  It replaces the Figma file for the UI; the Figma-built screens stay until each is migrated (1F).
- Figma UI (superseded, kept for history): https://www.figma.com/design/SycDviWBBpHlK901HhvFWK
- Caption fonts are unchanged: Montserrat ExtraBold + Battambang Bold, keyword #FFD23F.

## Commands

- Setup (Windows PowerShell): `py -m venv .venv; .venv\Scripts\activate; pip install -r requirements.txt`
- GPU libs (optional, ~1.4GB): `pip install -r requirements-gpu.txt`
- Check env: `python check_env.py` (must show all OK before running the pipeline)
- Slow tests (real Whisper model): `pytest -m slow`
- Run: `python make_clips.py path/to/video.mp4 --max-clips 5`
- Aspect: `--aspect 9:16|4:5|1:1|16:9` (default 9:16). Each writes to its own folder
  (`clips/`, `clips_4x5/`, ...). Portrait and square stack split panels vertically; 16:9 puts
  them side by side, since a 1920x540 panel is too shallow to frame a face.
- Layout: `--layout` takes a comma-separated list of the layouts the planner may use, and it
  picks one per shot, the shots coming from scene detection: `auto` (every layout), `fill`/`face`
  (crop to the face), `split`, `three`, `four`, `center`. You choose what the planner *may* use and
  it chooses what *fits*, which is how OpusClip's reframe dialog works. Before putting three and
  four into `auto`: the three-person podcast moved 34 s from split to three (correct -- three
  people are on screen) and the two-person interview did not change at all.
  The planner tries the widest grid first (four, then three,
  then split) and takes the biggest N faces sorted left to right, provided neighbours are at least
  `MIN_FACE_SEPARATION` apart and no panel exceeds `PANEL_MAX_UPSCALE`. `panel_rects()` owns the
  geometry: split is two halves, `three` is **one big panel over two small ones** (1080x1280 plus
  two 540x640, matching OpusClip's reference), and four is a 2x2 grid of 540x960 -- four stacked
  rows would be 1080x480, too shallow for a face, the same reason 16:9 stacks side by side. The
  biggest face takes the big panel. Render stacks them with `vstack`/`hstack` when the panels form
  one column or row and `xstack` with pixel positions when they do not.
  When a crop is too small for its panel, `panel_box` **widens the crop** instead of upscaling
  past `PANEL_MAX_UPSCALE`: the big panel of `three` needs 360x427 to stay within 3x, while a 96 px
  face at `PANEL_ZOOM` 3 gives only 243x288 (4.44x). Growth stops at `PANEL_ZOOM_MAX` (6x face
  height), past which the panel would be a room with a tiny face in it, and the layout is rejected
  instead. Even sizes round down, so the growth adds 1% or the rounding lands just over the limit
  (3.0047x) and the layout is rejected for nothing.
  Measured on the 70-min podcast, which is a three-person show (3 faces in 35 of 60 sampled
  frames): the shot at 478 s renders three panels at 2.98x, and clip 4 is three panels end to end.
  Captions move to the last horizontal seam for any multi-panel shot, which is the only band that
  covers nobody's face, and stay in the lower third on one-panel shots -- decided **per shot** by
  `captions.anchor_for` / `line_positions` (seam from `panel_rects` via `last_seam`), centred for the
  cue's real line count. It used to be decided per clip from the dominant layout
  (`caption_margin_for`, now removed): measured on `Taylor_Tomlinson`, a close-up inside a mostly-split
  clip got its caption at y 1042-1087 near the mouth, `three` shots in a mostly-single clip kept the
  lower third over the small panels' faces (1398-1443), and `three` captions sat ~100 px under the
  seam because the margin assumed three lines. After (re-rendered, read from the real `.ass`):
  single 1398-1443, three 1280, split 960, and the Subtitles preview agrees on all five clips.
  Found by the developer on the Subtitles screen ("Auto don't follow rule"); clips rendered before
  2026-10-20 keep the old placement until re-rendered.
  Multi-panel layouts can be drawn as cards: `--panel-gap <px>` shrinks each panel's image and
  `pad` fills the gap with `--panel-color`, so the sharpness maths uses `panel_inner()`, not the
  panel rect. The gap is **off by default**: on dark footage the white border read louder than the
  picture. `PANEL_CORNER_RADIUS` (28 px) rounds the corners through a mask PNG that
  `corner_mask()` builds once per layout kind and overlays before the captions are burned -- `geq`
  would evaluate a per-pixel expression on every frame (1080x1920 x 780 frames for a 26 s clip),
  while the mask costs one extra input and about 15% of render time. A mask input can only be
  consumed once, so it is `split` per segment that uses it, and the inputs go before `-t` or ffmpeg
  reads `-t` as an option for the mask. So
  `--layout fill,split` allows both and `--layout fill` forbids split entirely. `center` is always
  the last resort, because a shot with no face still has to render. `--layout split` on its own
  keeps the old forced behaviour: a one-face shot is still split, using the global seats.
  (Default auto: split on two-shots, face crop on close-ups, centre crop when no face is found.) On a close-up where the face moves more than 8% of the frame
  width across the shot's sample frames, the crop follows it: `reframe` samples the shot every 1 s
  (40 points max), smooths the path (moving average + 2% deadzone) and emits one FFmpeg
  `crop=...:x='if(lt(t,..),..)'` expression, so FFmpeg recomputes x every frame. Measured on the
  shot at 33.78-40.46s of the 47-min interview: a static box left the face jammed against the frame
  edge in 12 of 26 sampled frames, the moving box keeps it at x=200-670 of 1080. It costs one frame
  grab per second of moving shot (five clips: 40s -> 54s with warm caches), and only 2 of 44
  segments in those five clips move enough to trigger it.
- `fit` keeps the whole frame: the source is scaled to the output width and centred over a blurred,
  scaled-to-cover copy of itself. It is chosen when a shot has no face, no person or animal **and**
  the picture is still, which is how a slide differs from a blurred animal running past. Measured
  `motion_level` (mean frame-to-frame difference, 160 px wide): webinar slides 0.03-0.25, the rhino
  charge 51-66, so `FIT_MOTION_MAX` is 1.0. On a 12-min webinar 7 of 16 sampled shots become `fit`
  and 8 stay `single` for the webcam; the podcast, interview and wildlife clips plan identically.
  Without it a 1280x720 slide kept 32% of its width and lost all its text. The caption's normal
  lower-third position lands on the blurred band below the video block, covering nothing.
- Split-panel sharpness. Three things decided how soft a panel looks, all measured on a 1280x720
  podcast whose panels are 1080x960: (1) a framed photo on the wall was detected as a face 29 px
  tall and blown up 16.9x for 16 s of a clip, so a detection under `FACE_MIN_HEIGHT_RATIO` (8% of
  frame height) is dropped. 8% comes from sampling 40 frames of each test video: the fakes sit at
  2-5% of frame height and never move (cx range 0-88 px over 70 minutes), real faces start at 10%
  (interview: 14%) and move across hundreds of pixels. A second photo at 5% was still passing the
  old threshold and took the crop onto a shelf for 17 s of a clip, with no person on screen. The
  subject of a single-face layout is the **biggest** face, not the leftmost, for the same reason; (2) a shot whose panel would need more than `PANEL_MAX_UPSCALE` (3x)
  now renders as a single face instead - one sharp person beats two blurry ones; (3) `PANEL_ZOOM`
  2.0 -> 3.0 takes the upscale from 2.84x to 1.90x, and `PANEL_ZOOM_MIN` keeps the box no wider
  than the room on either side of the face, since a clamped box pushes the face to the panel edge.
  Panel boxes come from the faces in that shot, never from `seats`: seat geometry is a median over
  the whole video (measured: seat face 108 px while the face in the shot was 182 px), which framed
  people against the panel edge. Seats still decide *who* is who. `SHARPEN` (`unsharp`) runs once
  after scaling and before the captions are burned. Worst upscale across the five clips: 1.97x.
- Captions: `--caption-words 2..8` (default 5) and `--caption-color yellow|green|cyan|orange|white|#RRGGBB`
  (default #FFD23F from the design tokens; OpusClip uses green). Style (screen Subtitles):
  `--caption-size 70..120` (%), `--caption-outline 0..8` (px), `--caption-case upper|original`,
  `--caption-position auto|top|middle|bottom`, `--no-captions` (sidecars still written),
  `--clean-only` (only `clip_XX_clean.mp4` for the live preview; captions step skipped)
- Encoder: `--encoder auto|nvenc|x264` (default auto: NVENC when the GPU accepts it).
  Measured on a 17.5s clip at 1080x1920, VMAF against lossless: libx264 medium 12.6s/6.7MB/97.96,
  h264_nvenc p5 cq26 2.9s/7.0MB/98.02. Rendering five clips went from 1m25s to 19s.
- Full video: `--full` renders the whole video as one vertical file into `output/<name>/full/`,
  skipping highlight selection. It does not write `clips.json` -- it used to, and the next ordinary
  run then read that cache and rendered the whole video as "clip 1". Measured on the 47-min
  interview: 360 shots, 17,209 caption cues, 15m30s total (4.5 min planning, 10m17s render), 959MB.
- Review output: `python review.py <video name> --frames`
- Test: `pytest -q`
