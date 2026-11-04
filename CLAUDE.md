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

**Import, group 1 of the OpusClip comparison (2026-10-21).** The developer shared OpusClip's
import settings; the low-risk part was built, the rest is planned separately:
- **AI model: Auto / Lite / Standard / Pro** on Import, the same packs as the Models page (one
  state, `packChoice` in `App`). Auto is the BEST FIT for the real VRAM from `/env` (fetched after
  connecting, not blocking startup; until it answers Auto means Standard, the old default). Pro is
  disabled on this 3 GB card. Not named "ClipAnything": OpusClip's models differ in *what* the AI
  reads, ours only in model size -- the pipeline is transcript-only, i.e. ClipBasic. Measured speech
  share: podcasts and the webinar 78-88 %, the two rhino videos 38-41 % (one clip each), which is
  where a multimodal picker would matter (Phase 2-3).
- **"360p · 35:25 · 24 fps"** under the chosen video: `GET /probe?path=` runs `media.probe_video`
  (now also returning `seconds` from `format=duration`), video suffixes only.
- **រក្សាទុកការកំណត់ខាងលើជាលំនាំដើម** saves clip count, AI model and caption style to
  `localStorage` (`src/defaults.ts`, validated on read, every access in try/catch) and `App` starts
  from it. Measured in the desktop app: Lite + 10 saved, app closed and reopened, Import reads
  Lite + 10; reset to Auto + 5 afterwards.
Not built yet, because the rest of the UI reads only `clips/`: `--aspect` writes `clips_1x1/` and
`--full` writes `full/` without `clips.json`, so a button for either would run a job whose result
Review never shows (it would show the old 9:16 clips instead).

**Step 7, AI Reframe (`ReframeSetup.html`, `ReframeProcessing.html`, `ReframeResult.html`), is
built.** The design's Reframe is not clip-finding: it turns the **whole** horizontal video vertical,
which the pipeline already does as `--full --aspect --layout`. Decided with the developer: a
subtitles toggle (on by default), the Result **read-only**, and the way in is Home's Auto Reframe
card, which now opens the dialog over Home instead of Import.
- `screens/ReframeSetup.tsx` (dialog, 640 px): a **real frame** of the chosen video
  (`GET /probe/frame?path=&at=` -> FFmpeg JPEG to stdout, nothing written beside the original) with
  the crop box for the aspect (9:16 on 16:9 = 31.64 % wide, the design's number), "720p · 0:55" from
  `/probe`, aspect 9:16 / 1:1 / 4:5 / 16:9, layouts Fill / Fit / Split / 3-4 people (the design says
  "soon" for 3-4; `three,four` exist, so it is on), ScreenShare and Gameplay disabled, Fit's inner
  4:3 / 1:1 and black / brand backgrounds disabled (only original size and blur exist), the
  subtitles switch (`--no-captions`), earlier reframes of this video, and an estimate from the
  measured rate (47-min interview -> 15.5 min), not the design's "[13] minutes used". Layouts
  default to all of them (= `--layout auto`, what was tested) rather than the design's Fill + Fit.
  The kit `Dialog` now scrolls (`max-h` + `overflow-y-auto`), since this one is ~850 px tall.
- `screens/ReframeProcessingScreen.tsx`: five real steps -- audio, transcribe, **shots and faces**
  (marker `clip_01_layout.json`, reported as `progress.planned`), subtitles, render -- plus a log
  panel. The design's "find the speaker by lip-sync" is diarization (Phase 2) and is listed as such;
  no % or ETA, as on Processing. `StepRow` is shared with Processing now (`screens/StepRow.tsx`).
- `screens/ReframeResultScreen.tsx`: the rendered video, the source frame at the selected shot, every
  shot from `layout.json` coloured by layout on a timeline (click = seek), the planner's reason for
  each layout, shots/min, layout switches/min, share of time per layout, file size, and **Export**
  (`POST /projects/{name}/reframe/{folder}/export`, the same `export.plan`/`copy_plan`, so never
  overwriting). Per-shot layout / focus, "apply to similar shots" and dragging the crop box are drawn
  disabled -- they need a plan override in the pipeline. "Faces in frame %" and "speaker shown %"
  are not measured at render, so no numbers are shown.
- Sidecar: `jobs.output_folder()` mirrors make_clips (`clips`, `clips_1x1`, `full`, `full_4x5` ...),
  so a job watches its own folder; a `--full` job reports `highlights`/`boundaries` as `skipped`
  (and never as cached from an old clipping run); `GET /projects/{name}/reframe` lists `full*`
  results (`server/clips.reframe_outputs`) and `/reframe/{folder}/file` serves them, both with
  strict folder/kind checks.
- A bug the 1:1 run caught: with subtitles off the Result said "burned", because `--no-captions`
  still writes the `.ass` (for `.srt/.vtt`). `save_layout_summary` now records `captions`, and the
  Result reads it.
Measured: in the browser, a real reframe of the rhino video at 9:16 with subtitles ran in 37 s
(1080x1920, 55.7 s, 13 shots, Fill 91 % / Split 9 %, 14 shots/min), at 1:1 without subtitles in 23 s
(1080x1080, folder `full_1x1`, "Subtitles: none", `layout.json` `captions: false`); clicking shot 3
sought to 4.55 s; export wrote mp4 + srt; no console errors. In the desktop app: the dialog's real
frame loads from `tauri.localhost`, an earlier reframe opens from the dialog, the video plays and
paints (mean brightness 63), no errors. The first browser run's Export wrote two files into the real
`~/Videos/ClipForge/Rhino Charge Ivan Carter/`; they were deleted, and the test now routes the
export to the scratchpad.
**"AI don't track subject" -- found by the developer** (a 9:16 frame of dust and bushes, the
presenter's hat at the edge). The developer's four reframes all had **Fill off** (`--layout
fit,split,three,four`, `fit`, `center`, `fit`), and Fill is the only layout that follows a subject
(face -> person/animal -> motion): Fit needs a still picture and Split two people, so the planner
fell back to a centre crop -- the last run was one `center` shot for all 55.7 s. Planned at 9:16 on
the same video: Fill on = `single` 50.8 s + `split` 4.9 s, Fit only = `center` 55.7 s. The design's
label "Fill · speaker 1" made it read as a podcast-only option. Fixed: Fill is labelled "follows
faces · people · animals", the dialog warns in orange when it is off, `save_layout_summary` records
the `allowed` layouts and the Result says "Fill was off in this run -- centre crop 83 %"; and
`smooth_segments` now demotes a too-short split to `center` instead of `single` when single is not
allowed (it used to give a Fill-off run 8 % face crops). Re-rendered with Fill on: the same frames
at 14/18/22 s show the people instead of bushes. **Still open, with Fill on:** the moving-box
tracker (`tracked_box`) only follows faces; a YOLOX subject gets one static box per shot, so in the
charge (27.8-32.9 s) the box starts on the rhino's head and the rhino runs out of it.
**"Video quality issue and not smooth" -- found by the developer** (a blocky, ghosted frame at 0:43
of the Result player). The file was fine: FFmpeg decodes all 1334 frames with no error and the
frame at 43 s is clean, so the damage happened in WebView2's playback. Measured in the dev app the
developer uses: steady playback is smooth (24 decoded / 0 dropped per second for 10 s), but every
seek was slow and dropped frames, because NVENC put a keyframe only every **250 frames (10.4 s)**,
so a click on a shot had to decode up to 250 frames first: seek 101-249 ms, 0-4 frames dropped,
8 dropped in 6 s played from 38 s. `config.KEYFRAME_SEC = 2` now adds
`-force_key_frames expr:gte(t,n_forced*2)` (time-based, so any fps; both encoders) plus
`-forced-idr 1` for NVENC so they are real IDR frames: 6 -> 28 keyframes, file +2.5 % (36.1 ->
37.0 MB), same render time, seeks **11-73 ms**, 0 dropped in the same 6 s run on the first file. A
few frames (0-6, about a quarter second) can still drop right after playback starts; not explained
yet. The corrupted picture itself was **not** reproduced (re-rendering the file under an open
Result did not do it, probably because the 36 MB file was already fully buffered); two defences
went in anyway: the Result's video URL carries `&v=<mtime>` so a re-rendered file never shares
cached ranges with the old one, and the source frame beside it is fetched only when a shot is
clicked, not at every shot change during playback (it ran FFmpeg on the source while the video
played; measured after: 0 requests in 9 s of playback across shots). Also true of this sample:
the source is 1280x720 at 1.25 Mbps with bitstream errors (`illegal short term buffer state`), and
a 405x720 crop upscaled to 1080x1920 (2.67x) is soft whatever the encoder does.

**A traceback in the sidecar terminal on clicking Home -- reported by the developer.** Leaving a
screen with a `<video>` (Review, Subtitles) makes WebView2 reset the video's HTTP connection, and
asyncio's Proactor loop then fails `sock.shutdown()` on the dead socket and prints "Exception in
callback _ProactorBasePipeTransport._call_connection_lost()" with `ConnectionResetError [WinError
10054]`. Nothing breaks: the connection was meant to close. Reproduced in the real app (one
traceback in one run of Review/Subtitles -> Home). `server/quiet.py` installs a loop exception
handler from the app's `lifespan` that drops **only** a `ConnectionResetError`/`ConnectionAbortedError`
whose handle is `_call_connection_lost`; every other error still reaches asyncio's default handler
(tested both ways). Measured after: three rounds of the same repro, 0 tracebacks -- the reset is
intermittent, so this is evidence, not proof.

**"Video not smooth when reframe" -- reported by the developer** (after a Fill-only reframe of the
rhino video). The moving crop stepped: FFmpeg's `crop` on yuv420p moves only in whole even pixels,
so a 12 px/s pan in the 720p source sat still for 3 frames and then jumped 4.8 px after the 2.67x
upscale -- 75 % of frames frozen, a jump every 4th (measured on a still test picture, so only the
crop could move). `render.moving_crop` now **scales first, then crops** at output resolution with
`exact=1` (odd pixels allowed): 0 frozen frames in the same test. Only boxes with an `x_expr` take
this path, since a static crop cannot stutter and scaling the whole frame costs more; the rhino
reframe still renders in 13 s. On the real moving shot (32.9-45.1 s, handheld camera): frame-to-frame
jitter is 3.41 px with a static crop (the footage itself), 4.58 with the old moving crop, 3.68 with
the new one -- the crop's own share fell from 1.17 to 0.27 px; the rest is the camera.

**"Video not smooth when change shot" -- reported by the developer.** At a camera cut the new crop
arrived **one frame late**: scene detection returns the cut frame's exact time (frame 152 =
6.339667 s), but `build_segments_filter` wrote `trim=start=6.340` -- rounded *up* to 3 decimals --
and `trim` keeps frames with pts >= start, so the cut frame stayed in the previous shot and showed
the new picture through the old crop for one frame, then jumped again. Measured on the rhino
reframe: 7 of 12 boundaries rounded past their cut frame; in the rendered file 3 of 11 cuts showed a
clear second jump the frame after the cut (and one a smaller one). `render.trim_time` now writes
trim times with 6 decimals, 1 ms **before** the boundary (a frame is 33-42 ms), shifting start and
end alike so shots still meet with no frame lost: 0 of 11 after, still 1334 frames. A measuring
trap on the way: output frame k-1 shows source frame k (the render is one frame behind the source),
so a check that indexes both files with the same number looks at the wrong frame.

**Reframe dialog: Close scrolled away, and the preview frame was fixed -- found by the developer**
("when scroll hide button close and video timeline can not move left/right"). The kit `Dialog`
scrolled as one box, so its Close button scrolled off with the content; the button now sits outside
an inner scroller (measured at 1280x720: scrolled 403 px, Close still at y = 36, clicking it
closes). The setup preview showed one frame at 10 % of the video; it now has a range slider (mouse
or arrow keys) and asks `/probe/frame` only once the slider rests for 150 ms -- 20 key presses and
a drag sent 2 requests. No console errors.

**Live preview on every project, automatically (2026-10-22) -- asked for by the developer** ("I can
only apply caption style on Taylor_Tomlinson"; "I want live review any video"). Style always worked
everywhere; only the *live* preview was missing, because only Taylor and Rhino had the clean copies
(made while testing). The on-demand button stays, but Subtitles now starts the `--clean-only` job by
itself on opening a clip with no clean copy -- once per opening, waiting while another job runs (one
job at a time), and not retrying after a failure. A bug on the way: `previewAsked` was one boolean
for the whole app, so after one preview job finished every other project read "making preview"
for ever and its button never came back; it is now the project's name (`previewFor`). Measured in
the browser: Taylor (has clean) starts no job; The-Future-Mark-Zuckerberg starts one
(`clean_only`, `max_clips 5`) and is live after 101 s with two overlay lines; How-AI-agents through
the API in 42 s; the burned `clip_0X.mp4` files byte-identical before and after. Still not possible:
a project made by the CLI with no known source path (`sample_5s`).

**All tools page (2026-10-22) -- asked for by the developer** with a "More Tools" screenshot
(underlined tabs, search on the right, big image cards). `design/` has no such screen, so it is drawn
from the tokens: `screens/ToolsCatalog.tsx`, shown inside Home's sidebar and top bar when the page is
`tools` (sidebar "ឧបករណ៍ទាំងអស់" and Home's "ឧបករណ៍ទាំងអស់ ›" both lead there; before, both just
showed Home again). Tabs ថ្មីៗ / 🔥 ពេញនិយម / Clips / Subtitles / កែវីដេអូ with a gold underline; search
covers every tool, not only the tab. Cards are 150 px art (`screens/ToolArt.tsx`, moved out of
`HomeScreen.tsx`) on a gradient per category (gold / info / ok mixed into `raised`), a "ថ្មី" ribbon on
Auto Reframe, Phase chips on what does not run. `ALL_TOOLS` (in `tools.ts`) is Home's eight plus three
the app really has: Caption Studio (preset `caption`), Gaming Auto Clipper (Phase 3) and AI Models
(opens the Models page). "ថ្មីៗ" is the tools opened on this machine (`screens/recentTools.ts`,
localStorage, try/catch, 8 kept), recorded in `App.openTool`, so Home's cards count too. A Khmer trap:
the ribbon clipped the vowel above "ថ្មី" under `overflow-hidden` until it got line-height 1.7.
Measured in the browser: 11 cards (6 enabled), Clips 5 / Subtitles 3 / Edit 3, empty Recently says so,
"caption" finds 1, "zzz" says nothing found, opening Interview lands on Import and then shows in
Recently, AI Models opens Models; 4 columns at 1440, 3 at 1100 with no horizontal scroll; no job
started, no console errors.

**One frame for the sidebar pages (2026-10-22) -- asked for by the developer** ("when user click
sidebar change main content"). Each sidebar page had its own frame: Home/Tools the new sidebar,
Projects (Import) a full-window `TopBar`, Settings the Figma-era `TitleBar` + old `Sidebar` -- so a
click replaced the whole window. `screens/AppShell.tsx` now holds the sidebar, the top row (help,
menu, account, window buttons) and the preview dialog; `App.shell(page, content)` wraps Home, Tools,
Projects and Settings, and only the content changes. React keeps the shell because every branch
returns the same `div > AppShell` tree: a marker set on the sidebar's DOM node survived all four
clicks. `HomeScreen` and `ImportScreen` are content only now (Import keeps its "Projects ថ្មីៗ" list
and sticky footer); the Reframe dialog renders in every shell page, so "Reframe 9:16" in the sidebar
works from Projects too (before, it opened only on Home). Workflow screens (Processing, Review,
Subtitles, Export done, Reframe) stay full-window. Deleted as unused: `components/Sidebar.tsx`,
`components/TitleBar.tsx` and the 12 SVGs only they imported. Settings still shows the Figma-era
Models page inside the shell until `Settings.html` is built. `shot.mjs` had been stale since step 7
(its Auto Reframe click now opens the Reframe dialog, not Import); it clicks Interview & Webinar and
reports `problems: none`. Measured: no horizontal scroll and the Import footer at the window bottom at
1100x700 and 1280x800; no job started, no console errors.

**My projects gallery (2026-10-22) -- asked for by the developer** with two screenshots (a project
grid with thumbnails, tabs, storage, search, grid/list, "Upload new video"). The sidebar's "Projects
របស់ខ្ញុំ" now opens `screens/ProjectsScreen.tsx` (view `library`) inside `AppShell`; the old target,
Import (drop zone + Start), is still where tools lead. The gallery's first card "Import វីដេអូថ្មី"
opens **Home** (the developer's choice: pick a tool first, then the video), with nothing chosen. Tabs ទាំងអស់ / មាន Clips / Reframe / មិនទាន់ចប់ with counts, the total size the projects take
in `output/` (the screenshots' "0 GB / 0 GB"; sources not counted), search, grid (220 px minimum, 4
columns at 1440, 3 at 1100) and list. Each card: the real first-clip thumbnail (9:16, contained) or a
source frame (`/probe/frame`), the length, a badge (clips, Reframe, កំពុងដំណើរការ, or បានឈប់ for a
failed/interrupted job with nothing to show), and "clips · reframe · size · day". Opening follows
what the project has: clips -> Review, only reframes -> Reframe result (`showReframeResult` now takes
the name, because `chosen` has not updated yet), nothing -> Import with that video chosen. Left out:
the screenshots' Free Plan / days left / expired (no accounts, nothing expires locally) and Trash
(deleting a project is its own decision). Sidecar: `/projects` items gain `seconds` (from the first
4 KB of `transcript.json`, which holds `duration` -- a 70-min transcript is large), `bytes` (folder
size) and `reframes` (`clips.project_facts`), and CLI folders with only a reframe are listed too.
Measured: `/projects` 78 ms for 9 projects (5.4 GB); in the browser 9 projects, tabs 9/4/5/3,
8/8 thumbnails, "rhino" finds 2, Taylor -> Review, Webinar -> Reframe result, Table For Four ->
Import with Start enabled, the Import card -> Import with nothing chosen; no horizontal scroll at
1100; no job, no console errors, no failed requests. 544 tests, `shot.mjs` `problems: none`.

**"⋯" menu on every project (2026-10-22) -- asked for by the developer** (screenshot: three dots
beside the project name). A button may not contain a button, so a card is now a `div` holding the
thumbnail button and a row with the name button and `ProjectMenu` (a flex row, so the dots sit on the
name's line -- an absolute position from the card's bottom left them between name and meta, found by
the developer; 28x22, no background until hover; the thumbnail is `tabIndex=-1` so Tab stops once); list rows get the same menu at the end. The menu lists only what that project can
really do: មើល clips (has clips), លទ្ធផល Reframe (has a reframe), បង្កើត clips ថ្មី and Reframe
វីដេអូនេះ (source path known: Import / the Reframe dialog with the video chosen), បើក folder output
and បង្ហាញវីដេអូដើម (`/reveal`, Explorer only -- nothing is changed). No delete. `/projects` now
sends each project's absolute `folder`, so the UI never joins a path. It closes on Escape, an outside
click or a choice, and opens **upward** when less than 300 px is left below (the last row's menu ran
to 988 px of a 900 px window). One bug on the way: choosing a project set `chosen.name` to the
project name, so the Reframe dialog read "Table For Four" instead of "Table For Four.mp4";
`chosenOf(project)` takes the file name from the path. Measured in the browser with `/reveal`
intercepted (no real Explorer windows): 9 menus, Taylor 6 items, Webinar 5, Table For Four 4,
sample_5s 2; each action lands where it should; reveal got `output\Table For Four` and
`samples\Table For Four.mp4`; no job, no console errors.

**Rename and delete a project (2026-10-22) -- asked for by the developer** (two more items in the
"⋯" menu, after a divider; delete in `danger` red). Both are shaped by what the pipeline needs:
- **Rename changes only the shown name.** The folder is `output/<video.stem>/` and `make_clips.py`
  rebuilds that name from the video file, so renaming the folder would detach it -- the next run on
  the same video would start a new folder. `PATCH /projects/{name}` writes `{"title"}` to
  `output/<name>/project.json` (`server/manage.py`: whitespace collapsed, 80 characters, empty =
  back to the folder name); `/projects` returns `title`, the cards and search use it, and every URL
  still uses `name`.
- **Delete sends `output/<name>/` to the Recycle Bin**, not a permanent delete: PowerShell's .NET
  `FileSystem.DeleteDirectory(..., SendToRecycleBin)`, already on Windows, with the path passed in an
  environment variable so a quote or `$` in a folder name cannot change the command. The source
  video lives outside `output/` and is never touched; the confirm dialog says so in green, lists what
  goes (size, job history count) and focuses Cancel. `DELETE /projects/{name}` refuses with 409 while
  that project's job runs, checks the folder sits directly in `output/`, and removes the database
  rows (`db.delete_project`: clips, jobs, project) **only after** the folder is gone -- a failed
  recycle returns 500 and leaves the project whole. Job history cannot come back from the bin.
Measured: 10 tests (`tests/test_manage.py`, recycle stubbed; `%2E%2E` reaches the guard, a bare `..`
is normalised away by the client); a real recycle of a scratch folder took 1.0 s and the folder was
found in the Recycle Bin through `Shell.Application().NameSpace(10)`; in the browser a throwaway
`zz-delete-test` project was renamed to "សាកល្បង លុប" (found by search), Cancel kept it, Delete
removed it from `output/` into the Recycle Bin, and every video in `samples/` kept its MD5. 554
tests, `shot.mjs` `problems: none`.

**Import settings redesigned after OpusClip (2026-10-22) -- asked for by the developer** with four
screenshots. Decided with the developer: build the layout now, apply caption presets on render, and
add three real flags in later steps -- clip length, processing timeframe, include-moments + genre.
`screens/ImportScreen.tsx` is one centred column (820 px): a top line of inline selects (speech
language, subtitles -- Khmer options disabled as Phase 2 -- and the tool chosen on Home), then the
source (drop zone + path + samples, or once chosen a real frame with a "720p" badge, length, fps and
ប្ដូរវីដេអូ), tabs **AI កាត់ clips** / **មិនកាត់ (វីដេអូទាំងមូល)** (the second is the whole video
vertical, i.e. AI Reframe, so it opens that dialog), one row of inline selects (AI model, clip
length, clip count; `field-sizing: content`), genre chips, "find specific moments", a two-handle
timeframe, Quick presets (the Subtitles `PresetCard`, moved to `screens/PresetCard.tsx`) and save as
default. Genre, moments, timeframe and clip length are drawn disabled with a "ជំហានបន្ទាប់" tag
until their flags exist. Start now sends `styleOptions(captionStyle)`, so a preset chosen here is
burned at render. The page lost its "Projects ថ្មីៗ" column -- the My projects gallery replaces it.
Measured in the browser with `POST /jobs` intercepted: Start sent `max_clips 10`, `caption_color
#00E054` (Karaoke), `caption_case upper`, the Interview preset's `layout fill,split,fit`; the Don't
clip tab opened the Reframe dialog with the video chosen; footer at the window bottom; no horizontal
scroll at 1100. `shot.mjs` still drives the old Import (segmented groups, the projects column) and
needs updating.

**All nine real projects were sent to the Recycle Bin at 22:08-22:09 on 2026-10-22** (Recycle Bin
times are UTC, 15:08-15:09), one every 10-20 s, through the desktop app's own sidecar: the sidecar
started for testing logged exactly one DELETE (`zz-delete-test`, 22:02) and was stopped at 22:04.
The pace and the confirm dialog per project point to deletes made by hand in the app, not a script.
The folders are restorable from the Recycle Bin; the job history in `clipforge.db` is not (the
`project` table is empty). **The developer confirmed (2026-10-23) the deletes were on purpose and chose to keep
them deleted** -- not a bug; `output/` has no real project until new videos are processed.

**The Import page became a dialog (2026-10-23), planned with the developer first.** Decided: the
settings open right after a video is chosen, a long-to-short tool on Home opens the dialog at once,
and the Import page is removed. `screens/ClipSettingsDialog.tsx` ("វីដេអូវែង → Clips ខ្លី", 780 px,
the chosen tool as a chip) has two steps in one window: (1) no video -> drop zone, file picker, path
and samples; (2) a video -> its real frame with the resolution badge, length/fps, language selects,
ប្ដូរវីដេអូ (back to step 1), the AI កាត់ clips / មិនកាត់ tabs and every setting from the old page. The
kit `Dialog` gained a `footer` rendered **outside** its scroller (a `sticky` footer in a padded
scroller floats above the bottom), which holds the hardware line and Start. Ways in: tool cards on
Home and All tools, the Auto Clip hero, the sidebar's quick Auto Clip (all at step 1, with that
preset, `chosen` cleared); a drop anywhere (step 2; from a full-window screen it returns to Home
first); ⋯ "បង្កើត clips ថ្មី" and opening a project with nothing to show (step 2). Closing keeps the
video; Start closes it and goes to Processing; មិនកាត់ closes it and opens the Reframe dialog, so two
dialogs never stack. `ImportScreen.tsx` is deleted, the `projects` view is gone, and screens that
used to fall back to Import (Processing's back, a job or review with nothing to show) land on My
projects; Export done's "Project ថ្មី" opens the dialog on Home.
Fixed on the way: App asked `/projects/<name>/clips` for a video never processed (the 404 noted as a
leftover in step 1) and kept the **previous** project's clips in state, which could show a wrong
"មើល N clips"; it now asks only for projects in the list and uses an empty list otherwise.
Measured in the browser (`POST /jobs` intercepted): Podcast card -> step 1 without Start; a sample ->
step 2, frame loaded, Start enabled; Escape closes on Home; វីដេអូវែង -> step 1 with 10 clips;
ប្ដូរវីដេអូ -> step 1; មិនកាត់ -> one dialog, AI Reframe; at 1100x640 Start ends at y 600 and Close at
y 36; Start sent `max_clips 5`, Karaoke `#00E054`. In the desktop app a real OLE drop of
`Out of Pocket.mp4` on My projects (`effect=Copy`) opened the dialog at step 2 with Start enabled.
`shot.mjs` drives the dialog and the gallery, skips Review/Export while no project is rendered, and
reports `problems: none`.

**Step 1 of the dialog redrawn after OpusClip's "Long to shorts" (2026-10-23)** -- asked for by the
developer with a screenshot. 640 px wide (780 once a video is chosen): a one-line description under
the title, an illustration of a horizontal frame -> arrow -> three stacked vertical clips, and one
panel with the path field (in place of "Drop a Twitch link" -- the app downloads nothing), and two
links, ជ្រើសឯកសារ (Upload) and វីដេអូគំរូ (N), which unfolds the samples (in place of Google Drive --
nothing is uploaded). The illustration is a **real frame**: the largest sample (a long video, what
this tool is for) at 60 s, past most intros; the vertical clips are `object-position` crops of the
same frame. The first sample at 20 s showed an arm and an OpusClip watermark. The panel still takes
a drop in the browser, and the window takes one in the app. Measured: 4/4 images load, samples
hidden until the link, a typed path shows ប្រើ and Enter moves to step 2 at 780 px; `shot.mjs`
(now opening the sample list, and detecting step 1 by `#video-path`) reports `problems: none`.

**Podcast Clips and Interview & Webinar merged into "Long to Shorts" (2026-10-23)** -- asked for by
the developer ("use AI analysis instead"). The two presets differed only in `--layout`: Podcast ran
the default `auto`, Interview restricted it to `fill,split,fit` (no three/four). With `auto` the
planner already decides per shot -- one face -> Fill, 2-4 people -> Split/Three/Four, a still slide
-> Fit, no face -> person/animal/motion -- so one preset `shorts` (`--max-clips 5 --layout auto`)
replaces both, and the dialog says so in one line under the settings row. Its card, the Auto Clip
hero and the sidebar's quick Auto Clip open the dialog with it; Home has 7 tool cards, All tools 10.
`preset-interview.svg` and the `interview` art were removed; a stored "recent" id `podcast` or
`interview` simply no longer matches a tool. Interview's Khmer line ("find good Q&A") had promised
the Phase 2 Q&A finder, which the preset never ran. Measured in the browser (`POST /jobs`
intercepted): all three ways in show "Long to Shorts", Start sent `max_clips 5`, `layout auto`;
`shot.mjs` `problems: none`.

**"Import វីដេអូ" on the Auto Clip hero opens the Windows file dialog first (2026-10-23)** -- asked
for by the developer. `App.importVideo`: `pickVideo()` at once; Cancel does nothing; a picked file
selects Long to Shorts and opens the settings dialog already at step 2 (`openTool('shorts')` clears
`chosen`, then `choosePath` sets it -- React batches both). A browser has no full-path picker, so
there the button opens step 1. Tool cards still open step 1 (pick inside the dialog). Measured in the
browser: step 1 with the "Long to Shorts" chip, no console errors. **Not driven in the desktop app**:
the developer's own `npm run app` (cargo-started `app.exe`, its Vite on 5173 and sidecar on 8765,
from 01:16) was running, a second `app.exe` exited at once, and closing theirs to test was not ours
to do. The browser check above ran against their servers (read-only, the Start click intercepted).

**Start stays on the page; progress lives on a project card (2026-10-23), planned with the developer
first** (OpusClip screenshot: "Recent projects" with "8% (ETA 3m)" on a card). Decided: % + ETA
**estimated** and labelled so; a click on a running card opens the old Processing screen as details;
the row goes on Home and My projects. Start in the settings dialog closes it and stays
(`startWith(..., stay=true)`); Subtitles' Save and AI Reframe still use their processing screens.
- `src/eta.ts`: per-step seconds from speeds measured here -- audio 3 + 0.1/min, transcribe 15 +
  12.4 s/min (GPU medium; 6 small, 43/100 CPU), highlights 60 + 33 s/min (7b + rubric; 7 for 3b),
  boundaries 12, captions 4/clip, render 30 + 8/clip; cached and skipped steps cost 0. % = estimated
  time done (the running step capped at 95 % of its estimate) / total; ETA = the rest, "ជិតរួច…" once
  a step overruns. The fixed parts came from the first real run: without them the 0:55 Rhino video
  read "ជិតរួច…" for ~50 s. Now the 35:25 podcast estimates 1791 s (measured 1680) and the Rhino
  video 174 s (measured 184).
- `src/useRunProgress.ts`: a 1 s clock while the job runs; the step start is the moment the list of
  done steps last changed (stored with React's "information from previous renders" pattern, not an
  effect). `App` keeps `run` (name, video, start time, plan; the length comes from `/probe` after
  Start) and prepends a placeholder card until `/projects` lists the new project.
- `ProjectCards` (in `ProjectsScreen.tsx`) is the grid/list + rename/delete dialogs, shared by My
  projects and Home's "Projects ថ្មីៗ · មើលទាំងអស់ ›" row (4 newest). The row sits **under** the tool cards (moved there
  2026-10-23 at the developer's request; it was between the heroes and the tools). A running card shows a centred
  "38% · ~៩ នាទី / ប៉ាន់ស្មាន" badge, a green bar along the bottom, "កំពុងដំណើរការ", and a ⋯ menu with
  only "បើក folder output" and **បោះបង់ job**. When the job ends a toast reads "Clips រួចរាល់ហើយ!" with
  មើល (opens Review), or failed / cancelled / could not start (e.g. 409).
- Sidecar: `/projects/{name}/clips` returned 404 for a project whose job had just started (database row
  before the folder); it now answers an empty list for any project the database knows (test added).
Measured with one real job on the Rhino video through the developer's running sidecar: after Start
the dialog closed, Home stayed (no Processing), the card climbed 0 -> 72 % over 148 s (before the
overhead fix), the toast came at 184 s, the card read "១ clips · 31 MB", មើល opened Review, the source
MD5 unchanged. 555 tests. The developer's running sidecar needs a restart to pick up the 404 fix.

**"Why stuck at 24%" -- real in-step progress (2026-10-23), asked about by the developer.** A job on
`The-Future-Mark-Zuckerberg` (47 min) sat at 24 % with "ជិតរួច…": transcribe ran ~21 min against the
~10 min estimated from the How-AI-agents speed, and an overrunning step is capped at 95 % of its
estimate, which is exactly (audio + 0.95 x transcribe) / total. The pipeline was alive (python +4.8
CPU s per 5 s, GPU 81 %, `medium on cuda`, Ollama idle); why this video transcribed slower was not
measured. The whole job finished in 46.7 min. The pipeline already knew real progress -- transcribe
(seconds done), highlights (chunks), render (clips) -- but only rich's terminal bar saw it, and a
subprocess has no terminal. Now:
- `make_clips.report_progress(step, done, total)` prints `progress <step> <done> <total>` when
  stdout is not a terminal, at most every 3 s per step, plus an explicit end line after transcribe
  and render: Whisper's last segment ends before the video does and `tick()` runs only before each
  clip, so neither reached 100 % on its own (found by running it through a pipe).
- `server/jobs.parse_progress` turns those lines into `Job.fractions` (kept out of the log -- every
  3 s on a 50-min job would be thousands of lines), sent as `progress.fraction` over the WebSocket.
- `eta.ts`: with a real fraction `f` (>= 3 % and >= 10 s in), the step's length is projected from
  its real speed (elapsed / f) in both the % and the ETA, and the card says "ពីល្បឿនពិត" instead of
  "ប៉ាន់ស្មាន". Projecting only the ETA made the % drop from 24 to 7 when `f` arrived; with the
  projection the same moment reads 19 % and ~89 min.
Tests: `tests/test_progress_lines.py` (parser, terminal vs pipe, throttle, end lines, fractions in
`progress()`); 559 pass. Through a pipe on the Rhino video: transcribe 0.19 -> 1.00, highlights 0 ->
1.00. **A side effect of that check:** `--redo highlights` let the LLM pick again on the 55 s video
and it returned 0 clips, emptying the Rhino project's `clips.json`; one more `--redo highlights`
restored 1 clip ("Rhino Farming Insight", 11.2-53.1 s, the same range) and re-rendered it. Never
use `--redo highlights` on a project as a test. The developer's running sidecar still has the old
`jobs.py`; the card uses real progress after the app is restarted.

**"Long Video → 10 Clips" merged too; the one tool is "Long to Short" (2026-10-23)** -- asked for by
the developer. It differed from Long to Shorts only in `--max-clips 10`, and the settings dialog
already offers ៥ / ១០ / ១៥, so preset `long`, its card and `preset-long.svg` are gone; preset
`shorts` is titled "Long to Short" and its card takes the long-video -> clips art instead of the
waveform. The dialog heading is now "Long to Short", with the preset chip shown only for another
preset (Caption Studio). Home has 6 tool cards, All tools 9. Measured in the browser (`POST /jobs`
intercepted): picking 10 sent `max_clips 10`, `layout auto`; no old names left; `shot.mjs`
`problems: none`.

**App language Khmer / English, step 1 of 4 (2026-10-23), planned with the developer first.**
Decided: step by step, Khmer by default. The UI had ~570 lines of hardcoded Khmer in 35 files.
- `src/i18n.ts`: `LangProvider` (in `main.tsx`) keeps the language in localStorage `kcs.lang`
  (try/catch) and sets `<html lang>`; `useT()` gives `t('ទំព័រដើម', 'Home')` -- both languages
  written side by side where the string is used, so a missing translation is a type error, not a
  silent gap; data outside components uses `text(km, en)` and `t(tool.title)` (`tools.ts` titles,
  descriptions and tab labels are `Text` now; the All tools search looks in both languages).
- `screens/SettingsScreen.tsx` builds `design/screens/Settings.html` in the shell; the sidebar's
  Settings opens it (view `settings`). Real: **app language** (switches at once), output folder,
  runs on (GPU name from `/env`), AI model, number of clips and caption style defaults (saved to the
  same localStorage defaults at once), sidecar version. Drawn disabled with the reason: change
  folder, start with Windows, Khmer speech model / video language / Khmer subtitles (Phase 2), cloud
  (nothing is uploaded), clip length (next step), Windows notifications. The Figma-era Models page
  is behind "Models ដែលមានលើកុំព្យូទ័រនេះ › មើល" and the AI Models tool card.
- Translated in step 1: sidebar, top bar, Home (heroes, tabs, tool cards, Recent projects heading),
  All tools, Settings. Still Khmer: the settings dialog, project cards, Processing, Review, Export,
  Subtitles (incl. caption preset names), Reframe -- steps 2-4. Tool art keeps its Khmer sample text.
Measured in the browser: first open `lang=km`; switching to English in Settings changes heading and
sidebar at once; a text-node + attribute scan finds no Khmer left on Settings, Home and All tools
(art, project cards and language names excluded); English survives a reload; "following faces" and
"តាមដានមុខ" both find Auto Reframe; no horizontal scroll at 1100; every sidebar row one line in both
languages (the English quick item first wrapped -- now "Subtitles KH", one line with `truncate`).
`shot.mjs`/`app-shot.mjs` reach Models through Settings -> View; not re-run, a job was running.

**Settings became a dialog opened from the top right (2026-10-23)** -- asked for by the developer:
Settings leaves the sidebar and replaces the top bar's Menu button (gear icon, `AppShell.onSettings`);
`screens/SettingsDialog.tsx` (720 px) shows the four sections of Settings.html as four tabs --
ទូទៅ / Processing / Default project / ការជូនដំណឹង និងអំពី app -- same rows and behaviour as the page
it replaces (`SettingsScreen.tsx` deleted, view `settings` gone; `navigate('settings')` opens the
dialog). The tab panel has `min-h-[370px]` so the dialog keeps one height (527 px) on every tab.
"Models ដែលមានលើកុំព្យូទ័រនេះ › មើល" closes the dialog first, then opens the Models page -- the first
version left the dialog covering it. The kit `Dialog`'s Close label is translated now ("Close").
Measured in the browser: no Settings in the sidebar, no Menu button, the gear opens the dialog,
switching to English changes the dialog and the sidebar at once, Escape closes, at 1100x640 the
dialog spans y 56-584 with Close at 68; `shot.mjs` (Settings -> Processing tab -> View) reports
`problems: none`. Seen on the way: the developer's app was closed during this step, which marked
the running `Table For Four` job `interrupted` after 67 min, during highlights: `audio.wav` and
`transcript.json` are kept, so a new run starts at highlights.

**Settings dialog: OK and Cancel (2026-10-23)** -- asked for by the developer. The dialog now edits
a draft (`draft` = language, AI model, clip count, caption style) and the kit `Dialog` footer holds
បោះបង់ / OK: OK applies all four and writes the defaults to localStorage (`clipforge.defaults.v1`,
`kcs.lang`), Cancel, ✕ and Escape throw the draft away. The dialog's own text stays in the current
language until OK. Measured in the browser: after editing language and clip count, Cancel / Escape /
✕ each left `lang=km` and nothing saved, and reopening showed the old values; OK switched to English
at once, saved `maxClips 10`, and both survived a reload.

**Sidebar "ឧបករណ៍ទាំងអស់" is a dropdown (2026-10-23)** -- asked for by the developer with a
screenshot (a parent with a caret and indented children on a vertical line). The children are the
tool categories Clips / Subtitles / កែវីដេអូ, each with an icon; a child opens All tools on that tab
and is marked current while that tab shows; the parent toggles the list (open by default, caret
rotates, `aria-expanded`) and opens All tools on ពេញនិយម. The catalog's tab moved up into `App`
(`catalogTab`, type `CatalogTab` in `tools.ts`), so the sidebar and the page tabs stay in step.
Measured in the browser: Subtitles -> All tools on Subtitles with 3 cards, កែវីដេអូ 3, choosing Clips
on the page marks Clips in the sidebar, the parent collapses and expands, Home marks no child,
English rows "Clips / Subtitles / Edit video" at 38 px each; `shot.mjs` (its category clicks now
scoped to Home's tab group, since the sidebar has the same words) reports `problems: none`.

**Start leads to Recent projects (2026-10-23)** -- asked for by the developer. Start in the settings
dialog navigates to Home and sets `focusRecent`; an effect `scrollIntoView`s the "Projects ថ្មីៗ"
section (`recentRef`, `scroll-mt-6`) **once** and clears the flag. The first version kept a counter
that stayed above 0, so every later click on Home scrolled down again and replayed a gold ring; the
developer asked to drop the ring and have Home open normally, so `animate-arrive` is gone from
`index.css`. Measured in the browser (`POST /jobs` answered 503): after Start scrollTop 217 and no
ring; a later Home click scrollTop 0, twice.

**Review redesigned after OpusClip, grid and list (2026-10-23), planned with the developer first.**
Decided: open on grid (remembered in localStorage `kcs.reviewLayout`), and ♡ / 👎 that are saved and
filterable. `screens/ReviewScreen.tsx` is rewritten: a toolbar (grid/list, រក clips បន្ថែម, ជ្រើស,
Filter ទាំងអស់ / ♡ ចូលចិត្ត / លាក់ 👎, តម្រៀប), "Clips ដើម (N)", then either
- **grid**: 9:16 thumbnail cards (score + letter, length, ♥/👎 mark), three small buttons under each
  (Subtitles, Export this clip as MP4 + SRT, play in list) and a two-line title; a card opens the
  list scrolled to that clip;
- **list**: one row per clip -- ♡ / 👎 on the left, a 260 px player with a big Play button until it
  starts, the title, score, `[start - end]` in the source, the clip's real `.vtt` text, a folded
  "why AI picked it" (Hook / Flow / Value), and Export MP4 + SRT / កែ Subtitles on the right.
"ជ្រើស" shows checkboxes and the old export bar (folder + Export N). Left out from the screenshots,
having nothing behind them: Publish on Social, Export XML, Upscale, Edit clip, 1:1, Duplicate.
Sidecar: ratings live in `output/<name>/project.json` beside the title (`manage.read_ratings` /
`write_rating`; `write_title` and `write_rating` keep each other's data; the file is deleted when
both are empty), keyed by the clip's **time range** `start-end` rather than its number, since a new
AI pick renumbers clips. `PUT /projects/{name}/clips/{index}/rating {rating: like|dislike|null}`;
`/projects/{name}/clips` adds `rating` to each clip. Tests: `tests/test_ratings.py` (4); 563 pass.
Measured in the browser on Rhino (its one real clip copied into six only inside the test): grid 6
cards / 6 thumbnails / 6 columns at 1440; card 3 -> list scrolled to row 3; the transcript and
`[0:11 - 0:53]` show; the video plays at 1080x1920; ♡ saved (PUT), Filter ♡ leaves 1 row, the like
and the list layout survive a reload, un-liking removed `project.json` again; ជ្រើស + Export wrote
`01 - Black Rhino's Daily Routine.mp4/.srt` to the scratchpad; no horizontal scroll at 1100 in
either view; no job, no console errors; the clip's MD5 unchanged. `shot.mjs` / `app-shot.mjs` click
the footer's Export (each card has an Export icon now) and report `problems: none`.

**Review flow: one clip shown big, a grid card opens a dialog (2026-10-23), planned with the
developer first.** One component, `ClipDetail` (in `ReviewScreen.tsx`, replacing `ListRow`), is used
three ways:
- **One rendered clip**: shown directly, with no grid/list toggle, ជ្រើស, Filter or sort (nothing to
  choose between); Filter is ignored, so un-liking under "♡ only" cannot hide the only clip.
- **List rows**, as before.
- **The grid dialog**: clicking a card (or its play icon) opens `ClipDialog` over the grid instead of
  switching to the list. It has "Clip ៣ / ៦" and ↑ / ↓ / ✕ at the top right; the arrow keys do the
  same (except inside a checkbox or select), and Escape or a click outside closes it. The order is
  saved when the dialog opens, so un-liking a clip under the ♡ filter does not make ↑ / ↓ skip.
  The detail is keyed on the clip, so the next clip starts with a fresh player and transcript.
What changed in the detail: the LLM's `hook` is shown as the description, a **Transcript only**
checkbox hides the hook and "why AI picked it", and the transcript is split into timed paragraphs
`[0:28 - 0:41] ...` built from the real `.vtt` (`paragraphs()`: a new paragraph after a pause over
1 s, or once a paragraph is over 20 s and ends a sentence). Clicking a paragraph seeks the video and
plays it; the one playing is tinted gold. The text column is capped at the player's height
(462 px) and scrolls inside itself.
Measured in the browser: Rhino (one real clip) has no toggle, ជ្រើស or Filter, 2 paragraphs
(`[0:00 - 0:01] Coming straight here.`, `[0:28 - 0:41] That's the difference...` -- the clip
really has 26 s with no speech), clicking the second sought to 29.1 s with controls on and the gold
tint; Transcript only hid the hook and the "why" panel. With six test clips (copies made only inside
the test): card 3 -> dialog "Clip ៣ / ៦" with the grid still behind it, ↓ -> 4, ↑↑ -> 2, ↑ -> 1 with
↑ disabled; ♡ in the dialog sent a PUT and the grid card showed ♥ at once, then it was undone (no
`project.json` left); Escape closed it; the list has 6 rows using the same detail; at 1100x700 the
dialog is 1052x573 with no horizontal scroll. No job, no console errors; `shot.mjs` `problems: none`.

**"I chose 10 clips but see only 3" -- found by the developer (2026-10-23).** The job on
`The-Future-Mark-Zuckerberg` (47 min) really sent `--max-clips 10`, and `clips.json` held 3, all
between 45:01 and 46:58: the LLM had returned 3 candidates in total, all from the **last** of 11
chunks. Cause: `llm.py` never set `num_ctx`, and Ollama 0.40.8 used ~2048 tokens of context, while a
5-minute chunk's prompt is **4188** tokens -- Ollama silently drops the start of the prompt (the
instructions), so the model wrote prose and `parse_clips` found nothing. Only the last chunk
(130 s, 2053 tokens) fit. Measured on chunk 5 with Ollama's own counters: default ->
`prompt_eval_count` 2050, 0 clips, 75 s; `num_ctx` 8192 -> 4188, 3 clips, 225 s (the 182-230 s per
chunk measured earlier, so an earlier Ollama must have had a larger default). Fixed:
`config.OLLAMA_NUM_CTX = 8192` is sent on every call, and `_check_not_cut` turns a prompt + answer
that fills the context into an `LLMError` (a chunk warning) instead of a silent 0 clips. Tests:
`tests/test_llm_context.py` (2); 565 pass. This likely also explains the Rhino `--redo highlights`
that returned 0 clips. Projects whose highlights ran under the small context have too few clips
until `--redo highlights` runs again.

**"Why stuck at 99%" -- found by the developer (2026-10-24).** A 15-clip job on `Taylor_Tomlinson`
(70 min) ran 00:06-01:12 (transcribe 15 min, highlights 48 min with the full context, render 3.5 min)
and the sidecar reports it `done` with 15 clips, but the card kept "៩៩% · <១ នាទី · ពីល្បឿនពិត".
Those three values are exactly render's end line (`fraction.render = 1.0` -> `min(99, 100)`, 0 s
left, measured) -- the last frame **before** the job's final status. `useJob` had no `onclose`: a
WebSocket that closes before the final message (a one-hour job, the PC sleeping, a dropped
connection) was never followed up, so the card stayed at 99% for ever. Now, when the socket closes
before a final status, `useJob` waits 2 s, asks `GET /jobs/{id}` (`api.job`), takes that status,
and reconnects if the job is still running (clearing the log first, since the server resends it
from the start). The listener is a named inner `connect()`, because a `useCallback` that calls
itself trips lint. Measured in the browser with every job call mocked (`routeWebSocket` drops the
socket 0.8 s in): job done while away -> 1 GET, toast "Clips រួចរាល់ហើយ!" 2.4 s after Start; job still
running -> 1 GET + a second socket that delivers done, same toast; no console errors, no real job.

**Auto Subtitles dialog (2026-10-24) -- asked for by the developer** with OpusClip's "AI Captions"
screenshots. Decided: speech language only (no translation yet), real presets only, aspect defaults
to the video's own. The Auto Subtitles card (Home, All tools) was a dimmed Phase 2 tool; it now has
preset `subtitles` and opens `screens/AutoSubtitlesDialog.tsx` (640 px): a real frame with the
resolution badge and a sample caption drawn in the chosen style, the video row, **Quick presets**
(the four `STYLE_PRESETS` the renderer draws -- Box and Neon are left out) / **My templates** (the
saved default style), an aspect menu (9:16 / 1:1 / 16:9 / 4:5, the nearest to the source marked
"ដូចវីដេអូ"), and a two-column language menu: original language Auto + 20 Latin-script Whisper
languages (Montserrat has no Khmer/CJK/Thai glyphs; ខ្មែរ dimmed as Phase 2) and translate-to with
only "no translation" live (English "next step", Khmer Phase 2). "Credit usage" became the measured
estimate. Start runs the Reframe path (`startReframe(settings, extra)`, crumb "Auto Subtitles"):
`--full`, the aspect, `--layout center` when the aspect is the video's own (whole frame, captions
only) or every layout when it reframes, `styleOptions`, and `--language`.
Pipeline: `--language auto|<code>` sets `config.WHISPER_LANGUAGE` (checked against
`config.WHISPER_LANGUAGES`); a cached transcript in another language is re-transcribed and the
highlights redone with it, and `jobs.language_changes` (4 KB head of `transcript.json`) keeps the
progress card from calling that transcribe "cached". `JobRequest.language`. Tests:
`tests/test_language.py` (2) + one in `test_server.py`; 568 pass.
Measured: in the browser (`POST /jobs` answered 503) the card opens the dialog, Start is disabled
until a video is chosen, How-AI-agents shows its frame, "360p" and 16:9 "same as the video"; Karaoke
+ 9:16 + English sent `full, 9:16, layout fill,fit,split,three,four, language en, #00E054`; the
same-size run sent `16:9, layout center`; Escape closes only an open menu; at 1100x640 the dialog
is 592 px with Start at y 600; no console errors. With the CLI on the Rhino video (1280x720):
`--full --aspect 16:9 --layout center --language en` gave 1920x1080 with the same framing as the
source and green active words; `fr` after `en` re-transcribed (21 s), `en` after `fr` again, `en`
after `en` used the cache; the source MD5 unchanged. A sidecar started before this change drops
`language` (pydantic ignores unknown fields) until it is restarted.

**Review moved into the main content (2026-10-24) -- asked for by the developer** ("move review clip
to main content and keep original flow"). Review was a full-window screen with its own `TopBar`; it
is now `shell('projects', <ReviewScreen/>)`, so the sidebar and the top row stay and "Projects
របស់ខ្ញុំ" is marked current. The `TopBar` became a breadcrumb "‹ Projects របស់ខ្ញុំ / <project>"
whose first part returns to the gallery (`navigate('projects')`; it used to go Home). Everything
else is the same flow: grid/list, the clip dialog, Export -> Export done, កែ Subtitles -> the
full-window Subtitles screen. Measured in the browser on How-AI-agents (10 clips): sidebar present
with Projects current, crumb back to the gallery, sidebar Home leaves Review, Subtitles still opens
full-window, no horizontal scroll at 1100x700, no console errors. Opening Subtitles there started
its automatic `--clean-only` preview job (by design), which wrote only `clip_XX_clean.mp4`.

**Screen-share layout `screen`: slide on top, webcam people below (2026-10-24), planned with the
developer first** (screenshots: How-AI-agents' slide between two webcam tiles; "slide above, human
under"). Decided: a wide slide strip, and the people may be soft on a 360p source. Before: all 10
How-AI-agents clips planned `single` -- faces 47 px tall at x 6-10 % / 89-93 %, split rejected at
3.4x upscale -- so the slide was cut away. `plan_shot` now tries `screen_layout` **before** the
people panels: 1-2 faces that are webcam tiles (`is_webcam_face`: centre within `SCREEN_EDGE` 20 %
of a side, height <= 30 % of the frame; two = one per side), the region between the tiles
(`screen_region`, tile = `SCREEN_TILE_RATIO` 2.8 x face width, measured 105/38) at least 40 % of the
width, and that region still (`motion_level(..., region=)`, <= `SCREEN_MOTION_MAX` 15: slides
0.07-0.21, scrolling screens 4.0-5.1, real footage 51-66). Kinds `screen1` / `screen2`
(`SCREEN_KINDS`, in `PANEL_GRIDS` so a too-short one is smoothed to single): `panel_rects` gives the
slide 1080x864 (`SCREEN_TOP_RATIO` 0.45) and the people 1080x1056 or two 540x1056, portrait/square
only (none on 16:9). `slide_box` takes the region's full width; `webcam_box` stays inside the tile.
No upscale limit for this layout (the people are ~8x on 360p). Captions sit on the slide/people seam
(`LAST_SEAM_LAYOUTS`). `--layout screen` (alias `screenshare`) and `auto` include it; the Reframe
dialog's ScreenShare button is real now, Auto Subtitles' reframe sends it, the Result labels it.
Measured (`plan_clip`, before -> after): How-AI-agents 10/10 clips `screen2` (the first version with
a limit of 4.0 left the two scrolling screens single); Taylor_Tomlinson x3, Zuckerberg x3, Rhino and
the webinar x2 plan identically (their faces are never at the edges; the webinar's webcam is a full
frame or a tile too small to detect). Two clips rendered to the scratchpad: 1080x1920, slide text
readable on top, both people below, caption on the seam, 10-12 s each; the source MD5 unchanged. Text
that runs behind a webcam tile in the source stays cut at the tile edge. Tests:
`tests/test_screen_layout.py` (11); 579 pass. Existing How-AI-agents clips keep their old layout until
re-rendered. In the browser the Reframe dialog lists ScreenShare on by default and Start sent
`layout fill,fit,split,three,four,screen` (`POST /jobs` answered 503).

**Auto Subtitles and Auto Reframe follow the Long to Short flow (2026-10-25), planned with the
developer first.** Decided: done opens the Reframe result screen; both whole-video tools change.
- **Step 1 = the same picker.** `Illustration` and `Source` moved from `ClipSettingsDialog.tsx` to
  `screens/VideoPicker.tsx`; `Illustration` has a `variant` (clips: three vertical crops, reframe:
  one vertical crop, subtitles: the frame with a sample caption). Opening either tool clears
  `chosen`, so both dialogs start at step 1 (path field, ជ្រើសឯកសារ, វីដេអូគំរូ, drop) and show their
  settings once a video is chosen; ប្ដូរ (`onClear`) goes back. The inline sample chips are gone.
- **Start stays on Home.** `startReframe(settings, extra, tool)` no longer opens the full-window
  processing screen: it calls `beginRun(tool, full=true, 1)` (shared with Long to Short, which now
  uses it too), navigates Home and focuses Recent projects. `Run` carries `tool`
  (`clips | subtitles | reframe`); a click on the running card opens `job` for clips and `reframing`
  for the other two; the toast reads Clips / Subtitles / Reframe រួចរាល់ហើយ! and its មើល opens the
  Reframe result for that job's folder (`toast.folder`) instead of Review. Start errors go to the
  toast; the dialog no longer stays open with them.
- **ETA for whole-video jobs** (`RunPlan.full`): highlights/boundaries 0, captions 4 + 0.2 s/min,
  render (shot planning included) 15 + 19 s/min (47-min interview: 4.5 + 10:17 min). Steps that cost
  0 s are never "the current step" any more.
- **A clock bug found by the real run** (and present for Long to Short too): `useRunProgress` took
  the step's start from its `now` state, which only ticks while a job runs, so at the first change of
  the done list it still held the time the app was opened and the card read "ជិតរួច…" one second
  in. The start is now `max(now, run.startedAt)` (pure, lint-clean).
Measured in the browser: mocked jobs (`routeWebSocket`, done after 2.5 s) -- both tools open at
step 1 with the path field, a sample moves to step 2, Start closes the dialog on Home with a running
card ("៦% · ~១ នាទី"), a card click opens the processing screen with crumb Auto Subtitles / AI
Reframe, the toast comes at 3 s; sent `full, 16:9, layout center` and `full, 9:16, layout
fill,fit,split,three,four,screen`. One real Auto Subtitles job on the Rhino video (transcript
cached): card "៣% · <១ នាទី" at the start (was "១០% · ជិតរួច…"), toast at 16 s, មើល opened the result
screen with its video; source MD5 unchanged. `shot.mjs` `problems: none`; tsc and lint clean.

**Whole-video results open on the Review page (2026-10-25) -- asked for by the developer**
("when finish open it do the same Long to Short"; chose "same Review page"). `ReviewScreen` takes an
optional `media: ReviewMedia` (`screens/reviewMedia.ts`: `fileUrl`, `thumbUrl`, `exportItems`,
`onShots`, `whole`), read by its cards, player and transcript through a React context instead of
`clipFileUrl` calls. `clipMedia(project)` is the old behaviour; `wholeMedia` + `wholeClips` turn
`/projects/{name}/reframe` results (`full`, `full_16x9` ...) into cards titled "វីដេអូទាំងមូល 16:9 ·
subtitles". `showReframeResult` (the toast's មើល, ⋯ លទ្ធផល Reframe, a project with only reframes, the
dialogs' earlier-results chips) now opens view `whole` inside the shell: one result = the big
detail, several = grid/list with the ↑/↓ dialog, as for clips. In whole mode there is no score,
♡/👎, "why AI picked", Filter/sort or "រក clips បន្ថែម"; 16:9 and 1:1 results get a 440 px player and
uncropped thumbnails (`type: 'whole-wide'`); "កែ Subtitles" becomes **មើល shots និង layout**, which
opens the old Reframe result screen, now with a "‹ ត្រឡប់ទៅលទ្ធផល" button. Export goes through
`exportReframe` per result (indexes renumbered when merged) to Export done, whose cards take a
`thumbUrl` prop. Sidecar: `GET /projects/{name}/reframe/{folder}/thumb` (folder checked like the file
route), and `media.thumbnail` redoes a `.jpg` older than its video (a re-render used to keep the old
picture). Tests: 2 in `tests/test_reframe_api.py`; 581 pass.
Measured in the browser on Rhino (two real results, `full` 9:16 and `full_16x9`; export POST answered
by the test): heading "វីដេអូទាំងមូល (២)" inside the sidebar with crumb, 2 cards with real thumbnails,
no rate/score/more-clips controls, the 16:9 card's dialog "វីដេអូ ២ / ២" with a 440 px player and 3
timed paragraphs from that result's `.vtt`, thumb 200, មើល shots -> the shot page -> back to the
results, Export -> Export done with its thumbnail; the clips Review of the same project unchanged
(♡, កែ Subtitles, 260 px 9:16 player); no job, no console errors, `shot.mjs` `problems: none`.
**Only the video just made** (developer, same day: "it single video"): when `showReframeResult` knows the
folder -- the toast's មើល, the processing screen's result button, a "ធ្លាប់ reframe" chip -- the page lists
that one result as the single big view; the project card and ⋯ លទ្ធផល Reframe still list them all.
Measured (mocked job, folder `full` on Rhino, which has two): "វីដេអូទាំងមូល (១)", 0 grid cards, 1 detail.
A project with both clips and whole-video results still opens on its clips; its whole results are
reached through ⋯ លទ្ធផល Reframe or the toast.

**Edit Video, part 1 of 3: backend (2026-10-25), planned with the developer first** (OpusClip editor
screenshot: transcript with pause chips, preview, timeline with thumbnails and waveform). Decided:
step 1 views and exports through existing flags (cutting words/pauses is step 2), and a video with
no transcript is transcribed when the editor opens. `--transcribe-only` stops `make_clips` right
after transcribe (no LLM, no render); a job with it reports highlights/boundaries/captions/render as
`skipped` (`JobRequest.transcribe_only`). `server/editor.py`: `words_of` -> `GET /projects/{name}/words`
(`ready: false` with 200 when there is no transcript; items are words and pauses over
`PAUSE_MIN_SEC` 0.3 s between them), `waveform` -> `GET /projects/{name}/waveform` (peaks 0..1 over
`WAVEFORM_POINTS` 1200 boxes of `audio.wav`, cached in `waveform.json` until the audio is newer).
Measured: `--transcribe-only` on the 30 s `clip_001` 35 s (model load dominates), writing only
`audio.wav` + `transcript.json`, source MD5 unchanged; on How-AI-agents (35 min) 6662 words and 340
pauses, 348 KB in 165 ms, waveform 1.9 s the first time and 9 ms cached. Tests: `tests/test_editor.py`
(5); 586 pass. Parts 2 (editor: transcript + preview) and 3 (timeline) are next.
**Part 2: the editor.** A new tool card **Edit Video** (preset `editor`, category កែវីដេអូ, art: words +
a pause chip over a timeline) opens a step-1 dialog with the shared `VideoPicker`, then the
full-window view `editor` (`screens/EditorScreen.tsx`). Left: the transcript from `/words` -- words
as inline spans and pauses as `0.46s` chips, click = seek, the spoken word gold, the playing word
kept in view, search with a hit count; it renders in `memo` chunks of 80 so a timeupdate re-renders
one chunk, not 7000 spans. Centre: the **source** video through a new read-only `GET /source?path=`
(video suffixes only, Range works; a test checks the file is unchanged) in a box of the chosen
aspect, with an approximate live caption (`style.words` words around the spoken one, active word
in the style colour), menus Aspect (own aspect marked) / Layout (Auto, Fill, Fit, Split, Screen +
webcam) / Background Blur, and ⏮ ▶ ⏭ with `00:10.06 / 00:55.75`. Right: Captions (the four real
presets) and AI enhance / Brand template / B-roll disabled as Phase 3; Speech cleanup, Extend a
clip and undo/redo are disabled as step 2. Export runs `startReframe(..., 'editor')` -- `--full`, the
aspect, the layout's flags (none, i.e. the whole frame, when the aspect is the video's own) and the
caption style -- and returns Home with the progress card like the other tools (toast
"វីដេអូរួចរាល់ហើយ!"). A video with no transcript starts `--transcribe-only` from an effect (once per
opening, a ref, not while another job runs) and shows a progress bar from the real transcribe
fraction; the words load when that job is done. The menus moved to `screens/Menu.tsx`.
Measured in the browser (every `POST /jobs` answered 503): Rhino shows 70 words and 3 pauses
(1.04 s, 26.47 s, 0.76 s), clicking "rhino" sought to 8.50 s and turned it gold, playback moved the
gold word and the caption read "RHINO AND HER YOUNG CALF", "rhino" found 3, 9:16 gave a 366x651
preview, Karaoke turned the active word green, Export sent `full, 9:16, layout
fill,fit,split,three,four,screen, #00E054` and landed on Home; `Black Rhino_OpusClip.mp4` (never
transcribed) posted `transcribe_only: true` at once and showed "កំពុង transcribe"; no horizontal scroll
at 1100x700, no console errors. 587 tests pass. **Part 3: the timeline** (`screens/EditorTimeline.tsx`, full width under the editor, as in the
screenshot): a ruler with ticks every 1/2/5/10/15/30/60 s (~90 px apart), a layout band from the
newest reframe's `layout.json` shots (colours and labels now shared with the shots page through
`screens/layoutKinds.ts`; "វីដេអូដើម · មិនទាន់ reframe" when there is none), a strip of real source
frames from `/probe/frame` (one per ~100 px, at most 60, `loading=lazy`, grey while loading), the
`/waveform` peaks as one SVG path, and a white playhead. Click or drag anywhere seeks (pointer
capture), ←/→ step 1 s, zoom 1-8x (slider and −/+), the playhead stays in view while playing, and
Hide/Show timeline. Cut / split / delete are drawn as step 2.
Measured in the browser on Rhino (55.75 s): 14 tiles loaded in 0.6 s, 1200 waveform bars, 13 layout
shots (all Fill, from its 9:16 reframe), a click at 50 % sought to 27.87 s, a drag to 80 % to 44.60 s,
4x made the strip 1440 -> 5760 px with 58 tiles and a horizontal scroll, the playhead stayed in view
while playing, Hide removed the strip; at 1100x700 no page scroll (video 260 px tall) and the visible
frames loaded in 1.4 / 2.4 / 3.6 s at zoom 1x / 2x / 4x (each zoom asks FFmpeg for new frames). No job,
no console errors.

**Edit Video step 2, part A: the cut list in the pipeline (2026-10-26), planned with the developer
first.** Decided: cut a copy first, manual deletion + Speech cleanup, the edited video as a new
result of the same project, zoom punch-in at the cuts, the silence tool card as part D (without its
AI badge). `pipeline/cuts.py`: `normalize` (sort, clamp, merge, drop < 0.05 s), `keep_ranges` (the
complement, slivers < 0.1 s dropped), `snap_to_frames`, `shift_time` / `shift_transcript` (a word is
dropped when its middle is cut, an edge word is clipped to its keep, the rest shift left),
`cut_filter` (`split`/`asplit` -> `trim`/`atrim` per keep, a 10 ms `afade` in and out, odd parts
`crop` 1/1.10 + `scale` back for the punch-in, `concat` v+a) and `cut_video` (cq 19 / crf 16, cached
by `edit/source.json` = keeps + transition + source size/mtime). `make_clips --cuts <json> --transition
punch|hard` (needs `--full` and the original `transcript.json`) writes `edit/source.mp4`,
`edit/transcript.json` (shifted, no Whisper) and `edit/audio.wav`, then runs the normal `--full`
pipeline on the copy with `work_dir = edit/`, rendering into `full_edit` / `full_edit_<aspect>`. The
source video is only read.
Two sync bugs found by measuring the first real run, both fixed: `trim` keeps whole frames while
`atrim` cuts exactly, so each part's picture was up to a frame shorter than its sound -- every edge
is now snapped up to a frame time and the transcript uses the same snapped keeps; and the Rhino
source's audio (55.746 s) is longer than its picture (55.639 s), so the last part ran out of frames --
the length is now the video stream's (`video_seconds`), not the file's. Measured on Rhino with the
26.47 s pause and three words cut, punch-in, 16:9 + center: the whole job 12.9 s; the copy and the
render are video 28.945 s / audio 28.945011 s (was 28.945 / 29.036); keep edges at frames 311, 941,
975, 986; the 2nd part matches a 110 % zoom of the source (diff 2.4 vs 16.9 plain) and parts 1 and 3
match the plain source; "That's" sits at 13.054 s in the `.vtt` (39.33 s in the source, shifted by
the cut); the source MD5 unchanged. Tests: `tests/test_cuts.py` (9); 596 pass.
**Part B: the sidecar.** `JobRequest.cuts` (`[[start, end], ...]`) + `transition`: `start_job` writes
them to `output/<name>/edit/cuts.json`, passes `--cuts <that file>`, and saves them in `project.json`
(`manage.read_cuts` / `write_cuts`, key `edit`, beside the title and the ratings); cuts without `full`
or an empty list are 400, and the folder is created first (a test found the save failing on a project
with no folder yet). A cut job reports into `full_edit*` (`jobs.output_folder`). `GET/PUT
/projects/{name}/cuts` keep the editor's deletions across openings (404 without the project, 400 on
a bad pair or transition). `GET /projects/{name}/cleanup?pause=&fillers=` (`editor.cleanup_suggestions`)
suggests pauses longer than `pause` cut with `CLEANUP_BREATH_SEC` (0.12 s) of breath kept on each
side, and fillers from the new, narrower `config.CLEANUP_FILLERS` / `CLEANUP_PHRASES` (um, uh, er,
"you know", "I mean" -- not the clip-start list, whose "yeah" / "right" / "exactly" are real answers
mid-sentence). `REFRAME_FOLDER` accepts `full_edit` / `full_edit_<w>x<h>` and results carry `edited`.
Measured on How-AI-agents (35.4 min): pause > 0.5 / 1 / 2 s -> 164 / 38 / 8 pauses, cut 126 / 68 / 37 s
(5.9 / 3.2 / 1.7 %), plus 31 fillers -- "you know" 18, "I mean" 6, "um" 5, "uh" 2 (Whisper writes few
um/uh, as expected); 64-70 ms per request. "I mean" can carry meaning, which is why these are
suggestions to review. Rhino: 3 / 2 / 1 pauses, 0 fillers. Tests: `tests/test_cuts_api.py` (5, with
their own `JobRunner` so a stubbed job left `running` cannot 409 the next test); 601 pass.
**Part C: cutting in the editor.** `src/cutList.ts` mirrors `cuts.py` in the browser (`normalize`,
`add`, `subtract` -- restoring part of a cut can split it in two -- `cutAt`, `isCut` by the item's
middle like the pipeline, `removedSeconds`, `partIndex` numbered as `cut_filter` numbers keeps). In
`EditorScreen`: a click on a word or pause selects it and seeks, Shift+click extends, Delete /
Backspace or the red "🗑 លុប (N)" button cuts the selection, a click on a cut item restores it; cut
items are struck through, selected ones tinted `info`. ↶ / ↷ and Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) keep
up to 100 earlier lists; a key in an input is ignored. The list loads from `GET /cuts` and saves 0.6 s
after the last change. **Speech cleanup** opens `CleanupPanel` in the right aside (one aside at a time
with Captions): pause 0.5 / 1 / 2 s, fillers on/off, a checkbox per suggestion, a click seeks, apply
merges them into the list. The preview **skips cuts while playing** with a `requestAnimationFrame`
loop (`timeupdate` arrives only ~4 times a second) and shows the punch-in as CSS `scale(1.1)` on odd
parts; the time reads `00:55.64 → 00:28.xx`; the timeline draws each cut as a red hatched band;
a Transition menu chooses Zoom punch-in / Hard cut; Export sends `cuts` + `transition` (none = the
plain `--full` render into `full*`), and an edited result is titled "... · កែ" on the Review page.
Measured in the browser on Rhino (`POST /jobs` intercepted): selecting 3 words -> "លុប (៣)", Delete
-> 3 struck, "កាត់ ១ · 1.2 s"; undo 0, redo 3, a click on a struck word restores one; the save reached
`project.json` and a fresh page opened with the same 4 cuts; cleanup at 0.5 s offered 2 pauses + the
existing cut, apply -> "កាត់ ៤ · 28.3 s", 4 hatched bands; the Export body carried the 4 cuts and
`transition: hard`; playing from 12.0 s with the cut 12.98-39.21 reached 39.99 after 2.5 s, with
`scale(1.1)` on part 1; no console errors. A real job with the same body (two cuts, punch, 16:9) ran
in 14 s: video 28.695 s / audio 28.695011 s in `full_edit_16x9`, `edited: true`, the source MD5
unchanged. The test cuts were cleared from `project.json` afterwards.
**Part D: the "លុបភាពស្ងាត់ & អឺ" card is real.** Preset `silence` is `ready` (`{ full: true }`) and
the card has no badge any more (`Tool.badge` may be `null`: the suggestions are rules over the
transcript, not AI). It opens `screens/SilenceDialog.tsx` (640 px): step 1 is the shared picker;
step 2 shows the video (frame, length, `720p · 16:9`, ប្ដូរ), transcribes once with `--transcribe-only`
when there is no transcript (`TranscribeState`, exported from `EditorScreen`), then `CleanupPanel`
without its own button (`onChange` reports the ticked suggestions from an effect), a Zoom punch-in /
Hard cut segmented control, and a "burn subtitles" switch (off by default). The footer reads
`0:55 → 0:28` and "លុប N កន្លែង · Export", which runs `startReframe` with the video's own aspect,
`--layout center`, the cuts and the transition (tool `editor`, toast "វីដេអូរួចរាល់ហើយ!"). The cuts
are saved in `project.json` like the editor's, so Edit Video opens with them. `nearestAspect` moved
to `screens/aspects.ts` (lint: a component file may export only components).
Measured in the browser: the card without a badge -> step 1 with `#video-path`; Rhino -> "២ pause ·
27.0 s" (1.04 s, 26.47 s), Export enabled; Hard cut + subtitles on sent `full, 16:9, layout center,
cuts [[10.54,11.34],[12.98,39.21]], transition hard` with the caption style and the dialog closed;
`Black Rhino_OpusClip.mp4` (never transcribed) posted `transcribe_only: true` at once and showed
"កំពុង transcribe"; no console errors. One real run from the dialog (no interception, punch, no
subtitles): toast at 16 s, `full_edit_16x9/clip_01.mp4` video 28.654 s / audio 28.654 s, source MD5
unchanged; the cuts were cleared from `project.json` afterwards.

**Background and Tracker menus (OpusClip screenshots, 2026-10-26), planned with the developer
first.** Decided: on the Edit Video toolbar; the two tracking off-switches now, manual subject
tracking as its own later step (OpenCV 5.0 already has `TrackerMIL`, no model download); Blur +
Color + Image backgrounds, Video drawn disabled (Phase 3). **Step 1, the pipeline:**
`--fit-background blur|color|image`, `--fit-blur 0..100` (`boxblur` radius = strength x 0.6, so the
default 33 is the old `boxblur=20:5` and 0 is none), `--fit-color`, `--fit-image` (read only; render
converts it once to `.fit_background.png` in the render folder for `movie=`, deleted afterwards),
`--fit-spacing 0..20` % (`fit_foreground_size` fits the video inside the remaining room, even sizes)
and `--fit-radius` px (a grey `.fit_mask.png` of the foreground's size through `alphamerge`, so the
corners show the background, not a solid colour as the panel masks do). They only change `fit`
shots; with no spacing or radius the old `scale=W:-2` chain is used unchanged. `--no-tracking` and
`--no-track-ranges <json>` go through `reframe.tracking_allowed`: a shot overlapping a range keeps a
static box; with `--cuts` the ranges are shifted into the cut copy (`cuts.shift_range`).
Measured: six 6 s Fit renders of Rhino (blur 33 / 0 / 100, colour, gradient image, spacing 8 + radius
40) all 1080x1920, 6.006 s video / 6.000 s audio, no temp files left; blur 33 8.1 s against blur 0
2.5 s (boxblur is the cost, as before). Planning the whole Rhino video at 9:16: tracking on -> one
moving shot (32.87-45.13 s), `--no-tracking` -> none, a range over that shot -> none, a range at
0-5 s -> the moving shot stays; the 13 shots' layouts identical in every case. Tests:
`tests/test_background.py` (6); 607 pass.
**Step 2, the sidecar.** The settings are one "look" (`manage.clean_look`: background blur|color|image,
blur 0-100, `#RRGGBB`, image, radius 0-200, spacing 0-20, tracking, `no_track` ranges in source
seconds), saved under `look` in `project.json` beside `edit` (the default look removes the key).
`write_look` copies a picked image into `output/<name>/background.<ext>` (`store_background`; the
original is only read, an image already there is not copied again), and `read_look` falls back to
blur if that copy has gone. `GET/PUT /projects/{name}/look`, `GET /projects/{name}/background` (the
copy, for the preview), `GET /image?path=` (a just-picked jpg/png/webp, read only, before saving) and
`GET /scenes?path=` (`editor.scenes`: the same `detect_cuts` + `split_into_shots` the planner uses,
cached in `output/<stem>/scenes.json` by size + mtime + threshold). `JobRequest.look` is turned into
flags by `manage.look_options` (defaults are not sent) plus `no_track.json` for `--no-track-ranges`
(not written when tracking is off altogether); a bad look is 400.
Measured: `/scenes` on Rhino 1.7 s cold, 13 ms cached, 13 scenes equal to the plan's 13 shots; a real
job with a colour look, spacing 6, radius 30 and the moving scene off (4:5, so into a new `full_4x5`)
ran to `done` in 31.9 s with `--fit-background --fit-color --fit-radius --fit-spacing
--no-track-ranges` on its command line, 1080x1350; Rhino has no Fit shot, so the colour itself was
checked in step 1. The test folder, `no_track.json` and the look were removed afterwards (the job row
stays in the history); the source MD5 unchanged. Tests: `tests/test_look_api.py` (6); 613 pass.
**Step 3, the UI.** `screens/LookMenus.tsx`: `BackgroundMenu` (290 px, `MenuButton` gained `width`):
Blur with a strength slider, Color (`<input type=color>`), Image (`pickImage` in `pickFile.ts` -- the
Windows dialog in the app, a path field in a browser), Video disabled with PHASE 3, Corner radius
and Spacing sliders, "Apply to all same layout" ticked and locked (one render, one look), and a line
that it affects Fit shots. `TrackerMenu`: Manual subject tracking disabled ("ជំហានបន្ទាប់"), off / on
for the scene at the playhead (from `/scenes`), all off / on; the label reads `Tracker: ON`, `ON ·
បិទ N` or `OFF`, and the timeline draws each scene that is off as a dashed `info` band "Tracker OFF".
`EditorScreen` loads the look with `/look`, saves it 0.6 s after a change (taking back the copied
image's path) and sends it with Export (`App.onExport` -> `startReframe(..., { look })`). With layout
Fit on a reframe the preview is drawn as the render would: `FitBackdrop` behind the video -- for
blur a 160x284 canvas that redraws the same `<video>` every frame (cover-scaled) under CSS
`blur(r x 1.2 x preview scale)`, a colour `div`, or the image `object-cover` -- and the video in a box
sized like `fit_foreground_size` with the radius scaled to preview pixels (`ResizeObserver` on the
stage). The Export line says the planner uses Fit only on still shots.
Measured in the browser on Rhino (`POST /jobs` intercepted): 9:16 + Fit draws the canvas; spacing 8
-> the video box 84 % x 26.58 % (= 0.84 x 0.5625 / 1.778), radius 40 -> 8.7 px on a 234 px stage, blur
70 -> `blur(10.9px)`; Color turned the backdrop green and the label "Background: Color"; Image from a
typed path loaded in the menu and on the stage and the next save carried
`output/Rhino Charge Ivan Carter/background.jpg`; at 35 s "turn off this scene" saved `no_track
[[32.866, 45.128]]`, the label read "Tracker: ON · បិទ 1" and one OFF band showed; Export sent the
look with `9:16, fit`; no console errors. The test look and the copied image were removed afterwards.
`shot.mjs` now stops at Review on `កែ Subtitles របស់ clip នេះ`, a selector from before the Review
redesign (the projects on this machine now have clips, so that part is no longer skipped) -- not
caused by this step and not fixed yet.

**Manual subject tracking, step 1: the pipeline (2026-10-26), planned with the developer first.**
Decided: pick by click, track on Apply and show the path. `pipeline/subject_track.py`:
`pick_subject` (the smallest YOLOX box under the click, else the nearest within 10 %, else a square
"area" of 25 % of the frame height -- on the **full-size** frame: the 640 px frame scaled back up
found nothing where the full frame found a "cow" 592x709), `track_subject` (frames of the scene at
12 fps, at most 360, 640 px wide; `TrackerMIL` forward from the click to the scene end and backward
to its start), a drift check (HSV histogram correlation with the clicked box under
`SIMILARITY_MIN` 0.35, or the centre leaving the frame, ends the path; MIL itself reports "lost"
for 0 of 120 frames even on grass), `Track` (dict round trip), `tracks_for_shot`, `shift_track` for
`--cuts`. `reframe.manual_box` turns the path into the same moving `x_expr` as face tracking, and
`plan_shot` uses a manual track first. `make_clips --subject-tracks <json>` fills
`config.SUBJECT_TRACKS`. Tests: `tests/test_subject_track.py` (6); 619 pass.
**Measured on Rhino, and MIL is not good enough:** the handheld people scene (32.87-45.13 s, a click
on the person at 36 s) tracked the whole scene (146 points, 13.6 s), but the old static crop also
held the person in 16 of 16 frames there, so it proves nothing. The charge scene the developer
reported (27.82-32.87 s) is several fast cuts, motion blur and dust in one scene: YOLOX finds the
rhino at 29.0 s only, not at 28.4 / 30.5 s or in 16 check frames; an "area" click on the rhino's head
at 28.4 s loses it within 0.5 s (drawn frame by frame: by 28.95 s the box sits on bushes, then on
dust), and the drift check correctly stops the path after 0.17 s. OpenCV 5.0 also has
`TrackerVit` (opencv_zoo `object_tracking_vittrack_2023sep.onnx`, ~0.7 MB) with a real tracking
score (`tracking_score_threshold`) -- not downloaded; the developer decides.
**Switched to `TrackerVit` (developer: "start download").** `models/object_tracking_vittrack_2023sep.onnx`
from opencv_zoo, 714,726 bytes, SHA-256 `2990f0b7...478e91d`, git-ignored like the other models;
`config.TRACKER_MODEL_PATH/URL`, listed by `check_env.py` and `/env` (now 4 ONNX models). Without
the file `track_subject` falls back to MIL. Measured on the same clicks: ViT 14 ms/frame against MIL
94 ms; the people scene tracked end to end in 4.2 s (MIL 13.6 s), 147 points, the person moving
630-1072 px with scores 0.49-0.70 -- the coverage check still reads 16/16 for both the static and the
manual crop, so the gain there is speed, not framing. In the charge ViT holds the rhino's head to
about 29.0 s (score 0.12-0.35) and then its box spreads to the whole frame (660x375 of 640x360) with
the score **rising** to 0.6-0.7, so the score alone cannot detect the loss: the path also ends when
the box is wider than `BOX_WIDTH_MAX` (80 %) or grows past `BOX_GROWTH_MAX` (6x). With
`VIT_SCORE_MIN` 0.30 the charge stops at the click (first scores 0.12-0.18) and the crop stays
still there: the charge cannot be tracked by either tracker.
**A video where it helps (developer chose to measure before building the UI).** `Black Rhino_OpusClip`
is already 9:16, and the podcasts barely move, so the first 8 minutes of three videos were scanned
for shots >= 3 s with a moving person or 2+ people; the real movers were B-roll in `Table For Four`,
e.g. 200.04-208.08 s, a waiter carrying a plate to the table while the camera follows. The AI plans
that shot as **split** (the man's face, then jugs and glasses, over a small plate). A click on the
plate first hit the waiter's YOLOX "person" box (565x378) and followed his arm; an "area" box around
the click is what follows the plate: ViT reshapes it to the plate (90x90 -> 215x42) and grows it as
the plate comes closer (to 606x123). That exposed the first stop rules as too strict -- one score
under 0.30, or growth past 6x the first box, ended a correct path after 0.7 s -- so they are now a
score under `VIT_SCORE_MIN` 0.25 for `LOW_STREAK` 3 frames in a row (the tail of low frames is
dropped) or a box over `BOX_AREA_MAX` 60 % of the frame's area or `BOX_WIDTH_MAX` 90 % of its width;
the charge still stops at the click and the people scene still runs end to end. Rendered for real to
the scratchpad, the manual "area" track keeps the plate large and centred from 200.5 to 207.6 s
(path 200.64-204.56 s, then held where the plate sits on the table), where the AI's split shows it
small in the lower panel. So the dialog needs a choice between the YOLOX subject and an area around
the click (OpusClip's "subject or area"): which one is right depends on what was clicked. Tests: 2
more with a fake tracker; 621 pass.
**Step 2, the sidecar.** `track_subject(..., mode="subject"|"area")` (`area_box` is the square around
the click). `POST /projects/{name}/pick {video, time, x, y}` (x, y as 0-1 of the frame) returns both
boxes in source pixels -- the YOLOX subject under the click (or `null`) with its label, and the area
-- so the dialog can draw them before anything runs. `POST /projects/{name}/track` (+ `mode`) finds the
scene at that time (`editor.scenes`), tracks it, and saves the path in the look: `subjects` holds one
`Track.as_dict()` per scene (a new pick in the same scene replaces it, and that scene leaves
`no_track`), validated by `clean_look` through `Track.from_dict` (a malformed one is 400, not 500).
It answers 409 while a job runs (same CPU as the render), 404 without the project, 400 for a video
whose stem is not the project's or a time outside every scene. `DELETE /projects/{name}/track?start=&end=`
is Reset. A job with `look.subjects` writes `subject_tracks.json` and passes `--subject-tracks`.
Measured through a test sidecar on Rhino: `/pick` at 36 s 1.2 s (person 705,101,416,610 and the area
822,316,180,180), `/track` on the people scene 4.1 s with ViT, 147 points 32.91-45.09 s, saved; Reset
emptied it; the look was set back to the default afterwards (which also cleared a `no_track` left
by the step-3 browser test). Tests: `tests/test_track_api.py` (4); 625 pass.
**Step 3, the UI.** Tracker -> "Manual subject tracking" opens `screens/SubjectTrackDialog.tsx`
(1000 px, after OpusClip's): the source video large -- a click pauses it, sends the point as 0-1 to
`/pick`, and draws a dot, the chosen box and a dimmed surround; chips **Subject · <label>** (disabled
when YOLOX found nothing) / **Area**, with a line saying an object in someone's hand wants Area; a
play button and a strip of the scenes (from `/scenes`) whose width follows their length, the current
one outlined, a gold underline under every scene with a path; Track: This scene (Whole clip
disabled, "next step"), Reset (`DELETE /track`) and Apply (`/track`), which reports the covered range,
points and seconds, and warns when under 60 % of the scene was followed. While it plays, a green box
of the clicked size moves along the saved path (`src/subjectPath.ts`: `pathAt` interpolates and
holds the end points, `trackAt` finds the scene's path). In the editor the Tracker label adds
"· ដោយដៃ N", the timeline shows a gold "Subject" band, and a reframed preview moves its crop along
the path (`object-position` computed from the crop width, as the render's `x`).
A bug the test caught: the dialog opened at 0 s instead of the playhead, because setting
`currentTime` before the video has metadata is ignored, so the click tracked scene 0-2.6 s. The time
is now set in `onLoadedMetadata`, and a click before that uses the dialog's own time.
Measured in the browser on Rhino (tracking real, only `POST /jobs` intercepted): the dialog at 36.00 s
with 13 scenes and the hint; the click offered "Subject · person"; Apply took 5.0 s (4.4 s tracking)
and followed 32.9-45.1 s with 147 points, 1 scene underlined; the green box moved 54.4 % -> 56.3 %
while playing; "Tracker: ON · ដោយដៃ 1", one Subject band; the 9:16 preview's `object-position` went
76.8 % -> 61.2 % between 34 s and 44 s; Export carried the path (147 points); no console errors. A
CLI render with that path (`--full --aspect 4:5 --subject-tracks`) planned the scene as `single` and
kept the person framed at 34 / 37 / 40 / 43 / 44.8 s. The test folder and the look were removed
afterwards; the source MD5 unchanged.

**`shot.mjs` fixed for the redesigned Review (2026-10-26) -- asked for by the developer.** It still
drove the list-era Review (`កែ Subtitles របស់ clip នេះ`, `#clips-title`, checkbox rows) and only got
through while no project had clips. Now: (1) the project is the one `/projects` lists with the most
clips, not `Taylor_Tomlinson` by name -- that folder now holds only `audio.wav` (25 Oct 21:06) from
an `interrupted` job, so its card opened the Long to Short dialog; (2) Review waits for the "Clips
ដើម" heading, counts grid cards and loaded thumbnails, opens the first card's dialog and reports its
title, "Clip ១ / N", the video size and the timed paragraphs; (3) Subtitles opens from a card's
"កែ Subtitles" icon and returns with "ត្រឡប់ទៅ Clips"; (4) `--export-to` uses "ជ្រើស", ticks only
clip 1 and exports from the footer; (5) without `--job` every `POST /jobs` is answered 503 by the
script itself (Subtitles starts a `--clean-only` preview by design, and a wrong selector once started
a real job) and the count is printed. Measured: How-AI-agents, 15 cards / 15 thumbnails, dialog
"Why AI agents fail" 1080x1920 with 2 paragraphs, Subtitles 35 cues / 35 blocks / 2 safe bands on the
clean preview, export of one clip to the scratchpad (MP4 + SRT), Models page, 0 jobs refused,
`problems: none`.

**Motion, step 1 of 5: the pipeline (2026-10-26), planned with the developer first.** Decided: a
Motion panel in Edit Video's right sidebar with slow camera zoom, keyword zoom, camera shake,
caption animation and the Transition menu moved into it, applied to the whole video.
`pipeline/motion.py` builds **one `perspective` filter per shot**, placed after the layout and before
the captions (the text never zooms or shakes): the source rectangle shrinks for zoom and moves for
shake, and is mapped back onto the whole frame. Why `perspective`: on a still 1080x1920 picture
zoomed 100 -> 110 % in 5 s, `scale` (eval=frame) + `crop` froze 53 of 82 frames and jumped up to
1.88 px, because sizes move in steps of 2 px; `perspective` (float corners, cubic) froze 4 of 149,
jumped at most 0.35 px and rendered in 2.5 s against 4.0 s. It has no `t`, so time is `on/fps`
(`cuts.frame_rate`); `on` restarts in every shot, which is what makes the camera zoom restart per
scene. Flags: `--motion-zoom off|in|out`, `--motion-zoom-amount` (% per scene, 1-20, default 8),
`--motion-keywords` (% bump, 0 = off), `--motion-shake off|loud|all`. Keyword moments are the words
`captions.pick_keywords` picks, at least `KEYWORD_GAP_SEC` 3 s apart, each a gaussian bump peaking
0.12 s after the word; loud moments are the 0.25 s windows of `audio.wav` above the 90th percentile
(merged under 0.5 s apart); shake is two incommensurate sines of 0.6 % amplitude, faded in and out
over 0.15 s (switched on hard it jumped 6 px in one frame), with a constant 1.5 % overscan so no edge
shows; the total zoom is capped at 1.25. `make_clips` computes the cues per clip from the (shifted)
transcript and `edit/audio.wav`, and `render_all` -> `render_clip` -> `render_segments` pass them on.
Measured on Rhino (`--full --aspect 4:5`, into a scratch `full_4x5` deleted afterwards): the job 32.5 s
without Motion, 52.8 s with all three; length unchanged; the zoom read back from the frames (scale
that maps the plain render onto the Motion one, outside the caption band -- a first measurement that
included the captions, identical in both, read 1.000 everywhere): the scene 9.55-21.10 s ramps
1.000 -> 1.055 -> 1.095 as computed, the scene 32.87-45.13 s 1.025 -> 1.095 with bumps to 1.125 at the
keyword 39.89 s and 1.14 at 43.09 s; shake shifts of 3-8 px in loud moments and 0.0-0.3 px in quiet
ones; the darkest frame edge during shake 27.5 against 25.5 without Motion (dark ground, no black
border); the captions identical in place and size; source MD5 unchanged. Tests: `tests/test_motion.py`
(6).
**Step 2: caption animation.** `--caption-animation pop|bounce|fade|slide|none`
(`config.CAPTION_ANIMATION`, default pop = what it always did). Only pop grows the spoken word
(`\fscy110`); bounce / fade / slide animate the whole cue as it appears over `CAPTION_INTRO_MS` 160 ms
(`captions.intro_tags`: bounce `\fscx70\fscy70` -> 112 % -> 100 %, fade `\alpha&HFF&` -> 0, slide
`\move` up 2 % of the height with half alpha), none is colour only. Every spoken word is its own
`Dialogue` event, and the first word can be shorter than 160 ms, so each later event of the cue gets
the same tags with its times shifted back by its offset (`\t(-70,90,...)`). That relies on libass
accepting negative times, measured before building: a slide split into 70 ms + longer events moved
1038.5 -> 1030.5 -> 1022 -> 1013.5 -> 1005.5 -> 998.5 px across the event boundary, with no jump.
Measured on a 6 s Rhino clip, the first frames of a cue (~42 ms apart): pop at once; bounce width
342 -> 419 -> 422 -> 394 px; fade 3 frames below the white threshold, then full; slide from y 1406 to
1396 while turning opaque; none at once with no growth. 5 more tests; 637 pass.
**Step 3: the sidecar.** Motion is one dict (`manage.clean_motion`: zoom off|in|out, zoom_amount 1-20,
keywords 0-20, shake off|loud|all, animation from `CAPTION_ANIMATIONS`), saved under `motion` in
`project.json` beside `look`, `edit` and the title (the default removes the key). `GET/PUT
/projects/{name}/motion`; `JobRequest.motion` becomes `--motion-*` / `--caption-animation` through
`manage.motion_options` (defaults send nothing, a bad value is 400); `JobRequest.caption_animation`
also exists on its own for other screens. The Transition stays with the cuts (`edit.transition`) --
the UI only moves its menu. Measured: a real job through a test sidecar on Rhino (4:5, scratch
folder) ran in 52.8 s with `--motion-zoom in --motion-keywords 8 --motion-shake loud
--caption-animation slide` on its command line, 38 slide entrances in the `.ass`, and the motion
read back from `/motion`; folder and motion removed afterwards, source MD5 unchanged. Tests:
`tests/test_motion_api.py` (5); 642 pass.
**Step 4: the UI.** A **Motion** button (frame-corners icon) under Captions in Edit Video's right
sidebar opens `screens/MotionPanel.tsx` in the 300 px aside (one aside at a time with Captions and
Speech cleanup): Camera zoom Off / ពង្រីក / បង្រួម with a strength slider, keyword zoom switch +
strength, shake Off / សំឡេងខ្លាំង / ពេញវីដេអូ, caption animation Pop / Bounce / Fade / Slide up / None,
and the Transition (Zoom punch-in / Hard cut), which left the preview toolbar. The motion loads from
and saves to `/motion` 0.6 s after a change, and Export sends it (`App.onExport` -> `{ motion }`).
Preview: `src/motionPreview.ts` is `motion.py`'s formula in TypeScript, fed by the scenes and by
`GET /projects/{name}/motion/cues` (new: keyword moments and loud ranges for the whole video,
computed by the same Python as the render); a `requestAnimationFrame` loop writes the transform
straight onto a wrapper around the backdrop and video (not React state, not the captions), and
once per `time` change while paused. `LiveCaption` restarts a CSS animation (`caption-bounce`,
`-fade`, `-slide` in `index.css`, 160 ms) for every new group of words, and pop grows the spoken word
110 % tall -- the preview had never shown pop before.
Measured in the browser on Rhino (9:16, `POST /jobs` intercepted): the Transition menu is gone from
the toolbar, five sections; zoom read from the wrapper 1.0195 / 1.0554 / 1.0948 at 9.7 / 15.3 /
20.9 s (the render measured 1.000-1.016 / 1.055 / 1.095), 1.147 at the keyword at 40.0 s (render
1.12-1.125 around it, 1.147 computed), 1.0689 at 41 s (render 1.070); shake moving while playing in a
loud range; the bounce class on the caption at 40 s; save and Export carried
`{zoom: in, keywords: 8, shake: loud, animation: bounce}`; no console errors. Two traps in the test,
not the app: a headless seek takes longer than 500 ms, so wait for `seeked`; and a saved motion is
reloaded, so a second run of a test that clicks a switch turns it **off** again (keywords 8 -> 0 on
the second run, found with a temporary log). Motion was reset afterwards; a `look` with blur 60 in
Rhino's `project.json` was not set by these tests and was left alone. 643 pass, `shot.mjs`
`problems: none`.

**Captions in three tabs (Presets / Font / Effects, OpusClip screenshots, 2026-10-26), planned with
the developer first.** Decided: Animation moves from Motion to Captions › Effects; only fonts already
installed (nothing downloaded); one shared panel for Edit Video and the Subtitles screen. **Step 1,
the pipeline:** `config.apply_caption_look` (called after `apply_caption_style`) behind
`--caption-font` (a face name, e.g. `Montserrat Black`, `Inter Bold`, `Impact`), `--caption-text-color`,
`--caption-outline-color`, `--caption-italic`, `--caption-underline` (Style flags),
`--caption-shadow x,y,blur,#RRGGBB` (`\xshad \yshad \blur` tags on every `Dialogue`, the colour as
the Style's BackColour at the old half alpha), `--caption-keywords` + `--caption-keyword-colors c1,c2`
(the `pick_keywords` word of each cue keeps its colour, alternating per cue, while another word is
spoken), and `--caption-lines 1-3` (`CAPTION_MAX_LINES`; the font size does not change).
`--caption-outline` now goes to 12 px (the screenshot uses 10). **The default look writes the same
Style line and no extra tags** (checked against the old literal). `find_font_file` also reads the
Windows registry Fonts key, because a file name is not a font name: "Arial Black" is `ariblk.ttf`,
and the first render silently fell back to Inter Bold. Measured on a 6 s Rhino clip at one moment:
Montserrat Black Italic in yellow with a blue 8 px stroke, Inter Bold underlined, Impact with a red
shadow offset 6/6 and blurred 5, Arial Black on one line (13 events instead of 24) with the keyword
"BETWEEN" kept green while "THE" is spoken; default unchanged. Tests: `tests/test_caption_look.py`
(8); the outline-limit test now refuses 13 instead of 9; 651 pass.
**Step 2, the sidecar.** `server/fonts.py`: nine heavy faces for captions (Montserrat SemiBold / Bold
/ ExtraBold / Black, Inter Bold, Arial Bold / Black, Impact, Segoe UI Black), listed only when
`find_font_file` finds them, each checked first with FFmpeg's `fontselect` log (every name opened its
own file; real italic files exist for Montserrat SemiBold / ExtraBold / Black and Segoe UI Black,
the rest are slanted by libass -- including Montserrat Bold, whose Bold Italic file libass did not
pick). Each carries `em_scale` = unitsPerEm / (winAscent + winDescent) read from the `.ttf`'s `head`
and `OS/2` tables, for sizing the preview: Montserrat ExtraBold 0.6402 (the 0.640 measured earlier from
frames), Inter Bold 0.826, Arial Bold 0.895, Arial Black 0.709, Impact 0.820, Segoe UI Black 0.752.
`GET /fonts`; `GET /projects/{name}/cues?words&lines` (new: the whole video's cues from
`wrap_into_cues`, for Edit Video's preview, with each word's `keyword` from `pick_keywords`); the
clip `/cues` takes `lines` and also marks keywords. `JobRequest` gains the nine look fields; an
unknown font, a bad colour, shadow or line count is 400 before the job starts (`_check_caption_look`
runs `apply_caption_look` on a saved copy of the config); and the flag builder now skips `False`
(it would have sent `--caption-italic False`, which a typer flag refuses).
Measured through a test sidecar: `/fonts` 0.58 s the first time (registry + nine `.ttf`s, cached
after), 9 faces; Rhino's whole-video cues 18 with 3 lines, 33 with 1 line (max 1), 16 / 25 keywords,
7-9 ms; How-AI-agents (35 min) 0.28 s, 480 KB. Tests: `tests/test_caption_look_api.py` (8); the
`/cues` test's stub takes `lines`; 659 pass.
**Step 3, the UI.** `CaptionStyle` gains `font, textColor, outlineColor, italic, underline, shadow {on,
x, y, blur, color}, keywords, keywordColors, lines, animation`; `styleOptions` adds them through
`lookOptions` **only when they differ from the defaults**, so a job that changes nothing sends the
same flags as before; saved defaults merge with `DEFAULT_STYLE`, so old ones still load. Two new
presets that the renderer really draws: **Black Italic** (Montserrat Black italic, 90 %) and **Impact**;
the existing presets now also set the font back. `screens/CaptionPanel.tsx` is the one panel for Edit
Video (340 px aside) and the Subtitles screen (replacing its own tabs, keeping its "every clip"
footer): **Presets** (each card draws "TO GET STARTED" in the preset's real style -- `PresetCard`
uses `captionTextStyle`; a preset whose font is not installed is dimmed), **Font** (family + weight
from `/fonts`, text colour, size %, Italic / Underline toggles with a line when libass slants a face
that has no italic file, Uppercase, stroke colour + 0-12 px, shadows switch + colour + x / y / blur,
AI keywords highlighter + two colours, Khmer font PHASE 2), **Effects** (Position, Animation --
moved here from the Motion panel, which lost that section --, Lines Three / One, words per cue,
Highlighted word colour with the quick swatches). `src/captionLook.ts` holds what both previews
share: the face -> CSS font map (Montserrat 600/700/800/900 and its italics now bundled from
`@fontsource/montserrat`; Inter, Arial, Impact, Segoe UI are the Windows fonts libass uses),
`useCaptionFonts` (one `/fonts` request per app run), `emScaleOf`, `captionTextStyle` (font, weight,
italic, underline, colours, stroke, shadow at the render's half alpha) and `wordColour` (spoken word >
keyword colour, alternating per cue > text colour). `CaptionOverlay` (Subtitles) uses the font's own
`em_scale` instead of the fixed Montserrat ExtraBold constant, asks `/cues` with `lines`, and grows the
spoken word only under Pop. Edit Video's `LiveCaption` now draws the **real cues** from
`/projects/{name}/cues` (lines and keywords as rendered) instead of grouping words in the browser,
sized `min(110 x width/1080, 30 % of height / 3.3) x size % x em_scale x preview scale` like
`apply_aspect`. Export sends `motion.animation` equal to the style's, and the motion is saved that way
too, so `project.json` never brings back an old animation; a motion saved with one hands it to the
style once.
Measured in the browser (test sidecar + Vite, `POST /jobs` intercepted): Edit Video -> Captions shows
Presets / Font / Effects, 8 preset cards drawn in their own style; Black Italic -> the preview in
Montserrat 900 italic; the Font tab lists Montserrat, Inter, Arial, Impact, Segoe UI; Impact +
underline + blue stroke + shadow 4/1/3 + keywords -> the preview in Impact with stroke
`rgb(30, 58, 138)`; Effects bounce + One line -> one line "BETWEEN THE" with the bounce class; Export
sent `caption_font Impact, caption_outline_color #1E3A8A, caption_italic, caption_underline,
caption_shadow 4,1,3,#000000, caption_keywords, caption_keyword_colors, caption_lines 1,
caption_animation bounce` and `motion.animation bounce`. Subtitles on How-AI-agents: the same tabs, the
15-clip footer, Black Italic + One line -> `/cues?...&lines=1` and one overlay line in Montserrat 900
italic; no job started, no console errors. 659 pass, `shot.mjs` `problems: none`. Rhino's motion,
saved by the test, was reset.
**Step 4: preview against the real render.** Measured the same way on both sides, so stroke and
shadow count equally: the render is How-AI-agents clip 1's `clip_01_clean.mp4` with each style's real
`.ass` (from `build_ass` with the clip's `layout.json` shots) burned on in the scratchpad, minus the
same clean frame; the preview is the Subtitles stage screenshotted with the style (set through the
saved defaults) and again with "no captions" at the same paused frame, scaled to 1920. Caption boxes
in output pixels:

| style | render (x, y, w x h) | preview | size | centre shift |
|---|---|---|---|---|
| default (2 lines) | 180, 786, 723 x 150 | 182, 787, 716 x 149 | 99 % / 99 % | -1, +1 |
| Impact, one line, shadow 4/4/3 | 446, 820, 189 x 88 | 448, 820, 185 x 86 | 98 % / 97 % | 0, -1 |
| Arial Bold italic, 110 % | 43, 765, 1025 x 190 | 44, 768, 1008 x 182 | 98 % / 96 % | -7, -1 |

Two visible differences, neither in size or place: at the Impact moment the render colours "I" and
the preview "AND" -- the moment sits on a word boundary and the browser's paused frame and FFmpeg's
frame fall either side of it; and libass slants Arial Bold (no italic file) a little more than the
browser does. A trap on the way: `-ss` before `-i` resets timestamps to 0, so the `ass` filter saw
0 s and drew nothing -- seek after the input when burning subtitles to check a moment. The test
servers were stopped and ports 8765 / 5173 checked free; nothing in `output/` was written.

**More caption animations (OpusClip's list of 19, 2026-10-26), planned with the developer first.**
OpusClip does not document what each name does, so each is our reading of the name, sorted into
three kinds: (A) how a cue appears, (B) the spoken word, (C) the whole time a cue is on screen. A
check before planning: `BorderStyle=3` with a per-word `\3a` puts a box behind one word only, and
`BorderStyle=4` a box behind the whole line, so Box / Highlighter / With backdrop are possible in
libass. **Group A:** `pipeline/caption_fx.py` now holds the animation tags (`captions.intro_tags`
delegates to it; `config.CAPTION_INTRO_MS` became `caption_fx.INTRO_MS` per kind): `slide_left`
(`\move` from 7.5 % to the right, fading in, 200 ms), `blur_in` (`\blur20` -> 0 while fading in, 220 ms),
`soft_landing` (`\move` down from 3 % above with ease-out `\t(...,0.5,...)`, 260 ms), `grow`
(`\fscx0\fscy0` -> 100 % with accel 0.6, 250 ms), and `baby_steps` (words not yet spoken drawn with
`\alpha&HFF&`, so they keep their place and the line never jumps). Measured from frames 40 ms apart
burned onto How-AI-agents clip 1's clean copy (scratchpad): slide_left centre x 591 -> 574 -> 557 ->
542 then still; soft_landing y 812 -> 821 -> ... -> 862; grow width 209 -> 347 -> 455 -> 545 -> 629 ->
705 -> 722; blur_in blurred and faint then sharp; baby_steps "RATE" -> "RATE NOW" -> ... -> the second
line "TELL", each word where it will finally sit. Tests: `tests/test_caption_fx.py` (6); 665 pass.
**Group B, the spoken word:** `caption_fx.active_word_tags` / `active_word_colour` /
`other_word_tags` replace the pop-only code in `captions.render_line`. `scale` (115 % both ways; the
neighbours move a little), `underline` (`\u1`), `seamless_bounce` (115 % over 0-70 ms, back by
170 ms, from each word's own event), `focus` (other words at alpha `&H99&`), `blur_switch` (other
words `\bord0\blur4`: with an outline libass blurs **only the outline** -- `\blur6` on its own left
the letters sharp, measured side by side), and two boxes drawn as a second event on layer 0 under the
text (`line_events`, style `Box` from `box_style`, `BorderStyle 3`, the same text with `\1a&HFF&` and
`\3a&HFF&` on every word but the spoken one, so the box sits behind that word only): `box` (box in
the highlight colour, dark `#111111` text with no outline) and `highlighter` (bigger padding, alpha
0x60, normal text colour). Measured on the same strips: seamless_bounce "RATE" 50 -> 54 -> 51 -> 48 px
wide over 120 ms; box dark text on yellow; the box is a little tall because it follows the font's
line height. Tests: 6 more; 671 pass.
**Group C, the whole time a cue is on screen** (`caption_fx.hold_tags(offset_ms, cue_ms)`, so
`dialogue` / `line_events` now carry the cue's length): `breathe` (100 -> 105 % -> 100 % every
1.4 s), `baby_earthquake` (`\frz` stepping through six small angles every 70 ms; a later word's
event starts from the angle already reached), `glitch_infinite_zoom` (the cue zooms 100 -> 118 %
over its whole length, over two colour layers -- red 9 px left, cyan 9 px right, no outline, alpha
0x50 -- on layer 0), and `with_backdrop` (style `Backdrop`, libass `BorderStyle 4`: one dark box,
alpha 0x48, behind each whole line, the text on layer 1). The glitch layers are static offsets, not
a flicker. Measured from the same strips (frames where the same word is yellow): breathe 182 -> 185
px against 180 unscaled, glitch 190 -> 198, earthquake's line tilting -0.8 / +0.9 / +0.6 / -0.8 px
between frames; the backdrop box sits behind each line. Tests: 4 more; 675 pass.
**Step 2, the sidecar** needed no new code: `manage.clean_motion`, `JobRequest.caption_animation`
and `make_clips --caption-animation` all check against `config.CAPTION_ANIMATIONS`, so the 16 new
names pass and an unknown one is still 400. Tests (`tests/test_motion_api.py`, 4 more): every new
name sits in exactly one of `ENTRANCES` / `WORD_EFFECTS` / `HOLDS` (baby_steps in none -- it hides
words, it does not move them), and `grow` / `box` / `with_backdrop` are saved by `PUT /motion` and
reach the command line; 679 pass. One real run, `--full --aspect 4:5 --caption-animation
with_backdrop` on Rhino: 34 s, one `Backdrop` style and 138 backdrop events in the `.ass`, the frame
at 40 s shows a dark box behind each of the two lines on bright dust; the scratch `full_4x5` folder
was deleted afterwards and the source MD5 is unchanged.
**Step 3, the UI.** `captionStyle.ts` `ANIMATION_GROUPS` is the one list (21 names in three
groups: the spoken word / as a cue appears / the whole cue), `CaptionAnimation` is derived from it
and `Motion.animation` uses it; a Python test (`test_the_ui_lists_the_same_animations_as_config`)
fails if it drifts from `config.CAPTION_ANIMATIONS`. Captions › Effects › Animation is a select with
an `<optgroup>` per group. Both previews (Edit Video's `LiveCaption`, Subtitles' `CaptionOverlay`)
call two helpers in `captionLook.ts`, applied **per line** because the render animates each line's
event: `lineMotion` (the class for entrances and whole-cue motion -- keyframes in `index.css` with
the render's durations, `--cap-shift` / `--cap-drop` / `--cap-px` in output pixels x scale; glitch's
duration is the cue's length and its red / cyan ghosts are `text-shadow`; backdrop is a 72 % black
background with a `box-shadow` spread of 22 % of the ASS font size) and `wordMotion` (Pop / Scale /
Underline / seamless bounce / Box and Highlighter as background + box-shadow spread, so neighbours do
not move / Blur switch and Focus on the other words only while a word is spoken / Baby steps as
`visibility: hidden`). `wordColour` gives Box dark text and Highlighter the normal text colour. On
the way: `CaptionOverlay` had shadowed the cue index with the line index, so alternating keyword
colours followed lines rather than cues.
Measured in the browser (test sidecar + Vite, `POST /jobs` answered 503) on Edit Video, Rhino 9:16 at
40.05 s ("THAT'S THE / DIFFERENCE"): groups 10 / 7 / 4 = 21 options; spoken "DIFFERENCE" scaleY 1.1
(pop), 1.15 (scale), underline, yellow background (box), `caption-word-bounce` at 1.10 mid-animation;
the other words `blur(0.83px)` (blur switch) and opacity 0.4 (focus); each entrance and whole-cue
class on the lines; over 600 ms paused, breathe's scale 1.000 -> 1.049, glitch 1.000 -> 1.150,
earthquake's matrix rotating both ways; backdrop `rgba(0,0,0,0.72)`; Export sent `caption_animation`
and `motion.animation` `with_backdrop`. Subtitles on How-AI-agents at 3.95 s: highlighter
`rgba(255,210,63,0.62)` behind "NOW", baby steps "RATE NOW" with the rest hidden (as in the render
strip), grow / earthquake / backdrop on both lines; no job started, no console errors; tsc and oxlint
clean; 680 pass. The test's Export saved `motion.animation` into Rhino's `project.json`; it was reset
with `PUT /motion {}` (the `look` with blur 60 was already there). The test servers were stopped and
both ports checked free.
**Step 4: preview against the real render**, measured like the font step: each animation's real `.ass`
burned onto How-AI-agents `clip_01_clean.mp4` at a time inside one cue (3.76-4.52 s) minus the clean
frame, against the Subtitles stage paused at the same time minus the same screenshot with the overlay
hidden, both at 1080x1920 (caption box, plus the yellow area for Box / Highlighter). Five things were
fixed by it:
- **CSS ran on the browser's clock.** Paused mid-cue, the preview had already finished its animation
  (glitch at 1.18 where the frame shows ~1.09). `useMotionClock` (`captionLook.ts`) keys each line on
  the cue and, while paused, sets a negative `animation-delay` = the video time into the cue with
  `animation-play-state: paused`; while playing it starts once from wherever play started. Measured
  playing: breathe 1.00 -> 1.046, glitch 1.00 -> 1.15 over 600 ms; paused: constant.
- **Box / Highlighter / Backdrop were too short** (94 px against 132; backdrop 201 against 242):
  libass makes the box as tall as the whole ASS font size (ascent + descent), CSS covered one em
  (= x em_scale). `boxArea` adds the difference as `padding-block` with an equal negative margin, so
  nothing moves. After: 137 / 132, 149 / 152, 242 / 242.
- **Easing.** libass `\t` and `\move` are linear (bounce was 3 % larger with `ease-out`), and the
  `\t(...,0.6,...)` accel of Grow is **not** t^0.6 in the frames -- measured scale 0.28 / 0.48 / 0.63 /
  0.75 / 0.87 / 0.98 at 20 / 50 / 80 / 120 / 180 / 220 ms against 0.22 / 0.38 / 0.51 / 0.64 / 0.82 /
  0.93 -- so its keyframes are those measured points (99 % / 99 % after, 84 % with t^0.6, 112 % with the
  first bezier). Soft landing's fade follows sqrt(t) in keyframes; Slide uses `--cap-rise` (2 % of the
  height) instead of 0.45 em.
- **Scale** used `transform`, which does not push the neighbours; libass `\fscx115` widens the
  advance. `zoom: 1.15` does: line 712 -> 742 px against 745.
- **Layers.** The second line's backdrop covered the first line's text, and glitch's ghosts as
  `text-shadow` copied the outline (wider, louder fringes). `underLayers` now draws the render's layer
  0 as copies of the lines underneath the text (ghosts with no outline at 69 %, the backdrop box with
  transparent text); a Box / Highlighter word sits at `z-index: -1` so its box goes under neighbours.
Two **render** bugs the side-by-side showed, fixed in `captions.box_line` with tests: the highlighter
was fully opaque (`\3a&H00&` on the spoken word overrides the Style's 0x60 alpha -- it now writes the
style's alpha), and the box covered the space after the word (244 px wide against 225; the box is now
switched off before the space). After every fix, render vs preview, box width / height: pop 99/100,
scale 100/99, underline 99/99, box 99/101, highlighter 99/100, focus 100/97, blur switch 100/101,
baby steps 99/100, backdrop 98/100, bounce 100/101, slide left 100/97, soft landing 99/99, grow 99/99,
breathe 99/100, glitch 99/101, earthquake 99/100. Still apart: slide left 7 px and soft landing 6 px
in position at mid-entrance (about a tenth of their travel, ~20 ms of timing). 680 pass, tsc and
oxlint clean, `shot.mjs` `problems: none`, no job started; the test servers were stopped and both
ports checked free.
**"Color not full" -- found by the developer** (a screenshot of a colour circle): Chromium draws
`<input type="color">` with a 4 px padded wrapper and a grey, square-cornered border around the
swatch, so the colour sat as a small square inside the circle. `index.css` sets the wrapper's padding
and the swatch's border to 0 and both to `border-radius: inherit`, for every colour input (Captions ›
Font, Background › Color). Checked at 4x in the Font tab: the colour fills the circle inside the
input's own 2 px `raised-3` ring.
**"When click subject dialog ញាក់" -- found by the developer** (the Manual subject tracking dialog
jumped on every click on the frame). The dialog is centred, and its height changed twice per click:
`onFrameClick` cleared `pick`, which removed the Subject / Area row, and `/pick`'s answer brought it
back (~44 px); the message line likewise came and went. Both now always keep their place: the row is
drawn before any click with its chips disabled ("click the frame first"), keeps the previous answer
while searching (`fresh` hides that answer's box and Apply until the new one arrives), and the message
line is two lines tall even when empty. Measured through the developer's running app (read-only: two
`/pick` calls, no Apply, `POST /jobs` intercepted): the dialog's y / height stayed 38 / 924 at every
30 ms sample across two clicks.
**AI keywords highlighter in the transcript -- asked for by the developer** (two screenshots: the
switch with its two colours, and Edit Video's transcript). Turning it on now colours, live, the words
the render will highlight in Edit Video's transcript, in colour 1 / 2 alternating per cue; turning it
off keeps the two colour rows on screen at half opacity (still editable) instead of hiding them. The
words come from `/projects/{name}/cues` (`keyword`, the render's `pick_keywords`), matched to the
transcript by the transcript word's **midpoint** inside the cue word's interval (binary search),
because `word_intervals` stretches cue times so the starts differ. The result is one character per
item ('1' / '2' / '-') like the existing `flags`, so each memoised chunk gets a string slice and
still re-renders only when it changes; cut, selected, playing and search-hit words keep their own
colour. Measured through the developer's running app (read-only): off -> 2 colour rows at 0.5
opacity, 0 words marked; on -> 16 words marked, the same 16 words with the same colour index as the
cues' keywords, in `rgb(4,248,39)` / `rgb(255,253,3)`; changing colour 1 recoloured them at once; off
again -> 0.
**"When click on/off highlight left side ញាក់" -- found by the developer.** The keywords were also
`font-weight: 600`; a bolder word is wider, so the transcript re-wrapped on every switch. They are
colour only now, and the note under the colours no longer gains " (off: ...)" text when off (it
wrapped to a second line and moved the panel). Measured: 0 of 73 transcript words change position
switching on or off.
**UI size -- "all element is so big" (2026-10-26), the developer chose a setting.** On a 1920x1080
screen at Windows 125 % the app gets 1536x824 logical px while the design was drawn for 1280-1440.
Settings › General now has **UI size 80 / 90 / 100 / 110 %**, default **90 %** (`src/uiScale.ts`,
localStorage `kcs.uiScale`, try/catch). It is Tauri's `getCurrentWebview().setZoom` -- like Ctrl + / -
in a browser -- and **not** CSS `zoom` on `<html>`: the webview zoom recomputes the viewport, so the
`100vh` layouts still fill the window, where a CSS zoom would leave an empty strip at the bottom. The
capability adds exactly `core:webview:allow-set-webview-zoom`; `main.tsx` applies the saved size
before the first render. In Settings a click previews at once; OK saves, Cancel / ✕ / Escape go back
to the saved size. In a plain browser it does nothing (use the browser's own Ctrl + / -).
Measured in the real window (`npm run app`, CDP on 9222; the window 1800x1030 physical px): 90 % ->
1600x916 CSS px (pixel ratio 1.125 = 1.25 x 0.9), 80 % preview -> 1800x1030 (1.0), Cancel -> back to
1600x916, OK at 110 % -> 1309x749 (1.375), still 110 % after a reload, Escape after a preview kept
110 %; the page's height equals the window's at every size; then reset to 90 %. No console errors
beyond the startup polling before the sidecar listens. The app was closed afterwards; 8765, 5173 and
9222 free.

**Timeline Split / Delete / Trim (OpusClip editor screenshot, 2026-10-27), planned with the developer
first.** Decided: a split snaps out of a word, and split points are saved in `project.json`. Our edit
model is one **cut list** in source time, which the transcript, Speech cleanup, the preview's skip,
the timeline's red bands and `--cuts` already share, so these tools only write into it -- no pipeline
change. A **split** (⦚ button or `S`; Alt = the exact playhead) only divides the timeline into parts
for choosing; it cuts nothing. `cutList.ts` gained `partAt` (the part around a time), `addSplit`,
`isPartCut`, `snapToWords` (inside a word -> its nearer edge; in a pause -> unchanged), `trimTo` and
`trimEdges` (the trim handles are the end of a cut starting at 0 and the start of a cut reaching the
end, so dragging back restores). A click on the timeline still seeks and also picks the part under it
(gold outline, only once there are splits -- otherwise the part would be the whole video); **Delete**
(button or key, when no transcript word is selected) cuts it, and the button turns into
**↺ Restore** on a part already cut. Two gold **‖ trim handles** sit at the ends of what remains;
dragging one shows its time, seeks the preview there, and commits **once** on release, so a drag is
one undo step. Undo / redo now keep `{cuts, splits}` together. Sidecar: `edit.splits` beside
`edit.cuts` (`manage.write_cuts(..., splits=None)` keeps the saved splits, because a job writes cuts
without knowing about them; at most `MAX_SPLITS` 2000), `PUT /projects/{name}/cuts` takes `splits`.
Tests: 2 more in `tests/test_cuts_api.py`; 681 pass.
Measured in the browser on Rhino (`POST /jobs` intercepted): `S` at 10.0 s, inside "young"
(9.90-10.14), split at **9.90**; a click at 15 s picked 9.90-20.00, Delete cut `[9.9, 20]` with 6
transcript words struck and the button reading Restore; playing from 9.30 reached 20.82 after 1.5 s;
dragging the handles to 3 s and 50 s cut `[0, 2.88]` and `[49.89, 55.746]` (both snapped out of
words); undo x5 -> nothing, redo x3 -> the two splits and the cut; Restore -> `[]`; reopened -> 2
splits and 6 struck words from `project.json`; Export sent `cuts [[9.9, 20]]`; no console errors. A
real job with that cut at 4:5 rendered 45.587 s video / 45.587007 s audio from a 55.639 s picture
(55.639 - 10.1 = 45.539; the rest is the frame snapping of the cut edges). The test folder
`full_edit_4x5` was deleted, Rhino's `edit` reset to empty (its `look` and `motion` untouched), the
source MD5 unchanged; the job did rebuild the `edit/` cut-copy cache, which is keyed on the cuts.
Two test traps: the editor saves 0.6 s after the last change, so reading `project.json` 0.9 s after
several quick key presses can see the previous state -- wait until two reads agree; and a script
heredoc full of JSX quotes broke the shell -- write such edit scripts to a file first.

**Transcript Filter / Download and a CC toggle (same screenshot, 2026-10-27).**
- **⬇ Transcript** (menu beside the search): TXT or SRT **as the exported video will be** -- words
  inside the cut list are dropped and the SRT's times follow the cut video. `editor.transcript_text`
  reuses the pipeline (`cuts.shift_transcript` + `keep_ranges`, `captions.wrap_into_cues` +
  `build_srt`); TXT keeps the original punctuation and starts a paragraph after a pause over 1 s.
  `POST /projects/{name}/transcript/export {format, cuts}` writes `<title> - transcript.<fmt>` into the
  Export folder (`export.default_destination`) with `export.free_path`, so it never overwrites; the
  folder is not taken from the request, so a request cannot make the sidecar write elsewhere. The
  editor shows the path and an Open folder button (`/reveal`). Tests: `tests/test_transcript_export.py`
  (3, the Export folder pointed at tmp); 684 pass.
- **Filter** (menu): show / hide the pause chips, mark filler words (the same rules as Speech
  cleanup, from `/cleanup?pause=10&fillers=true`, drawn with an orange wavy underline), hide deleted
  words. Only the view changes, never the cut list; the filler marks are one character per item like
  `flags`, so the memoised transcript chunks still re-render only when they change.
- **CC** in the top bar toggles `style.off` (the "no captions" preset) without touching the rest of
  the style; Export then sends `no_captions`.
Measured in the browser (the export POST, `/reveal` and `POST /jobs` intercepted, so nothing was
written to `~/Videos` -- checked, 0 transcript files there): How-AI-agents 6662 words / 340 pauses;
fillers on -> 55 marked words, which is `/cleanup`'s 31 fillers counting "you know" (18) and "I mean"
(6) as two words each; pauses off -> 0 chips, words unchanged. Rhino: one word cut and hidden (1 struck
-> 0 shown); TXT and SRT each sent the current cuts `[[2.88, 3.16]]`, the status line showed the path
and Open folder sent it to `/reveal`; CC ON -> OFF removed the live caption and Export sent
`no_captions: true`. No console errors. Rhino's `edit` was reset; its `look` and `motion` untouched.
**Processing timeframe on Long to Short (2026-11-02) -- asked for by the developer with OpusClip's screenshot.** The settings page has two handles and two typed time boxes; `make_clips --timeframe start,end|all` lets the LLM read only that range (`window_transcript`, source times kept), and snapping and ranking use the same window, while Whisper and captions keep the whole transcript. `find_highlights` writes `timeframe` into `highlights.json`: a different range redoes highlights, no flag (re-render, more clips) keeps the existing pick, and the page sends `all` for the whole video so an earlier narrow pick is replaced. `jobs.timeframe_changes` keeps progress from calling that redo "cached". OpusClip's warning is real: under `TIMEFRAME_MIN_SEC` 60 s the warning shows and Start is disabled on the clip tab, so a video under a minute (Rhino) can only be reframed or captioned from this page; the CLI still clips it when no range or the whole range is given. "Credit saver" became "AI time saver", as the app has no credits. Tests: `tests/test_timeframe.py` (6); 743 pass. Measured in Edge against the developer's running Vite (`POST /jobs` answered by the test): Rhino 0:00:56 warns with Start disabled; How-AI-agents drags, typed times, bad text and arrow keys all work, and Start sent `timeframe 600,901`; no page errors. A real CLI run on a throwaway copy, range 600-780 s (1 chunk), 3 clips: 607.27-623.21, 687.62-704.72, 758.67-777.57 s, all inside; highlights took 29 min 10 s **with 38 MB of RAM free** (the same low-memory state as "stuck at 24%"), so it says nothing about normal speed. Not run through the desktop window or through a real job from the app: a sidecar started before this ignores `timeframe` until restarted. `eta.ts` scales the highlights estimate by the range; not checked on a real card.
**The Long to Short video header after OpusClip (2026-11-02) -- asked for by the developer with a screenshot.** Centred: a row of Speech language (real: Auto + the Latin-script `--language` list, shared with Auto Subtitles through `screens/languages.ts`; a non-Auto language whose transcript differs re-transcribes), Upload .SRT (drawn disabled, nothing reads one) and Estimated time in place of "Credit usage" (the card's `stepSeconds` total with nothing cached, not a promise), then a 335 px thumbnail. The screenshot's copyright sentence was built and then removed at the developer's request. The Subtitles select is gone, having only ever offered English plus disabled items. Beyond the screenshot, because the app needs them: Change video on the thumbnail and a name / length / fps line.
**Genre became a menu in the settings row (2026-11-02) -- asked for by the developer with OpusClip's screenshot**, replacing the chips: Genre Auto with a tick and Q&A, Commentary, Marketing, Webinar, Motivational speech, Podcast, Academic (the names visible in the screenshot, which cuts off below Academic). Only Auto is enabled: no genre reaches the LLM prompt yet. The layout explanation line and the copyright sentence were removed at the developer's request.
**The Long to Short settings became a tabbed panel (2026-11-02) -- asked for by the developer with OpusClip's screenshot.** The active tab joins a `raised` panel holding the settings row, the moments field and the timeframe; Quick presets and save-as-default stay below it. Auto headline, Auto zoom and Auto color correction are drawn off and disabled, because no job flag backs them here (Auto zoom exists only as Edit Video's Motion). "Learn more" is left out, having nothing to link to.
**The Don't clip tab takes the timeframe too (2026-11-02) -- asked for by the developer with OpusClip's screenshot.** The tab shows "We will not clip..." and the same slider; a chosen range goes through the Reframe dialog to `--full --timeframe start,end`, which renders that range only (`full_video_clip(window)`), with no LLM, no highlights cache and no 60 s minimum. The range is tied to its video in `App`, so changing video in the dialog drops it. It writes to the usual `full*` folder, replacing an earlier whole-video result of the same aspect, and the Reframe dialog's estimate still reads the whole video.
**Quick presets stay on both tabs (2026-11-02) -- asked for by the developer.** Switching to Don't clip no longer hides them or save-as-default, and they are real there: Reframe opened from this tab sends the page's caption style when the dialog's subtitles switch is on. Reframe opened any other way (Home's card, a project's menu) sends no style, as before.
**Quick presets / My templates tabs on Long to Short (2026-11-02) -- asked for by the developer with OpusClip's screenshots.** Presets sit in a tabbed panel, 5 columns. My templates has one card: the style saved as default (read from `loadDefaults()` on every render, so Save and Settings show at once); a click applies it and Edit opens Settings on Default project. Left out: OpusClip's other preset styles and "New" badges (our renderer does not draw them), the arrows (everything fits) and "Upgrade to Pro" (no billing). Choose aspect ratio reads 9:16 with the rest disabled, because a run at another aspect writes `clips_*` and Review lists only clips with a file in `clips/`; those sizes are made from Review's aspect button.
**AI detects the genre, step 1: the pipeline (2026-11-02) -- asked for by the developer.** `detect_genre` reads 3 parts of 90 s (from 10 %, 45 % and 80 % of the speech; all of a short video) with `prompts/detect_genre.md` and answers one of qa, commentary, marketing, webinar, motivational, podcast, academic or other. `find_highlights` runs it first, adds that genre's line (`GENRE_HINTS`) to every chunk's prompt (`podcast_highlights.md` v6, `{{GENRE_HINT}}`; `other` adds nothing), and saves `genre` and `genre_reason` in `highlights.json`. A failed or unknown answer is `other` and never stops the job; `CACHE_VERSION` is unchanged, so existing picks stay. Measured with `qwen2.5:7b-instruct` on 4 samples, 2 runs each, transcripts in the scratchpad: Webinar -> webinar, Rhino -> other, Taylor_Tomlinson -> podcast; How-AI-agents (two people on webcam) -> motivational under prompt v1, because the model judged the topic, and qa under v2, which tells it to judge the format; the developer has not judged whether qa is right. 8-230 s per call with RAM almost full and the C: drive at 100 %, so these times do not show normal speed. Not measured: whether the hint gives better clips. Not run through a real job. The UI still shows Auto with no detected genre. Tests: `tests/test_genre.py` (6).
**A video can have two genres (2026-11-02) -- asked for by the developer.** `detect_genre` now returns 1-2 (`GENRE_MAX`, prompt v3, main first), every hint goes into each chunk's prompt, and `highlights.json` holds `genres` as a list; the hints read "In a Q&A part, ..." so two can stand together. Measured on the same 4 samples, 2 runs each: Webinar [webinar], Rhino [other], Taylor_Tomlinson [podcast], How-AI-agents [podcast, academic], which replaced qa, so its answer moved with the prompt wording and is still for the developer to judge. 7-28 s per call. One genre applies to the whole video, not per part. 750 pass.
**Clip model menu on Long to Short (2026-11-02) -- asked for by the developer with OpusClip's screenshot.** It replaces the "AI model" select: a button showing the choice and a 350 px menu of two-line rows with ✓ on the right. The rows stay our real packs, Auto / Lite / Standard / Pro, not OpusClip's ClipAnything / ClipBasic, because our packs differ only in model size. Pro is disabled on this 3 GB card. `MenuButton` gained `flipBelow`: the menu opens upward when the footer would cover it. Measured in Edge against the developer's running sidecar and Vite (non-GET answered by the test, no real job): Auto ticked, reading "now Standard"; choosing Lite made Start send `small` + `qwen2.5:3b`; Escape closes; at 1440x900 it opens down at y 550-784, at 1100x700 up at y 273-507; no horizontal scroll, no page errors. tsc and oxlint clean. Edge only.
**The speaker on Split's top panel, step 2: the pipeline (2026-11-02), planned with the developer first.** `--speaker-top` (off by default, no UI yet, Split only) runs `pipeline/speakers.py` after `plan_clip`: at 10 fps, mouth change minus eye change per panel, and each second with speech the higher score is the speaker. A face belongs to the panel holding it, and when only one panel has a face that panel wins: the first version wanted two faces as evidence, so the man's one noisy second at 2500.2 s carried over 4 s in which his head had left his static box, and the top panel showed a shoulder while the woman spoke (found by the developer: "clip 3 wrong at 0:03-0:07"). Now 2500.2-2506.9 s stays on her and clip 3 has one cut, at 2510.5 s. `hold_runs` drops runs under `SPEAKER_MIN_SEC` 2 s, and a switch cuts the shot, with the speaker on top. The offline test on `Table For Four`, judged by the developer by ear: the switch at about 2510.5 s, `talk_2` and `talk_3` right; `talk_1` wrong for 1 s on someone eating and laughing. So 2 s rests on two examples, and 3 s would have dropped the right switch; eating or laughing for longer still fools it. Measured on a throwaway copy of the same video, 5 clips: one run with the flag 71.7 s against 47.1 s without, 1080x1920; only clip 3 gains a cut, and without the flag the plan is unchanged. The developer then confirmed the speaker but "man out frame": at 2501-2505 s his head is outside the **source** frame (0 faces in his side of it), so no crop can show him. A panel with a face in under `FACE_PRESENCE_MIN` (half) of a shot's seconds now turns that shot into `single` on the other person, with `tracked_box` because she moves (cx 368-562): 2500.2-2506.9 s is `single`, the other Split shots unchanged. Flag only, so plans without `--speaker-top` keep such empty panels. The developer judged clips 1 and 3 right. A switch now lands in the gap between words within `SPEAKER_SNAP_SEC` 0.5 s (`snap_to_gap`). A second video, a throwaway copy of the 47-min 1080p interview, 10:00-25:00: 26 Split shots (243 s), none with a panel mostly empty, and the per-second picks are noisy, flipping for 1 s in most shots where `Table For Four` flipped rarely; the speaker step took 255 s, about realtime at 1080p, because every frame runs YuNet at full size. Four rendered shots judged by the developer's ear: `clip_01` wrong at 0:03-0:07, `clip_02` at 0:00-0:04, `clip_03` at 0:00-0:04 and 0:07-0:11, `clip_04` right. So mouth movement alone is not reliable enough: `--speaker-top` stays a flag, off by default, with no UI. An offline test of mouth movement in step with the sound (correlation with log loudness at 10 fps, lag up to 0.2 s, 3 s and 5 s windows, no new model; nothing added to the pipeline) did not beat it, scored per second on those four clips, taking the shown panel as right outside the developer's marks: held picks mouth 26/43, sync 3 s 23/43, sync 5 s 17/43; and on the two `Table For Four` shots the developer judged right, sync 3 s 10/18. That score favours the rendered mouth picks and the sample is small, so it shows no gain, not that sync can never work. Diarization tried next, in a scratch venv with nothing added to `.venv` or the pipeline: `sherpa-onnx` 2.0.1 (2.2 MB, cp314 wheel), pyannote segmentation 3.0 (7 MB) + `nemo_en_titanet_small` (40 MB), CPU, 228 s for 900 s of audio, each voice joined to a panel by summed mouth scores. Held picks: the four interview clips 13/43 (mouth 26/43), the three `Table For Four` shots 20/23, equal to mouth. It also merged the man and woman into one voice across the switch at 2510.5 s that the developer confirmed, and on the interview heard one voice through clips 1-3 and clip 4 where the marks imply changes. Swapping its voice-to-panel map reads 30/43, but that was chosen after seeing the answers, against the mouth votes, so it proves nothing. **Parked (2026-11-03):** `--speaker-top` stays an off-by-default flag and the app keeps the old panel order; a better speaker finder is Phase 2 work. Not tested: fast back-and-forth, other videos, Three / Four. A cut restarts `--motion-zoom`, not measured. 765 pass; source and existing clips' MD5 unchanged, copy recycled.
 (context only — do not build yet)

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
  `screen` (slide on top, webcam people below) is tried first on screen-share shots.
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
- Speech language: `--language auto|en|fr|...` (`config.WHISPER_LANGUAGES`); a cached transcript in
  another language is transcribed again.
- Review output: `python review.py <video name> --frames`
- Test: `pytest -q`

**Transform video, step 1 of 4: the pipeline (2026-10-27), planned with the developer first**
(OpusClip screenshot: the video as a box with corner handles over the canvas, a crop button above).
Decided: one transform for the **whole video**, and it **replaces the AI layout** (Layout reads
"Custom"; Reset returns to the AI). It is a hand-placed Fit, so the background (blur / colour /
image) and the corner radius are Fit's own code. `pipeline/transform.py`: `Transform(x, y, scale,
crop)` -- the box's centre as fractions of the output, its width as a fraction of the output width
(0.1-3, so it may run off screen), and a crop of the source as fractions (`parse`, `crop_pixels`,
`foreground_size` with even sizes, `top_left`, which may be negative). `make_clips --transform
x,y,scale --transform-crop x,y,w,h` sets `config.TRANSFORM`; `plan_clip` then returns one `custom`
segment (no shot or face detection), and `layout_chain` draws crop -> scale -> `overlay=left:top` on
`fit_background` (`overlay` clips what lies outside), with the radius mask sized to the box. Tests:
`tests/test_transform.py` (4); 688 pass.
Measured on 6 s of How-AI-agents (640x360 screen-share with two webcam tiles), rendered to the
scratchpad on a black colour background so the box can be read off the frame: sent / measured
`0,657 1080x606` / `0,656 1080x606`; `54,1193 540x302` (radius 40) / `54,1192 540x302`; the crop
`0.14,0,0.72,1` at scale 1.1 removed both webcam tiles and filled the width with the slide (sent
x -54, measured 0 -- off screen by design); every file 1080x1920, 6.000 s video and audio; 4.4-4.9 s
per render (7.0 s with blur); no temp files left; the source MD5 unchanged. Nothing in `output/` was
written. Next: the sidecar (`transform` in the look), then the UI (box with handles, Crop, Reset).
**Step 2, the sidecar.** `transform` is one more key of the look (`manage.DEFAULT_LOOK`, `None` = the
AI layout): `clean_transform` checks `{x, y, scale, crop}` through `pipeline.transform.parse` (a bad
one is 400 before any job), `look_options` turns it into `--transform` and, unless the crop is the
whole frame, `--transform-crop`; Reset is `transform: null`, and a look with nothing left removes
`project.json`'s key as before. No `JobRequest` change: look options already become flags by name.
Tests: 2 more in `tests/test_look_api.py`; 690 pass. A real job through a test sidecar on Rhino
(1280x720, 4:5, black colour background, crop `0.25,0,0.5,1`, scale 0.8): 1 shot `custom` in
`layout.json`, 1080x1350, 55.64 s; expected box `108,189 864x972`, measured `108,188 864x972`. The
job saved its look in Rhino's `project.json` (by design: Export keeps what was exported); it was put
back to the developer's own look (blur 60), the test folder `full_4x5` deleted, the source MD5
unchanged, the test sidecar stopped.
**Step 3, the UI.** Layout -> **Custom (Transform)** turns `look.transform` on (Fit in the middle,
`initialTransform`) and the label reads "Layout: Custom"; any other layout item sets it back to null.
`src/transformBox.ts` is the geometry in fractions, mirroring `transform.py` (`boxRect`, `fullRect`,
`fitScale` / `fillScale`, `moveBy` with a 3 % snap to the centre lines, `scaleFromCorner` -- the
opposite corner stays put and the ratio is kept -- and `cropFromCorner`, which keeps the kept part where
it is on screen and rounds a crop within 0.5 % of an edge to the edge). `screens/TransformBox.tsx`
always wraps the `<video>`, changing only styles, so switching to Custom never re-creates it (the
time stayed at 600.00 s); in Custom the wrapper is the box (`overflow: hidden`, the radius) and the
video inside is sized `1/cw x 1/ch` and offset by the crop, drawn over `FitBackdrop`. The frame,
four corner handles, snap guides and the toolbar (Crop / Fit / Fill / centre / ↺ AI) go through a
`createPortal` into an **unclipped overlay** above the stage: the stage's `overflow-hidden` cut the
handles at the screen edge in half and a mouse on the edge missed them (measured: the bottom-right
crop drag did nothing). Arrow keys nudge (Shift = more), Escape leaves Crop, then deselects.
Two bugs the test found: `PUT /look`'s `LookRequest` had no `transform`, so pydantic dropped it and
nothing was saved (step 2's test went through `POST /jobs` only) -- fixed, with a test; and snap at
1.5 % was ~4 px on a 263 px preview, so a 4 px drag never snapped. 691 pass, tsc and oxlint clean.
Measured in the browser on How-AI-agents at 9:16 (test sidecar + Vite, `POST /jobs` answered 503):
Custom -> box `0, 0.342, 1 x 0.316` of the stage = 1080 x 607 of 1920, saved `{0.5, 0.5, 1}`; a drag
up snapped x to 0.5 with the gold guide shown; crop corners to 14 % / 86 % -> `[0.14, 0, 0.72, 1]`, box
width 1 -> 0.72 at the same place; Fill -> scale 2.2758 (= 0.72 x 1.778 / 0.5625); a corner drag 1 ->
0.7 wide with the top-left fixed; Export sent the transform; no console errors. How-AI-agents' look
was reset afterwards (its saved split untouched); the test servers were stopped.
**Step 4: preview against the real render.** Four transforms on How-AI-agents (640x360) at 9:16 on a
black colour background, the render at 603 s of a 600-606 s piece (scratchpad) against the Edit
Video preview paused at 603 s (each look saved through `PUT /look`), boxes in output pixels:

| case | sent | render measured | preview (DOM) | picture diff (12 px shifted) |
|---|---|---|---|---|
| plain | 0, 657, 1080x606 | 0, 656, 1080x606 | 0, 656.2, 1080x607.5 | 4.6 (10.2) |
| crop 0.14/0.72, scale 1.1 | -54, 342, 1188x928 | 0, 342 (off screen) | -54, 342.3, 1188x928.1 | 2.0 (4.3) |
| small, radius 40 | 54, 1193, 540x302 | 54, 1192, 540x302 | 54, 1192.1, 540x303.7 | 8.8 (20.6) |
| crop on 4 sides, off the edge | 238, 285, 864x582 | 238, 284 (clipped) | 237.6, 284.3, 864x583.2 | 2.4 (6.4) |

The picture diff is the mean |preview - render| inside the box (0-255), with the same preview moved
12 px as the control, so the crop's content lines up, not only the box. Found on the way:
- **A box larger than the stage covered the preview toolbar** (16:9, Layout ...): the frame is a
  click target in the unclipped overlay. The overlay is now 12 px larger than the stage with
  `overflow: hidden`, so edge handles show in full but the box stops 12 px out.
- **Data loss in the sidecar, real and reproduced.** The first measuring run deleted
  How-AI-agents' `project.json`, and with it the developer's saved split (272.31). Edit Video's
  autosave sends `PUT /look`, `/motion` and `/cuts` at once, FastAPI runs them in separate threads,
  and each writer read `project.json`, changed its key and wrote the whole file back with no lock --
  while `write_text` empties the file before writing, so a reader in that instant got `{}` (`_read`
  treats a broken file as empty) and wrote back only its own key, or deleted the file when that key
  was a default. Fixed in `server/manage.py`: the five writers run under one `threading.RLock`
  (`@_locked`), and `_write` writes `project.json.tmp` then `os.replace`s it, so no reader ever sees
  half a file. `tests/test_project_file_race.py` runs four writers 150 times each at once: every key
  survives; with the lock removed and the old `write_text` put back, the same test loses data, so it
  really catches the race. The split was restored from the session's own record (`cuts []`,
  `transition punch`, `splits [272.31]`) before anything else; how many earlier edits this race may
  have eaten silently is not known.
693 pass, tsc and oxlint clean; How-AI-agents' look reset, its split intact, the source MD5
unchanged, nothing written to `output/`, the test servers stopped.

**Layout menu, click-to-transform and a Crop dialog (OpusClip screenshots, 2026-10-27).**
- **Layout menu** (`screens/LayoutMenu.tsx`, helpers in `screens/layoutChoice.ts`): "Global layout
  settings ›" opens a checkbox submenu of the layouts the AI may use (Fill / Fit / Split / Three /
  Four / ScreenShare; at least one stays on), sent as `--layout` when the current layout is **Auto**;
  "Current layout" is Auto, one layout forced on the whole video (`layoutFlags`; ScreenShare sends
  `screen,fill`), or Custom (Transform). Picture in picture and Gameplay are drawn with a Phase 3
  badge. The submenu's open state lives in the panel mounted with the menu: kept in `LayoutMenu` it
  stayed open from the last time, so the next click closed it (measured).
- **TransformBox in every layout:** hovering the video shows a dashed outline and "Transform ·
  click to edit"; a click selects it (handles + the screenshot's small toolbar: ✂ Crop, 🖼 replace
  media disabled as Phase 3, ⌄ Fit / Fill / centre / back to AI) without saving anything; the first
  drag starts from `startFrom` -- `coverTransform` (the AI preview's centre crop) or the Fit box -- so
  the picture does not jump, and the layout becomes Custom.
- **Crop dialog** (`screens/CropDialog.tsx`), replacing the in-preview crop mode: a real frame at
  the playhead (`/probe/frame`), the crop with 4 corner + 4 edge handles and a draggable middle,
  Aspect ratio Custom / same as output / 9:16 / 1:1 / 4:5 / 16:9 (`cropToRatio`, `dragCrop` in
  `transformBox.ts` keep the ratio and the opposite edge), Reset and Apply (only `crop` changes; the
  box keeps its centre and width). With Split, Three and Four all off it shows OpusClip's note and
  its "Enable layout" link turns them back on. The dim outside the crop is an inline `box-shadow`
  clipped by the image (the Tailwind arbitrary class did not draw there).
Measured in the browser on How-AI-agents at 9:16 (`POST /jobs` answered 503): Current layout lists
Auto + 8 + Custom, Global starts with 6 on; unticking Three / Four leaves 4; hover shows the hint; a
click gives the 3-button toolbar, keeps "Layout: Auto" and saves nothing; a drag gives Custom with crop
`[0.3418, 0, 0.3164, 1]` (= 0.5625 / 1.778, the AI preview's crop) and y 0.4; the dialog has 8
handles, 1:1 -> `0.22, 0, 0.56, 1`, a corner drag keeps 1:1, Apply saved a crop whose pixel ratio is
1.000; the note appears once Split is off too, and its link restores Split / Three / Four; Export
sent `layout fill,fit,split,three,four,screen` and the transform. A test trap: a run stopped halfway
leaves its transform saved, and the next run opens in Custom -- the test now resets the look first.
How-AI-agents' look was reset and its split (272.31) intact; the test servers stopped.
**Hover looks like OpusClip's -- asked for by the developer** (screenshot: a solid thin white frame
with four round corners, no dashes). Hover now draws the selected look -- a solid 2 px white outline
and the four corner circles -- without selecting: the corners are `pointer-events: none` until a
click, so moving onto one does not end the hover (no flicker) and cannot start a resize. The
"Transform · click to edit" chip became the frame's tooltip. Measured read-only against the
developer's running app (hover only): before `outline none`, 0 corners; hover `solid 2px`, 4 corners,
not clickable; on a corner still solid; away back to none. The only writes were the editor's usual
autosave of the values it had just loaded.
**Transform box: selected on open, hover = edit, smooth drag, Logo / Image menu (2026-10-27) -- asked
for by the developer, planned first.** The box starts selected when Edit Video opens (toolbar and
corners shown, nothing saved, Layout stays Auto); a `pointerdown` anywhere outside it -- transcript,
timeline, menus -- deselects (a `document` listener in `TransformBox`, which ignores elements marked
`data-transform-ui` and any `role="dialog"`, so Crop does not deselect); hovering shows the frame and
corners and both can be dragged at once (an 80 ms delay before hiding, so moving from the frame onto a
corner does not end the hover). **Drag was not smooth because every `pointermove` called `setLook`
and re-rendered the whole editor** (transcript, timeline, captions): 90 moves took 24.4 s, frame gap
p95 417 ms, long tasks of 126-582 ms on nearly every move. The drag now lives in a local `draft`
inside `TransformBox` and `onChange` runs once on release (one autosave, one undo step): the same
90 moves 1.7 s, p95 16.7 ms, one 216 ms frame left (the first move). The toolbar sits above the box
(clamped inside the stage) and its menus are `absolute` under it -- inside the toolbar they widened
it and moved it on every open. The developer then removed the separate ⌄ menu (Fit / Fill / centre /
back to AI): the caret belongs to the image button, so the toolbar is ✂ and one 🖼⌄ button; back to AI
is Layout -> Auto. 🖼⌄ opens **Logo / Image**, both disabled "ជំហានបន្ទាប់" until a real
image overlay exists. Measured read-only against the developer's running app (PUTs answered by the
test): on open toolbar + 4 corners; the Logo / Image menu and then ⌄ left the box and toolbar at
the same pixels; a click in the transcript deselected; hover gave 4 corners with
`pointer-events: auto`, still shown on a corner; a corner drag shrank the box 540 -> 480 px wide
with one PUT after release; no console errors.
**Crop dialog: Aspect ratio dropdown like OpusClip's (2026-10-27) -- asked for by the developer with a
screenshot.** The `<select>` became `RatioMenu` in `CropDialog.tsx`: a bordered button showing the
current shape icon and name, and a list **Custom / Original / 9:16 / 1:1 / 16:9 / 4:3 / 9:8 / 4:5**,
each with an icon drawn at its real ratio (Custom = dashed frame with a box inside, Original = dashed
frame) and ✓ on the current one. Original is the source video's own ratio (the whole frame); "same as
output" was dropped because the screenshot has no such item, and with it the dialog's `outputRatio`
prop. It closes on an outside click or Escape, and Escape closes only the list, not the dialog.
Custom shows all 8 handles; any locked ratio (Original included) shows only the 4 corners, since
dragging one edge alone cannot keep a ratio (developer's request; measured 8 -> 4 -> 8).
Found by the developer: a crop touching the frame edge (9:16 = full height) cut its corner handles in
half, because the image box was `overflow-hidden` to clip the dim. Now only an inner layer (image + the
dim's box-shadow) clips, and the frame with its handles sits above it unclipped; measured at 9:16: all
four corners 16x16 with their top and bottom pixels hit-testing as the handle, and a drag started 2 px
from the top of the nw corner moved it.
Choosing a **different** ratio now resets the crop (the developer's request, planned first): the largest
crop of that ratio centred in the frame (`cropToRatio` from the whole frame), Custom = the whole frame;
choosing the ratio already selected changes nothing, so an edit is not lost. Before, the new ratio was
cut from the current crop and kept its centre, so a small crop in a corner stayed small in the corner.
Measured (Apply not clicked): a corner crop -> 1:1 `0.22, 0, 0.56, 1`; an edited 1:1 -> 1:1 again
unchanged; 9:16 `0.34, 0, 0.32, 1`; 16:9 the whole frame; 4:3 `0.13, 0, 0.75, 1`; Custom the whole
frame with 8 handles.
The multi-speaker note now shows **every time** the Crop dialog opens, as in OpusClip's screenshot (it
used to show only with Split / Three / Four all off), in the app language (`useT`; English is
OpusClip's sentence). The reason it always applies: a crop is a Custom transform, which replaces the
AI layout for the whole video, so split / three / four never run while it is on. **Enable layout** now
turns Split / Three / Four on, sets the layout to Auto, clears `look.transform` and closes the dialog
-- the hand-placed box and crop are dropped. Measured read-only: the note shown, the link closed the
dialog, the label read "Layout: Auto" and the autosave sent `transform: null` (answered by the test).
Measured read-only against the developer's running app: 8 items in that order, 4:3 on the 16:9 source
gave crop `0.13, 0, 0.75, 1` (pixel ratio 1.333), Original gave the whole frame, no console errors,
Apply not clicked.
**Snap guides at the frame edges (2026-10-27) -- found by the developer** ("when drag video out of
frame no snap guide"). `moveBy` only snapped the box's centre to the centre lines, so a box dragged
off the frame never snapped or showed a guide. It now takes the box's size and snaps, within the same
3 % (`SNAP`), the centre to 0.5 and each box edge to each frame edge from inside or outside (left edge
to 0, right edge to 1, right edge to 0 when the box sits off to the left, left edge to 1 off to the
right; the same vertically); the guide is drawn at the line it snapped to (0, 0.5 or 1). Arrow-key
nudges pass `null` and do not snap -- before, a nudge near the centre was pulled straight back.
Measured read-only in the developer's running app (PUTs answered by the test): the box's right edge
and then its left edge snapped to the frame's left edge at x 660 with a guide there, its bottom edge
to the top edge at y 199 with a guide there, nothing far out, no guide after release, no console errors.
Then, at the developer's request, a guide shows only when the box **comes onto** a line, not while it
stays on the line it started the drag on: a box that starts centred and is dragged sideways had the
horizontal centre guide lit for the whole drag. `leftLine` (a ref, reset per drag) remembers per axis
whether the box has been off every line since the drag began. Measured: a sideways move from the
centre shows no guide; reaching the frame's left edge shows only x@660; back to the centre shows
x@994; reaching the top edge then adds y@199. A guide on a frame edge is a **solid 2 px yellow** line (gold #FFD23F,
the developer's request); the centre guides stay dashed 1 px (measured: `solid 2px` at x 660 and y 199,
`dashed 1px` at the centre).
**"When drag video not smooth" -- found by the developer, right after edge snapping.** Frame timing was
fine (90 moves: p95 16.8 ms); the jerk was the snap. It was 3 % of the stage, i.e. **20 px** on the
668 px-wide 16:9 preview, so a box that starts centred stayed stuck on the centre lines for the first
20 px of mouse travel and then jumped, and the edge lines added more such zones. Now the distance is
`SNAP_PX` 6 px of the preview (converted per axis from the stage's size), and an axis does not snap at
all to the line it started the drag on until it has left every line (the same `leftLine` that hides
the guide). Measured: mouse +2 ... +30 px from the centre moves the box +2 ... +30 px exactly; edge
and centre snapping and guides unchanged otherwise.
**Resizable transcript / preview in Edit Video (2026-10-27) -- asked for by the developer** (screenshot,
"<->"). The 1 px border between the two panels is now `screens/PanelResizer.tsx`, a `role="separator"`:
drag it to widen or narrow the transcript (hover/drag shows a gold line and a ⇔ knob), ←/→ move it
20 px (Shift 80), double-click returns to the default (46 %, 360-640 px). The width is clamped to
280 px and to leave the preview at least 420 px beside whatever right panel is open (Captions, Motion,
tools), and saved in localStorage `kcs.transcriptWidth` (try/catch). While dragging, `onLive` writes
the panel's `style.width` directly and state changes once on release -- re-rendering the whole editor
per mouse move is what made the Transform drag stutter. Measured in the developer's running app
(1440 px): 640 -> 390 px by dragging (saved 390), dragged far right clamped at 928 with the preview at
420, ArrowLeft 908, the same 908 after a reload, double-click back to 640 with the key removed, no
horizontal page scroll, no console errors.
**Timeline redrawn after OpusClip's (2026-10-27) -- asked for by the developer, planned first.** The
toolbar is one row in three parts: tools on the left as icon buttons with tooltips (Hide timeline,
⦚ Split, 🔗 link/unlink audio **disabled "next step"**, 🗑 delete / ↺ restore the picked part, and
**Fit** = zoom back to 1x, lit while at 1x), **⏮ ▶ ⏭ and `00:01.06 / 00:55.16`** in the centre (moved
from under the preview, which gains that height; they stay when the timeline is hidden), and zoom
− slider + on the right. The ruler labels only big marks (at least 500 px apart, e.g. 0 · 30) with
dots between that divide them (`rulerSteps`); the layout band is a plain grey bar with each shot's
label ("Original · not reframed" without a reframe); the clip strip is a rounded block with a
disabled **+** on each side (add a video before / after -- next step); the waveform has its own
rounded panel; the playhead has a rounded head on the ruler. Cuts, the picked part, splits and the
trim handles moved with the new geometry (strip at 56 px). `EDGE_PX` 10 px inside the scroller keeps
the playhead's head whole at 0 s. Measured in the browser on Rhino with a test sidecar + Vite (the
developer's app was not running; both stopped afterwards, PUTs answered by the test): ruler `0` · `30`,
no transport left under the preview, Play -> Pause, ⏭ +5 s to 00:05.00, zoom in turns Fit off and Fit
turns it back on, Hide keeps the transport and removes the strip, the scroller does not scroll at 1x
(1696 / 1696), no page scroll at 1100x700, no console errors.
**Resizing the Transform box snaps to the frame edges too (2026-10-27) -- asked for by the developer**
("when transform touch frame show solid yellow"). Only moving snapped; a corner drag that met the frame
edge showed nothing. `scaleSnapped` (`transformBox.ts`) wraps `scaleFromCorner`: when the **dragged**
edge comes within `SNAP_PX` of a frame edge (0 or 1) it is pulled exactly onto it -- the box keeps its
ratio and its opposite corner -- and the solid 2 px yellow guide shows on that edge (both when the
corner meets two edges at once). The fixed (anchor) edges do not count, so a box already full-width
does not light a guide while it is resized. Measured read-only in the developer's running app on
How-AI-agents at 16:9 (PUTs answered by the test): a small drag no guide; near the right edge the box
snapped to right 1808 / bottom 743 (the stage's edges) with `x@1806 solid` and `y@741 solid`; far past
no guide; none after release; no console errors.
**Speech cleanup panel redrawn after OpusClip's (2026-10-28) -- asked for by the developer with a
screenshot.** `screens/CleanupPanel.tsx` is now cards: **"N pauses found"** with a checkbox (count
pauses in or out), ^ `1/N` v (jump to the previous / next pause, 1 s before it) and a **Pause
duration** slider 0.3-3 s (was three buttons 0.5 / 1 / 2; the sidecar already took 0.1-10 s, so no
backend change) that asks `/cleanup` only once it rests 300 ms; **"N filler words found"** with the
same checkbox and ^ / v, and "view all fillers" folding out the per-filler checkboxes; **Bad takes**
drawn with Detect now disabled ("next step" -- nothing detects retakes yet; OpusClip's "free trial"
left out, no billing); a "cut N s · N places" line and a white **Remove all** (Edit Video only; the
Silence dialog keeps its own Export). Default pause is 0.5 s (was 1). Edit Video's aside is 340 px
(was 300; "pauses found" truncated). Measured in the browser with a test sidecar + Vite (stopped
afterwards; PUTs answered and `POST /jobs` 503 by the test): How-AI-agents 164 pauses / 31 fillers,
5 slider presses -> one request (`pause=1`) -> 38 pauses; ^ / v 1/164 -> 2/164 -> 1/164 seeking 27.88
/ 32.74 s; unticking pauses 67.9 -> 10.4 s; unticking one filler 69 -> 68 places; Remove all closed
the panel with 66 cuts. Rhino: 3 pauses, the filler card disabled at 0/0; the Silence dialog sends
`[[10.54,11.34],[12.98,39.21],[48.69,49.21]]`. No console errors; tsc and oxlint clean.
**Speech cleanup closes on an outside click (2026-10-28) -- asked for by the developer.** A
`document` `pointerdown` listener in `EditorScreen` (only while the panel is open) closes it when
the press lands outside the aside. It ignores the Speech cleanup button itself (`data-cleanup-toggle`,
in the transcript toolbar -- without that, a click closed the panel and the button's own click
reopened it, measured), the right-hand tools column (its buttons switch panels themselves) and any
`role="dialog"`. Measured read-only against the developer's running app: ^ / v and the slider keep
it open; a click on the preview or the timeline closes it; the button toggles it; the Captions tool
swaps to Captions; no console errors.
**Resizable timeline (2026-10-28) -- asked for by the developer.** The timeline's top edge is a
`role="separator"` (gold line and a ⇕ knob on hover): drag up for a taller timeline, down for a
shorter one, ↑ / ↓ move 8 px, double-click returns to the default. The frame strip and the waveform
grow together (waveform = 86 % of the strip, so the default 56 px keeps the old 56 / 48); the
height is a CSS variable `--strip-h` on the section, written straight to the element while dragging
and committed to state once on release, so a drag never re-renders the 60 frame tiles. Clamped to
32 px and to keep the whole timeline under 55 % of the window (`stripMax`, at most 200), saved in
localStorage `kcs.timelineStrip` (try/catch; the default removes the key). Overlays (cuts, picked
part, splits, trim handles) already ran to `bottom-0`, and the side "+" blocks follow `--strip-h`.
Measured read-only against the developer's running app (PUTs answered, `POST /jobs` 503) on Rhino at
1440x900: timeline 237 / preview 602 at the start; dragging up 150 px -> 388 / 451 (strip 137, wave
118); far up clamped at 499 / 340; far down at 193 / 646 (strip 32); ↑ x2 -> 48 px, kept after a
reload; double-click -> 56 with the key removed; at 1100x700 the maximum is 390 / 249 with no page
scroll; no console errors.
**Whisper batched: transcribe ~3x faster (2026-10-28) -- asked about by the developer** ("Whisper takes
long, can I use Google AI offline?"). Google's speech APIs upload audio, and the local Gemma models
give no word timestamps, which captions, cuts and Speech cleanup all need -- so Whisper stays and is
made faster. Benchmarked first on 5 min of How-AI-agents (GTX 1060 3 GB, `medium`, no job running):
sequential beam 5 (the old setting) 73-85 s = 4x realtime, peak 2.5 GB; sequential beam 1 no faster
(83 s); batched 8 + beam 1 33 s but **out of memory 2 of 4 times** (and the CUDA context then failed
the next setting with "invalid device ordinal"); batched 16 58 s; **batched 4 + beam 1 20.7 s =
14.5x, peak 2.6 GB, stable twice**, 1.6 % of words differ ("gonna" -> "going to", "a" -> "an").
`config.WHISPER_BATCH_SIZE = 4` / `WHISPER_BATCH_BEAM = 1` (0 = the old sequential path);
`_transcribe_with(batch_size=)` uses faster-whisper 1.2.1's `BatchedInferencePipeline` on the GPU only.
Fallback order in `transcribe()`: batched -> on **out of memory only** the GPU again sequentially with
beam 5 -> CPU `small`; `_attempt` returns the error without its traceback (the traceback holds the
model's VRAM) and `gc.collect()` runs before the retry; the messages now carry their own wording, so
`make_clips` prints them as given. Batched returns whole VAD chunks (How-AI-agents: 80 segments,
median 27 s, against 434 / 4.7 s), and `highlights` shows the LLM one `[start - end] text` line per
segment to pick times from, so `split_segments` cuts them back into sentences from the word
timestamps: after `.?!` once a piece is >= 4 s, at a pause > 1 s, and at the biggest gap while over
15 s -> 360 segments, median 5.2 s, 43-70 lines per 5-min chunk (was 46-65); no word is lost.
Measured on the whole How-AI-agents (35:25) through the real `transcribe()` into the scratchpad
(the project's own `transcript.json` untouched): **153.8 s against 7:18 (2.8x faster, 13.8x
realtime)**, no fallback; 6773 words against 6662, 2.28 % different, start times median 10 ms /
p95 170 ms apart (4 % over 200 ms); pauses > 0.5 / 1 / 2 s 136 / 34 / 5 against 164 / 38 / 8, so
Speech cleanup suggests fewer. Visible differences to judge: numbers come out as words ("95 %" ->
"ninety five percent", which the burned captions then show) and a few words change ("claw" ->
"cloud"). Which version is more accurate was not measured. Existing transcripts are kept (cache);
only new transcribes or `--redo transcribe` use batched. `eta.ts` transcribe GPU medium 12.4 -> 3.9
s per minute of video (small 6 -> 2, not measured). Tests: 5 new in `tests/test_transcribe.py`
(batched first on GPU and never on CPU, OOM -> sequential GPU, OOM twice -> CPU, sentence split,
15 s cap, wordless segments kept); 699 pass. Not yet run through `make_clips` / the app on a new
video.

**Edit Video UI/UX audit (2026-10-28), fix 1 of the list -- the preview vanished on a small window.**
At 1100x700 with Captions open the stage measured **122x11 px**: the transcript was `shrink-0` at
46 % (min 360), so the 340 px aside and the 92 px tools column took their width from the preview
alone, and its toolbar wrapped into a column. The transcript is now `shrink` (min 280) and the
preview has `minWidth: max(360px, min(40%, 100% - 720px))` (`PREVIEW_MIN_CSS`), so flex narrows the
transcript instead; `PanelResizer`'s max reads that min-width from the computed style. Measured
(transcript / preview / stage), Captions open: 1100 288 / 380 / 340x191, 1280 336 / 512 / 472x266,
1440 432 / 576 / 536x302 (was 640 / 368 / 328x185); with no panel open the widths are unchanged;
no horizontal scroll, no console errors. Still open from the audit: undo covers only cuts/splits,
autosave fails silently, no Space play/pause, words not keyboard-focusable, search has no
next/previous, Edit Video not translated, Delete / S fire while a button or select has focus.
**Audit fixes 2-4 (2026-10-28): Space, shortcut guard, save status.** (1) **Space** plays / pauses
the preview (`togglePlay`), except on a real `<button>`, which Space clicks. (2) Every editor
shortcut goes through `editorOwnsKey`: nothing fires from an input, textarea, select,
contenteditable or inside `role="dialog" / "menu" / "listbox"` -- before, only input/textarea were
skipped, so Backspace on a Captions select could cut the picked timeline part. The timeline's
`role="slider"` stays allowed, so click a part then Delete still cuts it. (3) Autosave of cuts /
look / motion goes through `saveIfChanged`: it remembers the JSON the sidecar already has
(`lastSaved` ref + `savedBodies` state, set on load and on success) and sends a PUT only when it
differs, so **opening the editor writes nothing** (was 3 PUTs); the top bar shows `SaveStatus` --
"កំពុងរក្សាទុក…" while anything differs (including the 0.6 s debounce), "✓ បានរក្សាទុក", or a red
"⚠ រក្សាទុកមិនបាន" whose tooltip is the server's error and whose click retries (`retry` re-runs the
three effects). Measured in the browser (PUTs answered by the test, one forced 500): open -> 0 PUTs
and no status; Space on a word -> `play,pause`, no page scroll; Space on Speech cleanup -> the panel
opens, no play; Delete / Backspace / S in a Captions select -> 0 words cut, 0 cuts PUTs; Delete on a
word -> "កំពុងរក្សាទុក…" then "✓ បានរក្សាទុក"; a 500 -> "⚠ រក្សាទុកមិនបាន" (tooltip "disk full (test)"),
retry -> saved; no PUT while idle; no console errors; tsc and oxlint clean. A test trap: typing a
letter in a focused `<select>` picks the first option starting with it (native type-ahead), which
is a real change and a real save.
**Audit fixes 5-8 (2026-10-28): transcript keyboard, search steps, follow on seek, English.**
(5) The transcript is one Tab stop (`tabIndex 0`, pause chips now `tabIndex -1` -- before, Tab
stopped on every pause, 340 on How-AI-agents); ← / → select the previous / next shown item and seek
there, Shift extends (`stepSelection`; with nothing selected the first press takes the spoken word),
skipping pauses or cut words the Filter hides. (6) Search keeps a cursor (`hitCursor`, tied to the
needle): Enter / ↓ next, Shift+Enter / ↑ previous, wrapping, with ˄ ˅ buttons and "3/84"; the current
match gets a gold outline. (7) The transcript follows the spoken word when paused too (timeline
click, ⏭), not only while playing; `block: 'nearest'` keeps it still when the word is already in
view. (8) Edit Video speaks English: `t()` in `EditorScreen`, `EditorTimeline`, `CleanupPanel`,
`MotionPanel`, `CaptionPanel` (so the Subtitles screen's panel too), `LookMenus`, `LayoutMenu`,
`TransformBox`, `SubjectTrackDialog`, `PresetCard` and the kit `TopBar`'s Home tooltip; data gained
English beside the Khmer (`layoutKinds` `en`, caption presets `en`, colour names `en`, animation
groups `en` and a third tuple item for the three Khmer animation labels -- the Python test that reads
the ids still passes); `i18n.useNum()` gives Khmer or Western digits. Left in Khmer on purpose: the
sample artwork on the Box / Neon preset cards (like tool art). Measured in the browser: How-AI-agents
"skill" 84 matches, Enter 1/84 -> 2/84, Shift+Enter 1/84, ↑ wraps to 84/84, a new needle resets;
→ x3 then Shift+→ x2 selects "what are people"; 1 Tab stop in the transcript; a paused timeline
click at 80 % brings word 5622 into view; in English a text + attribute scan of the editor, Filter /
Transcript / Aspect / Layout / Background / Tracker menus, the Captions tabs, Motion, Speech cleanup
and the subject-tracking dialog finds no Khmer except that artwork; the Khmer runs of fixes 2-4 still
pass; no console errors, no PUT; tsc, oxlint and `tests/test_caption_fx.py` clean.
**"+ Extend a clip" = Add a section from transcript (2026-10-28) -- asked for by the developer with
OpusClip's dialog.** OpusClip edits a clip cut from a long video; Edit Video edits the **whole** video
through one cut list, so adding a section means **taking that range out of the cut list**: it comes
back into the video at its own place in time (after a ‖ trim or deleted words). No pipeline or
sidecar change. `screens/ExtendDialog.tsx` (1100 px): left, the transcript as sentences with
`[0:00:01]` stamps (`sentencesOf`: ends after `.?!`, at a pause >= 1 s, or at any pause once a
sentence is over 20 s -- Rhino's transcript has no punctuation), click a stamp or a word = the whole
sentence, drag across words = that range, words cut now struck through, the selection one continuous
band (the space between two chosen words is coloured too); right, the source video at the start with
a ▶ that plays only the section (pauses at its end), a two-handle slider over the whole video and
− / + 0.1 s under each handle (←/→ 0.1 s, Shift 1 s). The footer says how many cut seconds Add brings
back (`removedSeconds(cuts) - removedSeconds(subtract(cuts, range))`); a section already fully in the
video disables Add, and with no cuts at all it says to trim or delete first. Add is `change(subtract(
cuts, range))`, so it is one undo step, then seeks there. Opens on the sentence at the playhead.
Measured in the browser on How-AI-agents (PUTs answered by the test): 615 sentences; no cuts -> Add
disabled with the note; after deleting 21 words -> 21 struck, opens on the playhead's sentence,
"Adds back 1.5 s"; a stamp click selects that sentence ("already in the video" for an uncut one);
dragging word 15 -> 30 spans two sentences, 3.34-7.38 s; the end handle 7.38 -> 7.48 (→) -> 7.58 (+);
selecting 0-12.18 s -> "Adds back 5.7 s", Add closed the dialog and all 21 words returned, Ctrl+Z
cut them again; Khmer and English both complete; no console errors; tsc and oxlint clean.
**Extend dialog: View menu (2026-10-28) -- asked for by the developer with OpusClip's menu.** A
split-panel icon button at the right of the dialog's subtitle row opens **Side by side** (transcript +
video, the default) / **Caption only** (no video or slider, the transcript alone and the dialog 760 px
instead of 1100, so lines stay readable); the button shows the current view's icon, the choice is
remembered in localStorage `kcs.extendView` (try/catch), and Escape closes only the menu (capture +
`stopPropagation`, as in `Menu.tsx`). Measured in the browser: the menu lists both with Side by side
checked, Escape leaves the dialog open, Caption only removes the video and widens the list 580 -> 704
px, still Caption only after a reload, Side by side brings the video back; the Add flow test still
passes; no console errors. Seen on the way: `VideoPicker`'s "វីដេអូគំរូ" is not translated yet (i18n
steps 2-4 cover the dialogs outside Edit Video).
**Real "Add" in the Extend dialog, step 1 of 4: the pipeline (2026-10-29), planned with the developer
first.** Decided: the dialog asks **where** each added section goes (its own place when it is cut =
restore, as before; the start as a hook; the playhead; the end), and the timeline stays in source time
with a marker at the insert point. A section added somewhere else is a **copy** (an insert), so the
cut copy is now **parts in output order**, which may repeat and need not follow time.
`pipeline/cuts.py`: `sequence(keeps, inserts, duration)` places each insert `(start, end, at)` at its
source time `at` (a keep with `at` inside is split; `at` inside a cut goes before the next keep; `at`
within `MIN_KEEP_SEC` of a keep edge does not split; same `at` keeps list order; too-short or
out-of-range inserts are dropped); `placed(parts)` gives each part's output offset; `shift_time`
(first occurrence), `shift_range` (every occurrence) and `shift_transcript` (words of a repeated part
appear again; a segment crossing a cut still merges when parts follow in time, so the old output is
unchanged) walk the parts; `subject_track.shift_track` maps points per part. `cut_filter` already
concatenated parts in any order. Inserts live in the same `--cuts` JSON (`{"cuts", "inserts"}`,
`read_inserts`), and a file with inserts and no cuts is accepted. Tests: 6 in `tests/test_cuts.py`,
1 in `tests/test_subject_track.py`; 706 pass (the old cut tests unchanged).
Measured on Rhino, `--full --aspect 4:5 --layout center --transition hard --no-captions` with cut
12.98-39.21 and a hook 40-44 at 0, into a scratch `full_edit_4x5` deleted afterwards: 17 s; parts
after frame snapping `[40.04, 44.00] [0, 13.01] [39.25, 55.68]`; copy and render 33.408 s video and
33.408 s audio; frames of the copy against the source (160x90 grey, mean |diff|): copy 1.0 s = source
41.0 s 0.3 (against source 1.0 s 50.0), copy 3.5 = 43.5 2.3 (66.9), copy 5.0 = 1.0 5.6 (46.2), copy
18.48 = 40.71 2.2 (61.4), copy 30.0 = 52.23 3.6 (73.1); the transcript opens on the hook's "between
the black and the white..." and "On John Hume's" follows at 5.42 s. The source MD5 is unchanged; the
`edit/` cut-copy cache now holds this test's copy and is rebuilt by the next edit export (it is keyed
on the parts). Next: the sidecar (step 2), the UI (3), preview vs render (4).
**Real "Add", step 2 of 4: the sidecar (2026-10-29).** `manage.clean_inserts` checks
`[{start, end, at}]` (numbers, start / at >= 0, at least `INSERT_MIN_SEC` 0.1 s, at most
`MAX_INSERTS` 200; a bad one is `ValueError` -> 400, not dropped quietly) and keeps list order, which
`cuts.sequence` uses for inserts at the same `at`. `edit.inserts` sits beside `cuts` / `splits` in
`project.json`; `read_cuts` always returns `inserts` (an invalid hand-edited list reads as `[]`), and
`write_cuts(..., inserts=None)` keeps the saved ones, like `splits`. `PUT /projects/{name}/cuts` and
`JobRequest` take `inserts`; `start_job` pops it (it is not a flag), accepts inserts with no cuts,
writes `edit/cuts.json` as `{"cuts", "inserts"}` and points `--cuts` at it (so the job reports into
`full_edit*`); a job that sends no `inserts` renders none, while `project.json` keeps what was saved.
The transcript download follows the inserts too (`TranscriptExportRequest.inserts` ->
`editor.transcript_text(..., inserts)` -> `cuts.sequence`). Tests: 3 new in `tests/test_cuts_api.py`
and 1 in `tests/test_transcript_export.py`; 5 old asserts that compared the whole `read_cuts` dict or
`cuts.json` now include `"inserts": []`; 710 pass.
Measured through a test sidecar on port 8775 with a throwaway project (`zz-insert-test`, a copy of the
Rhino video and its transcript), `POST /jobs` with cut 12.98-39.21 and a hook 40-44 at 0, 4:5, hard,
no captions: `done` in 13.1 s, `cuts.json` and `project.json` hold the insert, 1080x1350, 33.408 s
video / 33.408 s audio, frames as in step 1 (copy 1.0 s = source 41.0 s, diff 0.3 against 50.0).
The test folder, the copy and its database rows were removed; the sidecar stopped; the source MD5
unchanged. Seen on the way: Rhino's own `project.json` already held `edit.inserts` (1.46-10.42 at
5.034 and at 0, written 01:23 on 2026-10-29) that none of this code wrote; it was left untouched, and
it is why the real test used a separate project.
**Real "Add", step 3 of 4: the UI (2026-10-29).** `cutList.ts` gained the pipeline's ordering in the
browser: `Insert`, `Part`, `keepRanges` (= `keep_ranges`), `sequence` (= `cuts.sequence`; the six
Python cases give the same parts, checked with `node --experimental-strip-types`), `keepPartAt` and
`outputSeconds`. **ExtendDialog** has a "Place at" choice -- Its own place (restore; disabled when the
section is not cut) / Start (hook) / Playhead <time> / End; with nothing chosen it is "own" for a cut
section and "start" otherwise; the footer says what Add does ("Copies 0:01.460-0:10.420 (9.0 s) to the
start -- this section will play twice"), and Add is no longer disabled when nothing is cut.
`onAdd(range, at)`: `at = null` restores (`subtract`), otherwise the editor appends `{start, end, at}`
to `inserts`. **EditorScreen**: `inserts` is state saved with the cuts (`{cuts, transition, splits,
inserts}`, the same key order as loaded, so opening still writes nothing) and part of every undo /
redo snapshot; a gold chip row above the transcript lists each insert ("＋ 0:01.5-0:10.4 -> start
(hook) ✕", a click seeks to where it plays, ✕ removes it) with the exported length; the timeline
draws a gold ＋ line at each `at` and its "->" length is `outputSeconds(sequence(...))`. The preview
now **plays the parts** in a `requestAnimationFrame` loop instead of only skipping cuts: at the end
of a part it seeks to the next one (into an insert and back), a hook plays first when playback
starts at 0, a seek re-finds the keep part, and punch-in follows the output part number like
`cut_filter`. Export and the TXT/SRT download send `inserts`; App sends `{cuts, transition, inserts}`
when either list is non-empty. A sidecar started before step 2 drops `inserts` (pydantic ignores
unknown fields) until it is restarted.
Measured in **Edge** (`channel: 'msedge'` -- Playwright's Chromium has no H.264, so earlier tests
could not play) on Rhino with `GET /cuts` answered by the test (an insert 40-42 at 3 s), PUTs answered
and `POST /jobs` 503: opening sends 0 PUTs; playing from 2.0 s every 100 ms read 2.80 2.92 **40.00**
40.07 ... 41.90 **3.06** 3.19 -- into the insert at 3 s and back; one chip, one marker, "-> 00:57.70"
(55.70 + 2); with no cuts the dialog offers own place disabled and Start chosen, "will play twice";
Add -> two chips, two markers, 01:06.71 (= 55.75 + 2 + 8.96), the PUT carried both inserts in order;
Ctrl+Z -> one, Ctrl+Y -> two, ✕ -> 01:04.71; with a cut word the dialog defaults to own place;
Export sent `cuts [[5.98, 6.78]]`, the hook and `full: true`; Khmer and English both; no console
errors; tsc and oxlint clean. Rhino's own `project.json` was not read or written (mtime unchanged)
and the source MD5 is unchanged; the test servers were stopped.
**Timeline Snap and Speaker buttons (2026-10-29) -- asked for by the developer** (OpusClip's toolbar:
Split / Link / Delete / Speaker / Snap; decided: Snap is an on/off toggle, Speaker mutes the preview
only, Hide timeline and Fit stay). **Snap** (magnet icon, gold while on, after Delete) decides whether
Split, the ‖ trim handles and the Extend dialog's dragged handles stick to word edges (`snapToWords`)
or land on the exact time; Alt does the opposite of Snap for one action (it used to mean "exact"
always). On by default, remembered in localStorage `kcs.timelineSnap` (`'0'` = off, try/catch).
`EditorScreen.snapped(at, alt)` is the one rule; `ExtendDialog` gets it as `snapTo` and applies it
only while dragging a handle (− / + and ←/→ stay exact 0.1 s steps). **Speaker** toggles `muted` on
the preview `<video>`; the export keeps its sound. Measured in Edge against the developer's running
app (it held 8765 and 5173; `GET /cuts` answered empty, PUTs answered, `POST /jobs` 503): toolbar
Hide · Split · Link · Delete · Speaker · Snap(on) · Fit; a timeline click to 10.29 s (inside "calf")
+ Split with Snap on -> split 10.42 (the word's nearer edge), Snap off -> a click at 20.15 split at
20.146; Snap off saved `'0'` and survived a reload; Speaker muted -> `video.muted` true, label
"Unmute the preview", then false again; the Extend start handle dragged 23 px landed on 4.580 (a word
edge) with Snap on and 4.738 (not one) with Snap off; no console errors; tsc and oxlint clean. Only
the test's own Vite was stopped afterwards.
**Speaker opens a volume popover (2026-10-29) -- asked for by the developer** (OpusClip screenshot: a
small panel with a white slider and the number). 🔊 now opens `VolumeButton` (in `EditorTimeline`)
above the button: a 0-100 range (focused on open, ←/→/Home/End work) and the value; it sets the
**preview's** `video.volume` and `muted` at 0 (the export keeps its sound), the icon shows ✕ / one /
two waves, the label reads "Preview volume: 24", and the value is remembered in localStorage
`kcs.previewVolume` (100 removes the key). The volume lives in the popover's own state and
`EditorScreen.setVolume` writes the video element directly, so dragging does not re-render the
editor (the Transform drag lesson). It closes on Escape (capture + stopPropagation) or a click
outside -- in the **capture** phase, because the Transform box stops `pointerdown`, and the first
version stayed open after a click on the video (measured). It is a `role="dialog"`, so Space in the
slider does not start playback. Measured in Edge against the developer's running app (`GET /cuts`
answered empty, PUTs answered): 100 at start; Home -> 0 and `muted`; 24 presses of → -> 24 and
volume 0.24, saved; Space in the slider did not play; Escape and a click on the video both closed it;
dragging to the right end -> 100 with the key removed; 2 survived a reload; no console errors; tsc
and oxlint clean.
**Resizers without the gold hover (2026-10-29) -- asked for by the developer** ("remove gold and
button"). The transcript / preview separator (`PanelResizer`) and the timeline's top edge no longer
turn gold or show the ⇔ / ⇕ knob on hover or drag: the first stays the plain 1 px `line` border, the
second draws nothing beyond the timeline's own top border; the cursor (col-resize / row-resize) is
what tells that they drag. Behaviour is unchanged. Measured in Edge against the developer's running
app while hovering: the vertical one has one child coloured `rgb(38, 44, 56)` (the `line` token) and
no gold, the horizontal one no children; dragging still resizes (transcript 640 -> 580, timeline 237
-> 297), double-click resets, the developer's saved sizes put back; no console errors; tsc clean.
**Timeline blocks, drag-box selection and Link (2026-10-29) -- asked for by the developer** (OpusClip
screenshot: parts after a split drawn as separate blocks, a drag rectangle selecting two of them;
decided: Link joins the selected parts into one, parts are drawn as blocks). Each split is now a
4 px gap in the timeline's own colour (`bg-chrome`) through the layout band and the frame strip, so
the parts read as blocks; the waveform stays continuous (one sound). The picked part is a white
outline around its block(s) (was gold). The selection is a time range (`partSel` in `EditorScreen`):
a click is `[t, t]`, a **drag box** is `[from, to]`, and `cutList.partsSpan` turns it into every part
it touches (a box ending exactly on a split does not take the next part). Pointer rule on the track:
with splits, dragging on the band / strip / waveform draws the box (4 px before it counts as a drag)
and a plain click seeks + picks on release; dragging on the ruler, or anywhere while there are no
splits, scrubs as before. **Link** (🔗, was disabled "next step") removes the splits inside the
selection (`splitsInside`) -- one undo step; Delete on a multi-part selection cuts the whole span. The
"link / unlink audio" meaning of OpusClip's button is not built. Measured in Edge against the
developer's running app (`GET /cuts` answered with splits 10 / 20 / 35, PUTs answered): 3 gaps; a
click at 15 s selects 10-20 with Link off; a box from 12 s (started on the band) to 25 s selects
10-35 with Link on; Link -> PUT `splits [10, 35]`, 2 gaps; Ctrl+Z -> `[10, 20, 35]`; a box 5-22 s ->
0-35, Delete -> PUT `cuts [[0, 35]]`; a drag on the ruler still scrubs (to 00:29.96) with no box;
no console errors; tsc and oxlint clean.
**Timeline zoom no longer resizes the panels (2026-10-29) -- found by the developer.** Zooming past 1x
made the timeline's scroller grow a 10 px horizontal scrollbar (`overflow-x-auto`), so the timeline
grew 237 -> 247 px and the preview shrank 602 -> 592 px, and back again at 1x. The scroller is now
`overflow-x-scroll`, so the scrollbar's room is always there (an empty thin track at 1x). Measured in
Edge **without** Playwright's default `--hide-scrollbars` (headless draws no scrollbars, which is why
the first measurement showed nothing -- `ignoreDefaultArgs: ['--hide-scrollbars']` reproduces what
WebView2 draws): before 237.2 / 247.2 / 247.2 / 237.2 px at 1x / in / in / 1x, after 247.2 at every
zoom with the preview at 591.8; no console errors; tsc and oxlint clean.
**Dragging the timeline's edge resizes only the waveform (2026-10-29) -- asked for by the developer**
("when user drag panel don't resize" the frame strip; chose: thumbnails fixed, waveform grows). The
frame strip, the selected-block outline, the split gaps and the side "+" blocks are a fixed
`STRIP_PX` 56 px; the dragged value is now the CSS variable `--wave-size` (renamed from `--strip-h`)
and only the waveform follows it (86 %, so the default stays 48 px). The drag maths changed with it:
1 px of mouse = 1 / 0.86 of size (was 1 / 1.86, when strip and waveform grew together), and
`stripMax` subtracts the fixed strip; the localStorage key `kcs.timelineStrip` is unchanged.
Measured in Edge with real scrollbars against the developer's running app (`GET /cuts` answered
with one split, PUTs answered), at 1440x900 and 1100x700: strip 56, split gap 84 (ruler + strip),
"+" 56 at start, after a 120 px drag up, at the top limit (waveform 172, timeline 371) and the bottom
limit (waveform 28, timeline 227); double-click back to waveform 48 / timeline 247; no page scroll;
the developer's saved size put back; no console errors; tsc and oxlint clean.
**The timeline's height is fixed again (2026-10-29) -- asked for by the developer** ("wave still
resize"; chose: remove the drag). The drag-to-resize on the timeline's top edge is gone: no
separator, no `row-resize` cursor, no `--wave-size` variable or `kcs.timelineStrip` reading; the frame
strip is `STRIP_PX` 56 px and the waveform `h-12` 48 px, the old defaults. (An old saved
`kcs.timelineStrip` value is simply no longer read.) The transcript / preview `PanelResizer` is
unchanged. Measured in Edge against the developer's running app: timeline 247 / strip 56 / waveform
48, only the vertical separator left; a 150 px drag up from the top edge changes nothing (cursor
`auto` there); the transcript resizer still moves 640 -> 576 (the developer's width put back); no
console errors; tsc and oxlint clean.
**Timeline resize = an empty space above the tracks (2026-10-29), planned with the developer first**
(OpusClip screenshot with the empty area between the ruler and the tracks circled). Decided: dragging
the timeline's top edge changes only an **empty space** between the ruler and the tracks; the layout
band, the 56 px frame strip and the 48 px waveform keep their size and sit at the bottom; the space
starts at `SPACE_DEFAULT` 96 px, like OpusClip's. The edge is a plain separator again (no gold, no
knob -- cursor ↕ only), 1 px of mouse = 1 px, ↑ / ↓ 8 px, double-click = default; the space is clamped
to 0 and to keep the timeline under 55 % of the window (`spaceMax` = 0.55 x window - `BASE_PX` 247,
the measured height at space 0) and remembered in localStorage `kcs.timelineSpace` (the default
removes the key; the old `kcs.timelineStrip` is not read). The size is the CSS variable `--space-h`,
written directly while dragging and committed once on release; every overlay that used fixed
`top-7` / `top-14` (cuts, the selected-block outline, insert markers, split gaps, trim handles) and
the side "+" blocks now use `28 / 56 px + var(--space-h)`. The space belongs to the track, so a click
there seeks and a drag there draws the selection box (as in the screenshot); the ruler still scrubs.
It is reserved for layers (text, B-roll, logo) in Phase 3. Measured in Edge with real scrollbars
against the developer's running app (`GET /cuts` answered with a cut, two splits and an insert, PUTs
answered): 1440x900 default space 96 / timeline 343 / preview 496, +60 -> 156 / 403, max 248 / 495,
min 0 / 247, strip 56 and waveform 48 throughout, the band, split gaps and cut 28 px above the strip
and the insert, trim handles and "+" level with it at every size; a box started in the empty space
selected 10-55.75 s; a click there sought to 00:39.80; a ruler drag scrubbed to 00:29.96; a saved 80
survived a reload; double-click back to 96 with the key removed; hidden timeline 53 px; 1100x700 max
138 / 385 with no page scroll; 0 PUTs, no console errors; tsc and oxlint clean.
**The preview kept cropping when the timeline was tall -- found by the developer** (a 16:9 frame
with the face cut off after dragging the timeline up). The stage was `width: 100%` + `max-h-full`
for 16:9 (and `height: 100%` + `max-w-full` otherwise): once the box got shorter than 16:9 the
height was capped but the width stayed 100 %, so the stage was wider than 16:9 and `object-cover`
cropped the video. The preview box is now a size container (`[container-type:size]`) and the stage
is `width: min(100cqw, 100cqh x ratio)` / `height: min(100cqh, 100cqw / ratio)`, the largest box of
the aspect that fits both ways. Measured in Edge with real scrollbars against the developer's
running app at timeline space min / default / max, for 16:9, 9:16 and 1:1, at 1440x900 and at
1100x700 with Captions open: every stage at its exact ratio (1.778 / 0.562-0.563 / 1.000), inside
its box and touching one side; e.g. 1440 16:9 668x376 -> 414x233; no console errors; tsc and oxlint
clean. Seen on the way: at 1100x700 with Captions open the default 96 px space leaves a 201x113
16:9 preview (127x71 at the max space), so the default may be too large for small windows.
**Scrubbing the timeline is smooth on long videos (2026-10-29) -- found by the developer** ("scrub not
smooth"). Measured first (Edge, 90 mouse moves along the ruler, against the developer's running app):
on How-AI-agents (35 min, 6,600 words) the 90 moves took **23.7 s** with 104 long tasks of 130-535 ms
-- every move called `seek` -> `setTime`, which re-rendered the whole editor, the 6,600-word
transcript included (~140 ms each); the 56 s Rhino video, 70 words, was fine (3.1 s, 1 long task).
Now a ruler drag (or a drag anywhere while there are no splits) goes through `onScrub`: the timeline
keeps the time in its own `scrubAt` state (playhead + clock) and `EditorScreen.scrubTo` only sets
`video.currentTime`, with `onTimeUpdate` ignored while `scrubbing`; on release `onSeek` updates the
editor once. A one-seek-at-a-time queue (seek again only on `seeked`) was built and measured against a
seek on every move, three runs each: Rhino 2-4 frames shown vs 11-31, How-AI-agents 9-12 vs 6-11, so
the browser's own handling of a seek per move was kept and the queue removed. After: How-AI-agents 90
moves in 2.4-5.4 s, rAF gap p95 **8.4 ms** (was 175), 0-3 long tasks (the one render on release);
mid-drag the timeline clock and playhead move while the transcript waits, on release the clock reads
17:46.25 = `video.currentTime` 1066.25 and the spoken word moves to 3594; no console errors; tsc and
oxlint clean. The frames shown during a fast drag still depend on the source's keyframes (a few per
second on these files); a smoother picture would need scrubbing thumbnails, not built.
**Trim handles shrink the block instead of drawing red (2026-10-29), Option A, planned with the
developer first** (OpusClip screenshots: the yellow ‖ edge moves in and the trimmed part is gone).
The timeline now shows only the part left after the head / tail trims: `EditorTimeline` takes
`[head, tail] = trimEdges(cuts)` as its window, `pxPerSecond = content / (tail - head)`, and every
position goes through `xOf(t) = (t - head) x px/s` / `tOf(x)` (clicks, scrub, marquee) or `box(a, b)`
(band shots, Tracker OFF, Subject, cuts, the selected outline -- clipped to the window, nothing drawn
outside it); frames are taken from `head .. tail`, the waveform is `peaks` sliced to it, the ruler
counts from 0 (time inside the trimmed video), splits outside the window are not drawn and insert
markers are clamped to its edges. **Cuts in the middle stay red** at their place; the head and tail
trims are not drawn at all. Dragging a handle inward covers what it will cut with the timeline's own
colour, so the block and waveform look shorter; on release the trim is one undo step and the block
slides to 0. Dragging a handle outward past the block (pointer capture, unclamped) brings trimmed
time back, and a **double-click** on a handle brings the whole trim back. A click on a handle
without moving no longer commits a trim: the two clicks of a double-click used to commit the same
edge, which Snap then moved to a word edge (undo restored 49.89 instead of 50, measured). No pipeline
or sidecar change: trims are still `cuts`. Measured in Edge with real scrollbars against the
developer's running app (`GET /cuts` answered with trims 0-5 / 50-end and a middle cut 20-25, PUTs
answered): the block 1196 px for 45 s, the one red band at x 399 width 133 (= 15 s and 5 s at
26.6 px/s), frames 6.90 .. 48.10 s, handles at 0 and 1184 reading 5 and 50; a click at the block's
left edge sought to 5.04 s; dragging the start handle in 100 px showed a 107 px cover, then PUT
`[0, 9.14]` (Snap) and the block slid back to 0 with frames from 10.80 s; dragging it out 60 px ->
`[0, 7.06]`; double-click on the end handle removed the tail trim; Ctrl+Z restored exactly
`[50, 55.746]`; no console errors; tsc and oxlint clean.
**Reorder timeline blocks by dragging, step 1 of 4: the pipeline (2026-10-30), planned with the developer
first** (OpusClip screenshot: a dashed box of the block's length stays where the block was while it is
dragged; on release the blocks snap together with no gap; every split part can move). `--cuts` JSON gains
`order` (`[[start, end], ...]`, blocks in output order, source time; `cuts.read_order`), and
`cuts.rearrange(keeps, order)` applies it before `sequence`: cut parts stay out, a part `order` does not
mention goes last, and parts continuing in time are joined, so an unchanged order equals `keeps` exactly.
`sequence` now finds each insert's piece in time order, so an insert follows its piece when it moves
(same results as before on sorted keeps). A file with only a real reorder is accepted.
Found by measuring: Rhino's first frame is at 0.0417 s (`start_time`) and its picture really ends at
55.6806 s, while `video_seconds` is only the stream's duration. A part starting at 0 had 42 ms of audio
with no picture, harmless at the end of a video but shifting every later part by a frame once it moves.
`make_clips` now takes the end as `video_start + video_seconds` and starts no part before the first frame;
this applies to every `--cuts` render. `snap_to_frames` tolerates 0.02 frame, since 3-decimal rounding could
push an edge one frame on. Measured on a throwaway copy of Rhino, order `[[30, 55.7], [0, 30]]`, 4:5, hard,
no captions: 1334 of 1334 frames; copy video 55.639 s / audio 55.615 s, render 55.639 / 55.635; six points
across both parts match the expected source frame (diff 0.2-0.5, the same constant one-frame index offset in
both, from FFmpeg's duplicated first frame in the decoded source); "That's" (39.33 s in the source) opens at
9.30 s and "On" follows at 27.07 s. Tests: 5 in `tests/test_cuts.py`; 715 pass. The test project was removed;
the source MD5 unchanged. Next: the sidecar (2), the timeline (3), preview vs render (4).
**Reorder, step 2 of 4: the sidecar (2026-10-30).** `manage.clean_order` checks `[[start, end], ...]` (at
least 0.1 s, a bad one is 400) and returns `[]` for blocks already in time order, since that changes nothing,
so "was anything moved" is "is the list non-empty". `edit.order` sits beside `cuts`, `splits` and `inserts` in
`project.json`; `write_cuts(..., order=None)` keeps the saved one. `PUT /projects/{name}/cuts`, `POST /jobs`
and the transcript download take `order`; `start_job` pops it (not a flag), writes it into `edit/cuts.json`
and accepts a job whose only edit is a reorder (a time-order `order` alone is 400, because the pipeline would
refuse it); like `inserts`, a job that sends no `order` renders none while `project.json` keeps it. Tests: 4 new
(3 in `test_cuts_api.py`, 1 in `test_transcript_export.py`), 4 old asserts now include `"order": []`; 719 pass.
Measured through a test sidecar on port 8775 with a throwaway project: `order [[30, 55.7], [0, 30]]`, 4:5, hard,
no captions, `done` in 24.5 s into `full_edit_4x5` (`edited: true`), 1080x1350, video 55.639 s / audio 55.635 s;
`/cuts` read it back. The test folder and its database row were removed; the source MD5 unchanged.
**Reorder, step 3 of 4: the timeline (2026-10-30).** A press on the frame strip now belongs to the block under
it: dragging moves the block, a plain click seeks and picks on release. This replaces scrubbing on the strip
(the ruler still scrubs) and marquee from the strip (the band, waveform and empty space still draw it). While
dragging, a dashed box of the block's length stays in its place, a ghost follows the mouse, and a gold line marks
the drop; on release the blocks close up with no gap, dropping in place changes nothing, and Escape cancels. All
of it sits in an `overflow-hidden` layer, because the ghost past the end grew a scrollbar. `order` is state in
`EditorScreen`, part of every undo snapshot, saved with the cuts and sent by Export and the transcript download.
`cutList.ts` gained `rearrange` (= `cuts.rearrange`), `blocksOf` and `moveBlock`, and the timeline's output-order
mode now also runs when `order` is set. HOOK blocks use the same drag (they had their own handlers). `box()` in
that mode draws inside the part holding its start, since `xOf(end)` may land in another block. **The trim handles
are hidden once blocks are reordered**, because the ends of the row are no longer the video's start and end.
Measured in Edge against the developer's running Vite (`GET /cuts` answered by the test, every write answered, no
job): splits 10 / 25 / 40, dragging 10-25 past the end: slot 322 px wide at its place, ghost following, one drop
line; a 4 px wobble shows no line; the PUT sent `order [[0,10],[25,40],[40,55.705],[10,25]]`; Ctrl+Z -> `[]`,
Ctrl+Y -> the same order; a click sought to 29.98 s with no PUT; Escape and dropping in place sent 0 PUTs; no
splits: a slot as long as the video, ghost, no line, 0 PUTs; a saved order opens with 0 PUTs and 0 trim handles and
Export sent it with `full`. On How-AI-agents (35 min) 90 moves took 3.1 s, frame gap p95 16.6 ms, one 358 ms frame,
scroller 1216 / 1216. tsc and oxlint clean, 719 pass. Not done: the preview and the clock still follow source time
(step 4); the layout band is drawn per shot from the first part it starts in, so it is approximate after a reorder.
A sidecar started before step 2 ignores `order`, so it is lost on reopening until the app restarts.
**Reorder, step 4 of 4: preview and clock (2026-10-30).** The clock and playhead count the exported video once
blocks are reordered or inserts exist (`cutList.outputTime`; while a part plays it wins, since a copied time sits
in two places), and the total reads the exported length. ⏮ ⏭ and ← → walk the exported video (`sourceAt`) instead
of jumping across blocks. Opening a reordered project places the video on the first block once, and Play after
the last block starts from the first again. The play loop itself already walked `parts`, so it only needed
`order`. Measured in Edge against the developer's Vite (`GET /cuts` answered by the test with
`order [[8,14],[0,8],[14,55.7]]`, 0 writes): on open source 8.00 s, clock 00:00.00, playhead at the left; while
playing the source jumped 13.87 -> 0.01 and 8.02 -> 14, and 15 s in read clock 16.49 at source 16.49; from output 7
(source 1) the skip reached output 12 (source 6). Against a real render of that order (16:9, centre, hard, no
captions; video 55.639 s / audio 55.639 s): mean frame difference at output 1 / 5 / 7 / 13 s is 19.1 / 14.7 / 10.2 /
20.0 against 48.1 / 53.5 / 57.4 / 39.8 for the source at the same time, so the order matches. This is not a
frame-exact check: the same comparison after the moved blocks (20 and 40 s, where render and source show the same
picture) reads 20.7 and 7.8 against 15.4 and 5.5, so browser frames differ from FFmpeg's by that much anyway. Lip
sync was not judged by ear. Checked in Edge only, not the desktop window. tsc and oxlint clean, 719 pass (no new
Python tests; no TS test runner exists). The test project was removed; the source MD5 unchanged.
**Trim the edges of any block after a reorder (2026-10-30) -- option A, chosen by the developer** after "play across a
split shows black": Rhino's source really is black at 0.04-0.79 s, and the developer's order put the block starting at
0 mid-video, at 13.52 s. With blocks reordered, the two row-end trim handles stay hidden and every block gets its own:
gold on the selected block, invisible until hovered on the others, none under 28 px wide. Dragging in cuts that part
(`cutList.trimBlock` -> `add`; a cover makes the block look shorter), dragging out restores only cut time
(`blockEdgeLimit`: within the adjoining cut and the block's `order` range, so it never runs over a neighbour),
double-click restores it all, a block stays at least 0.5 s, and it is one undo step. Snap applies, and the preview
seeks to the snapped edge. `outputTime` for a time inside a cut now reads the next kept part's start in time order;
before, right after a trim, the clock read 00:00.00 instead of 00:13.52 because the seek landed 2 ms before the edge.
Measured in Edge against the developer's Vite with their order (`GET /cuts` answered, writes answered): 6 handles, no
row-end handles; 17 px in on the middle block's start -> `cuts [[0, 1.072]]`, `order` unchanged, length 00:54.67, clock
00:13.52, source 1.07; undo `[]`, redo the same; dragging out -> `[]`; an end with no cut beside it dragged out -> 0
PUTs; end dragged in -> `[[34.804, 37.228]]`, double-click -> `[]`. A real render of that cut + order on a throwaway
copy: video 54.596 s / audio 54.596 s, `blackdetect` finds no black at the join, only 54.43-54.55 s, the source's own last 0.125 s.
tsc and oxlint clean, 719 pass. Edge only, not the desktop window. The test project was removed; the source MD5 unchanged.
**No waveform after deleting a project and opening it again (2026-10-30) -- found by the developer** (a screenshot beside
OpusClip's). The waveform comes from `output/<name>/audio.wav`, which went to the Recycle Bin with the project at 18:59.
Opening the video again should transcribe it, but the effect returned on any `job` of this video, and the app still held
the earlier `done` job (`70ce48dc`, read from `GET /jobs`), so nothing ran and the editor stayed with no words and no
wave. Only a `running` job blocks it now; `asked` still limits it to once per opening. Measured in Edge with everything
mocked: first opening 1 job and no wave; reopened in the same session 2 jobs (before: stuck), wave drawn; opened again
with the transcript present, no new job and the wave drawn; no page errors. Not run against a real transcribe.
**Trim handles restyled after OpusClip's (2026-10-30) -- asked for by the developer** ("this || use only video
thumbnail"). The tall gold bars over the strip and waveform became two white bars (`GripBars`, with a dark shadow so they
read on a bright frame) on the frame strip only, with no fill. This applies to the row-end handles and the per-block ones.
Measured in Edge (`GET /cuts` and the waveform answered by the test, writes answered): background transparent, top 762 /
height 56, equal to the strip's, 2 grips; dragging one 114 px still sent `cuts [[0, 5.56]]`; no page errors.
**‖ on both ends of every split block (2026-10-30) -- asked for by the developer.** As soon as the timeline has more than
one block (a split, a reorder or an insert), each kept block shows its two handles all the time and the row-end pair goes
away; one block keeps the row-end pair. Blocks under 28 px and HOOK blocks have none. Trimming a block's start or end in
source order is the same `trimBlock`, a cut in the middle of the video. Measured in Edge (writes answered): no split 2 grips;
splits 10 / 25: 6 grips, opacity 1, at x 122, 325, 337, 646, 658, 1306; 60 px in on the middle block -> `cuts [[10, 13.076]]`,
`order []`, its start moves to 403; dragging a block from its middle still reorders (`[[13.076,25],[25,55.746],[0,10]]`),
Ctrl+Z -> `[]`; no page errors. tsc and oxlint clean. Edge only.
**‖ only on the selection (2026-10-30) -- asked for by the developer** ("when user selected timeline show || first/last"). This
replaces the always-visible handles of the note above. No handle shows until a click on the timeline selects something: one
block (no split) gets the row-end pair and now a white frame (`picked`, since `part` is null with no splits); with several
blocks, the start of the first selected and the end of the last selected. Nothing is rendered unselected, so a drag from a block's
edge reorders instead of trimming invisibly. Escape deselects. Measured in Edge (writes answered): no splits, splits 10 / 25, and a
reorder all start with 0 handles; a click gives 2 at that selection's ends (122/1306, 337/646, 444/646); dragging one 40 px sent
`[[0,2.144]]`, `[[10,12.165]]`, `[[0,2.153]]` (order kept); Escape -> 0; no page errors. tsc and oxlint clean. Edge only.
**Cuts disappear from the timeline, no red band (2026-10-30) -- asked for by the developer** (a screenshot of the hatched band
left by dragging ‖). This reverses "cuts in the middle stay red": any cut in the middle now switches the timeline to output mode, so
it shows only what Export keeps, like a head / tail trim, and the band's code is gone. The clock's total is the exported length. A
block's bounds are now splits + cut edges (`blockEdges`), so with one cut and no split each side is selectable and Delete removes
that block; with nothing dividing the video there is still no part, so Delete cannot cut it all. After a trim the selection moves
onto what remains. Over `MAX_TILES` parts one row of tiles follows export time (100 cuts: 12 images), and the waveform's gaps
became borders so it stays aligned. A cut block has no Restore on the timeline: drag a neighbour's ‖ out, Ctrl+Z, or the
transcript. Measured in Edge (writes answered): splits 10 / 25, 80 px in on the middle block: 0 bands during and after,
`cuts [[10, 14.03]]`, clock total 00:51.72, handles 353 / 595; dragged out -> `[]`, 00:55.75; undo -> the cut back; one cut 20-30 with
no split: 2 handles on the selected side, 00:45.75; 100 cuts: no page scroll, 00:35.75; no page errors. tsc and oxlint clean. Edge only.
**The transcript belongs to the timeline, step 1 of 3 (2026-10-30), planned with the developer first; option A.** Words now follow
the block order, HOOK words appear where the HOOK plays, and cut words disappear like the timeline (the Filter's "Hide deleted
words" starts on; off, they return struck through before their next kept block, and a click restores them). "Restore all" stays.
`cutList.transcriptOrder(items, parts, showCut)` gives `display`, indices into `items`, which stay in time order because
`activeIndex` binary-searches them and a selection is a time range. `Chunk` takes `indices`; flags, marks and fills are built per chunk;
search and ← → walk `display` (`stepAt` keeps the position, since a HOOK word appears twice). 7000 words / 165 parts: 22 ms, only when
parts change. Measured in Edge with mocked words (writes answered): order `[10,25],[0,10],[25,55.7]` reads w11 w16 3.00s w21 w1 w6 w26...;
cut 10-22 hides w11 w16 and the pause and w21, Filter off shows 4 struck; a hook 40-47 reads w41 w46 w1 ... w41 w46 w51; → walks 46, 1, 6
... 51 and stops at the end; clicking w6 sought to 6 s, → to 26 s; 0 writes on open; no page errors. tsc and oxlint clean. Edge only. Not done:
both copies of a HOOK word turn gold while it plays (step 2), and selecting a block does not mark its words (step 3).
**One clip list instead of four, step 1 of 4: the pipeline (2026-10-30), option A, after the developer's "Single-Track Timeline" research.**
Today's edit is `cuts` + `splits` + `order` + `inserts`, and many timeline bugs came from translating between them. The research keeps one
list of `{in, out}`: order in the list is output order, what is missing is cut, what appears twice plays twice. `--cuts` JSON now takes
`{"clips": [[in, out], ...]}` (`cuts.read_clips`, `None` for the old format, which still works); `cuts.clip_parts` clamps, drops under 0.1 s and
joins parts that continue in time, so a split adds no join or punch-in. A list that is the whole video, or empty, is refused like an empty cut list.
Tests: 3 in `tests/test_cuts.py`; 722 pass. Measured on a throwaway copy of Rhino (16:9, centre, hard, no captions): old `cuts [[0,1.072]]` + order and new
`clips [[23.707,37.228],[1.072,23.707],[37.228,55.746]]` give identical snapped keeps, so the new run reused the cached copy (its same MD5 proves nothing more),
video 54.596 s / audio 54.596 s, no black at the join; `[[40,44],[1,55.7]]` plays the hook twice, video 58.642 s / audio 58.642 s, opening on "between" with 85 words
against 70; whole and empty lists exit 2. Test project removed; source MD5 unchanged. Not done: the sidecar (2), the UI (3), behaviours from the research (4).
**One clip list, step 2 of 4: the sidecar (2026-10-30).** `edit.clips` in `project.json` (`manage.clean_clips`: `[in, out]`, at least 0.1 s, 400 otherwise; repeats and any order allowed).
`GET/PUT /projects/{name}/timeline` (not `/clips`, which is the rendered list); `POST /jobs` takes `timeline` and writes `{"clips"}` to `edit/cuts.json`; the transcript download takes `clips`.
Old projects convert **when read and are not written** (`clips_from_old`: same parts as `cuts` + `order` + `inserts`, cut at `splits`, using the transcript's duration); the file changes on the first
`write_timeline`, which replaces the old keys. `/cuts` stays until the UI moves (step 3), and a write through it replaces `clips`, so a sidecar and UI out of step never merge the two. Tests: 5 in
`test_cuts_api.py`, 1 in `test_transcript_export.py`; 728 pass. Measured through a test sidecar on port 8775 with a throwaway copy of Rhino and of its real `project.json`: `cuts [[0,0.864],[6.259,55.746]]` reads as
`clips [[0.864,6.259]]` with the file unchanged; a job with `timeline [[30,40],[40,55.7],[1,30]]`, 4:5, hard, no captions: `done` in 17.4 s, the split joined (`keeps [[30.03,55.681],[1.001,30.03]]`), video 54.680 s / audio
54.680 s, `edited: true`, saved and read back. Real `project.json` and source MD5 unchanged; test folder and database row removed; port freed. A whole-video `timeline` still reaches the pipeline, which refuses it (job `failed`), so the UI must not send one.
**One clip list, step 3 of 4: the UI (2026-10-30).** Edit Video now holds one list (`src/clipList.ts`, state `saved`, `[]` = the whole video) instead of `cuts` / `splits` / `inserts` / `order`; the undo history is lists of clips. `cuts` is derived (`holes`) for the struck words,
"Cuts N", and the Extend dialog. Every action writes the list: a word or Speech cleanup `cutRanges`, restore `restoreRange` (extends or joins neighbours), Split `splitClip`, Link `linkClips`, moving `moveClip`, ‖ `trimClip`, Add `insertCopy`. The timeline has no source mode any more (a block is a clip, the
row-end handles and `splits` gone), and the selection is clip indices, so it stays right when a time appears twice. A Delete on a block has no Restore. Two behaviours moved with it: a word delete cuts every copy of that time, and a word selection spans the transcript's shown order, so Shift across blocks cannot touch a hidden block. Drag limits are unchanged in this step
(`edgeLimit`: up to the nearest clip). The play loop walks the clips, seeking only at a real join, and punch-in counts joins (`joinNumber`), which is how `cut_filter` numbers them. A split alone is not an edit (`isEdited`), so Export sends no `timeline`. Unused `cutList.ts` functions were deleted. `/cuts` stays for the Silence dialog.
A sidecar started before step 2 has no `/timeline`, so the app must be restarted, or saved edits look gone and Export renders the plain video. Measured in Edge against a test sidecar and Vite (`/timeline` and `/words` answered by the test, every write answered, no job): open 0 PUTs and 0 handles; a click gives 122 / 1306; 80 px in -> `[[4.009,55.746]]`, 00:51.74, w1 gone; undo `[]`;
`S` -> 2 clips, 1 gap, Export sends no timeline; moving 10-25 to the end -> `[[0,10],[25,55.7],[10,25]]`, words follow, Export sends it with `full`; deleting w11 -> `[[0,11],[12,55.746]]`, restoring through the Filter -> `[]`; deleting a block + undo; a box over 2 blocks + Link -> `[[0,25],[25,55.7]]`; `[[40,44],[0.9,55.7]]`: HOOK and a chip, opens at 40 s, one jump, 6 s in clock 00:06.61 at source 3.5;
`[[0,3],[3,55.7]]` plays with no seek or backward step (biggest step 0.14 s); the download sent `clips`. `clipList` checked with 40 asserts in Node (no TS test runner). tsc, oxlint clean; 728 pass. Edge only, not the desktop window, and not a real Export from the app (the timeline job ran through the API in step 2). The project's `project.json` and source MD5 unchanged.
**Playhead on the last block -- found by the developer (2026-10-30).** "When I drag the playhead to the last timeline it stands on the first." The playhead was computed from a source time, and a source time can sit in two places: past the end, `tOf` returned the video's total, which lies in the first block when the blocks are reordered (`[[20,55.746],[0,20]]`), and a repeated time always read as its first copy. The timeline now scrubs in **export time** (`scrubAt`, `partAtOutput`), and a seek carries the clip (`seek(time, clip)`, `outPart` + `outRef`, also read by the play loop). Measured in Edge against the developer's running sidecar and Vite (`/timeline` and `/words` answered by the test, every write answered, no job): that order dragged to the end: clock 00:55.75 / 00:55.75, playhead at the right edge (1318 of 1318), source 20 s, and it stays there on release; 80 % -> 00:44.60; `[[40,44],[0.9,55.7]]` a click on the long block at source 41: playhead exactly there, plays on from it, back 5 s -> 00:40.62; a click on the last block while playing -> 00:50.31. tsc, oxlint clean. Edge only.
**Thumbnails closer to the preview when zoomed (2026-10-30) -- option A, chosen by the developer** ("drag playhead on black thumbnail but video don't show the same"). The video was right: a tile covers a span and shows the frame at its middle, so at 4x the first tile (0-1.4 s) showed 0.7 s, black, while the playhead at 0.90 s was already past Rhino's black (ends 0.79 s, checked with FFmpeg). Tiles are now `TILE_ZOOMED_PX` 50 px once zoomed (100 at 1x), at most `MAX_BLOCK_TILES` 200 per block; `loading=lazy` fetches only those near view. This narrows the gap, it does not remove it. Measured in Edge against the developer's running servers with their block order (`/timeline` answered, writes answered, no job), visible tiles loaded: 1x 12 at 90 px, already cached; 1.5x 25 in 3.0 s; 2x 4.0 s; 3x 2.6 s; 4x 24 in 2.0 s (95 in all); 6x 2.5 s; 8x 25 in 1.7 s (192 in all); no page scroll or page errors. tsc, oxlint clean. Edge only.
**The gap between blocks is 2 px, like OpusClip's (2026-10-30) -- asked for by the developer twice** ("timeline gap that split a bit big", then OpusClip's screenshot beside ours). The code still held what an earlier version of this note said was gone: a 4 px overlay and 2 px borders on the strip and waveform. Now one 2 px overlay centred on the join crosses the band and strip, the strip has no border, and the waveform is **one rounded panel**, marked at a join by two 2x6 px notches, instead of a rounded panel per block. Measured in Edge against the developer's Vite and sidecar (`GET /timeline` answered with three clips, no writes): overlays 2 px wide at x 550.4 and 872.5, centred on the joins at 551.4 and 873.5, notches at the same x, waveform 1196 px wide with radius 8 and its blocks at radius 0 with no border, no page scroll or errors.
Then "the same as OpusClip": selecting a block no longer dims the others, and the band lights the selected block (`raised-3`, bold label) over a darker `raised`, with one "Original" label per block when there is no reframe. Measured the same way, a click on the middle block: 0 of 11 tiles dimmed, the lit band at x 551.4 width 322.1 (exactly that block), label weights 500 / 700 / 500. Our colours stay the design tokens (slightly blue), not OpusClip's neutral greys.
**Drag `||` out = extend (2026-10-30) -- asked for by the developer** ("drag in to cut, drag out extend timeline"). The drag used to stop at the nearest clip (`edgeLimit`), so a freshly split block could not grow at all. It now reaches the video's start or end, and a time also held by another block **plays twice**, which the clip list already allows; the timeline gets longer. **The drag pushes rather than overlays** (developer: "don't overlay another timeline, push instead"): the block grows live and the blocks after it move, at a frozen px/s until release, when the row refits; the scroller follows the handle, and dragging a start edge out moves the earlier blocks left (`translateX`) so the handle stays with the mouse. The grown block keeps its old tiles and shows new ones on release, because each new tile is one FFmpeg run. Double-click stays a restore (`edgeLimit`: only cut time), or it would extend a split block over its neighbours. `asParts` calls a clip HOOK only when it lies wholly inside another, so a partial overlap is not gold. The grips are inset 6.5 px by a 20 px handle, and the drag counts from where it was pressed: before, the edge jumped to the mouse on the first move (a 60 px drag gave 50 px).
**Zoom out past Fit, like OpusClip (2026-10-31) -- asked for by the developer** ("Zoom in/out why different"; chose to open on Fit). Our smallest zoom was Fit, so a 55 s video filled the row at ~27 px/s, where OpusClip's screenshot shows it at ~2.5 px/s with an empty timeline beyond. `ZOOMS` now starts at 0.1 / 0.25 / 0.5 (relative to Fit, so a long video also gets smaller, not one fixed px/s); the ruler continues past the video, the band, strip and waveform are only as wide as the blocks, and the right `+` sits 12 px after the last block when it fits (its old place stays reserved, so the view's width never changes). Opening and the Fit button still give 1x. Measured in Edge against the developer's Vite and sidecar (`/timeline` answered, writes answered, no job), Rhino at 1440x900, view 1216 px: Fit 1196 px of blocks, 0.5x 598, 0.25x 299, 0.1x 120 with Zoom out disabled, no scroll or page scroll, timeline 343 px at every zoom; at 0.1x a click on the block sought to 00:27.97 with 2 handles, a click past it gave 00:55.75 and deselected, a 30 px trim sent `[[0,41.8]]`; Fit and 1.5x as before; 1100x700 with three clips 86 px; no page errors. tsc and oxlint clean. Edge only. The ruler prints `5:00` where OpusClip prints plain seconds (`100`, `200`).
**A fixed timeline scale (2026-10-31) -- asked for by the developer** ("timeline fix, changes with zoom"; this is our reading of that message). px/s used to be the row width over the edited length, so every trim or extend rescaled all the blocks on release. It is now `width x zoom / scaleSeconds`, where `scaleSeconds` is the video's length until the Fit button sets it to the current edited length; only zoom, Fit and the window's width change it. Fit lights only while the edit really fills the row. A project opened with saved edits therefore starts on the whole video's scale, not filling the row, until Fit is pressed. Measured in Edge against the developer's Vite and sidecar (`/timeline` answered with three clips, writes answered, no job): trimming the middle block's end 80 px moved only the next split (872.9 -> 792.9), first split and ruler marks unchanged, `[20, 31.271]`, Fit off; Fit -> splits 582.3 / 841.6, Fit on; extending 80 px moved the next split 841.6 -> 921.6 and stayed there on release with a scrollbar, `[20, 34.747]`; undo back to 841.6. No page errors; tsc and oxlint clean. Edge only.
**No focus ring on the timeline track (2026-10-31) -- asked for by the developer** ("what are the yellow marks on both sides"). They were the track's `focusRing`, clipped by the scroller to its left and right edges, shown after any key press and read as markers once zoom out left empty space. The track now has `outline-none`; keyboard users see the playhead and clock move instead.
**`||` limits show in the cursor (2026-10-31) -- asked for by the developer** (at the shortest length a handle cannot shrink, at the video's start or end it cannot extend). The drag already stopped at both limits; two things were missing. The handle's cursor now shows the direction left: `ew-resize` both ways, `e-resize` / `w-resize` one way, `not-allowed` for neither. And Snap could pull an edge under the 0.5 s minimum after release, so `onTrimBlock` keeps the exact dragged time when the snapped one would be too short (that case was not reproduced in a test, the words did not produce it). Measured in Edge against the developer's Vite and sidecar (`/timeline` answered, writes answered, no job): whole video, start cursor `e-resize` and end `w-resize`, start 80 px left and end 80 px right stay put with 0 PUTs, start 80 px right -> `[3.729, 55.746]`; `[10, 14]` end dragged 900 px left with Snap off stops at `[10, 10.5]`, cursors then start `w-resize` / end `e-resize`, another 60 px left changes nothing, 60 px right -> `[10, 11.432]`. No page errors; tsc and oxlint clean. Edge only.
**`||` extends only into cut time (2026-10-31) -- chosen by the developer** ("I already deleted timeline, why not use the rule"). This reverses "a time also held by another block plays twice" in the extend note above; the live push stays. Dragging out now stops at the nearest clip in **source time** (`edgeLimit`), else at the video's start or end, so a drag never repeats a part. A plain split has nothing cut beside it, so it only trims inward; to play a part twice use + Extend a clip. An edge already inside another clip (a HOOK, an old overlap) cannot extend either, and under 0.05 s of room counts as the limit. Snap keeps the exact time when it would pass the limit (not reproduced in a test). Measured in Edge against the developer's Vite and sidecar (`/timeline` answered, writes answered, no job) on Rhino: Delete on the middle of `[[0,20],[20,35],[35,55.746]]`; first block's end 900 px out stops at `[0,35]`, 00:55.75, cursor `w-resize`, 60 px more no PUT, 80 px in `[0,31.271]`; after undo the last block's end 80 px out no PUT, its start 900 px out stops at `[20,55.746]`; `[[0,20],[20,55.7]]` end out no PUT, cursors `e-resize` / `w-resize`, and 55.7 of 55.746 reads `w-resize`; reordered `[[35,55.746],[0,20]]` end out `[0,35]`. No page errors; tsc and oxlint clean. Edge only.
**No chip for an added section (2026-10-31) -- asked for by the developer** (screenshots: the gold "+ 0:20.1-0:28.9 -> start (hook) ✕ · Exported video 1:04.6" row against plain words). The row above the transcript is gone, with its seek button, ✕ and length line; the added section's words simply appear where they play (`transcriptOrder` already did that). The timeline keeps its gold HOOK block, Delete on it removes the section, and the clock shows the exported length. Measured in Edge against the developer's Vite and sidecar (`/timeline` answered with `[[40,44],[0,55.746]]`, writes answered, no job): 0 chips, 0 length lines, the transcript opens "between the black and the white..." then "On John...", 1 HOOK; Delete on the block -> `clips []`, 0 HOOK, the transcript opens "On John..."; Ctrl+Z brings it back. No page errors; tsc and oxlint clean. Seen, not fixed: with that list the clock opened at 00:04.00 (the start of the long block), not 00:00.00. Edge only.
**One highlight for a word that appears twice (2026-10-31) -- found by the developer** (a screenshot with "this," gold in both copies). A HOOK's words sit twice in `display` with one `items` index, and the gold followed the index. It now follows a **position** in `display`: `cutList.displayPosition` picks the copy in the part being played (`shownPart`), `partOfPosition` goes back, each transcript element has `data-pos` beside `data-at`, and following the spoken word scrolls by position. A click or ← → on a copy seeks with that copy's clip, so the clock lands on it. Measured in Edge against the developer's Vite and sidecar (`/timeline` answered with `[[40,44],[0,55.746]]`, writes answered, no job): "between" at positions 0 and 49; a click on each, after Escape, reads 00:00.14 and 00:44.14 at source 40.14 with gold only on that copy; 6 s of playback across the join, sampled every 150 ms: never more than 1 gold word, positions 0 ... 14, then 15 on "On". No page errors; tsc and oxlint clean. Still twice by design: a selected word's blue, since Delete cuts every copy of that time, and search hits. Edge only.
**Whole Edit Video test (2026-10-31) -- asked for by the developer.** 728 Python tests, tsc, oxlint and a production build pass. In Edge against a test sidecar + Vite on throwaway copies of Rhino (real writes, no change to the real project; the transcript download answered by the test): 102 checks pass (transcript, search, Filter, word delete, split, Link, block delete, undo / redo, zoom, Fit, Hide, Snap, volume, transport, ruler scrub, trim, reorder, reopen, playback across joins, Space, aspects, Layout, Crop, Background, Tracker, CC, Captions, Motion, Speech cleanup, Extend, 1100x700, keys in the search box, all words deleted), no page errors or failed requests. Real exports from the UI, each job `done`, audio within 12 ms of video: `[[0,23.305],[41.8,55.746]]` 16:9 37.12 s; hook + reorder 9:16 Impact + motion 23.94 s (frames show the right order and captions); Transform 0.8 + crop on colour 4:5, no captions, 346/432 wide as sent; Speech cleanup 6 clips 26.82 s. Rendered lengths run up to 0.13 s under the list where it reaches the source's end, whose picture is shorter than its sound. A never-seen copy transcribed through the app in 39.7 s with one job, words and waveform arriving by themselves: the first time batched Whisper ran through the app.
Open, none fixed: (1) **`PUT /timeline` with `clips: []` loses `transition`**: it answers `hard`, the next `GET` answers `punch`, so Hard cut chosen before any edit reverts on reopen. (2) At 1100x700 the transcript shows about one line. (3) The preview draws the source's cue at a hook's start ("THAT'S THE DIFFERENCE") where the render opens on "between the black". (4) The layout band still shows the last reframe's shots under Layout: Custom. (5) A pause chip keeps the whole pause's length (26.62 s) inside a 10 s block. (6) The finish toast stays Khmer in English. Undo still covers only the clip list. The clock at 00:04.00 noted above did not come back once the test waited for the video's metadata (00:00.00). Not covered: the desktop window, a long video (no long project on disk), audible lip sync, the real Export folder copy.

**Add transition between timeline blocks (2026-10-31) -- asked for by the developer.** Hovering a join between two blocks shows a round icon on the frame strip and a tooltip "Add transition" (no native delay); a click moves the playhead to that join and opens a new **Transition** aside (`TransitionPanel` in `MotionPanel.tsx`, with a close button), one aside at a time as before. Motion keeps the same control and value. There is still **one transition for the whole video** (`--transition`): the button opens the setting, it does not add a transition at that join alone, and the panel says how many joins it applies to (`joinNumber`, real joins only). A join between blocks that continue in time (Split only) has no transition, because the pipeline joins them back, so the panel warns about that. Blocks under `JOIN_MIN_PX` 28 px have no button, and the buttons hide while a block or edge is dragged. Measured in Edge against a test sidecar and Vite (`/timeline` answered by the test, every write answered, no job) with clips `[0,10] [20,30] [30,55.7]`: 2 buttons, hidden until hover; a click read clock 00:10.00, source 20 s, playhead on the join to the pixel, 0 PUTs; the second join warned; Hard cut saved `transition: hard` and Motion read Hard cut; a block drag and the ‖ beside a join still work; focus + Enter works; 1 block has no button; no page scroll at 1100x700; Khmer tooltip; no page errors. tsc and oxlint clean. Edge only, not the desktop window; no real Export run for this step.

**Seven tools in Edit Video's right column (2026-10-31) -- asked for by the developer with OpusClip's icons.** Under Captions and Motion: AI enhance, Brand template, B-roll (already there as text glyphs, now line icons, still disabled "Phase 3"), and new Text, Graphics, Audio and Voiceover hook, disabled "Not built yet", because nothing in the pipeline backs them and the roadmap does not name them. The red dots in the screenshots are OpusClip's "new" badges and are left out. Nine buttons need 690 px, so the column scrolls by itself (`overflow-y-auto`, `shrink-0` on the buttons). Measured in Edge (`/timeline` answered by the test, no writes): 1440x900 column 496 px, so Graphics, Audio and Voiceover hook need a scroll; 1100x700 column 296 px, Voiceover hook reachable; no page scroll at either, preview unchanged at 668x376, Motion still opens; no page errors. tsc and oxlint clean. Edge only.
**Transitions button in the right column (2026-10-31) -- asked for by the developer with OpusClip's icon.** Under Motion, enabled: it opens and closes the same `TransitionPanel` as a timeline join's Add transition, lights while that panel is open (also when a join opened it), and clears a join's "continue in time" warning, since it comes from no particular join. Ten buttons need 760 px, so the column scrolls more. Measured in Edge against the developer's running app, whose sidecar and Vite held the ports (`/timeline` answered by the test, 0 writes, no job): opens, lit; second click closes; a split-only join warns and lights it; the tool clears the warning; Motion swaps it out; Close unlights; no page scroll at 1100x700; no page errors. tsc and oxlint clean. Edge only.
**Edit Video opens through a start dialog (2026-10-31) -- asked for by the developer with OpusClip's "Enhanced Editor experience" screenshots.** `screens/EditorStartDialog.tsx`: the card opens a real-frame illustration and the shared `Source` picker; a chosen video with a transcript opens the editor at once, otherwise the same dialog shows the blurred frame, the real transcribe % and "keep this window open", and opens the editor by itself when the `--transcribe-only` job is done. Close, Escape or a click outside while it runs ask "Stop transcribing?" first; Stop cancels the job. A failed start shows the reason and Try again, another video's job shows a wait line, and a drop while the dialog is open goes into it instead of opening Long to Short on top. The editor's own auto-transcribe stays as a fallback. Left out of the screenshots: Google Drive, a link field (nothing is downloaded), the 120-minute limit (none exists) and the logo sticker (Phase 3). `Source`'s own strings are still Khmer in English. Measured in Edge: a video with a transcript -> editor, 0 jobs; 409 -> the reason, Escape closes; a real 30 s copy -> 1 job, editor by itself at 54.9 s with 31 words and the waveform; a real 35-min copy read 0 % for 51 s (audio + model load), then 1, 6, 10, 15, 19 % by 73 s, Escape asked, Stop -> job `cancelled`. Throwaway projects went to the Recycle Bin with their database rows; sources unchanged. A real OLE drop into the dialog was not run. tsc and oxlint clean. Edge only.
**A project opened in Edit Video and not exported reopens there (2026-10-31) -- chosen by the developer.** It has a transcript but nothing rendered, so the card used to open Long to Short. `openProject` now goes clips -> Review, a reframe or export -> whole-video Review, then a `done` job with a transcript (`seconds`) and a known video -> the editor, with saved edits. An interrupted or failed job still opens the dialog, because that is how a clips job restarts, so a failed Export of an edit also lands there; the card's ⋯ menu has **Edit Video** for any project with a transcript and a known video. Measured in Edge against the developer's running sidecar and Vite with `/projects` answered by the test on Rhino's real files, every non-GET answered by the test: done + transcript -> editor; interrupted -> dialog; no transcript -> dialog; no video path -> the card is disabled; the menu item -> editor on an interrupted project. tsc and oxlint clean. Edge only.
**Edit Video's transcribe % moves from the start (2026-10-31) -- found by the developer** ("0% not real time"). Whisper reports nothing until its first batch ends: 0 % for 51 s on a 35-min video, and 0 -> 100 on a short one, whose chunks fit one batch. `eta.transcribePercent`: before the first report the % comes from a clock, labelled estimated and capped at 95 % of `TRANSCRIBE_START_SEC` 50 s; after it, start + real fraction x Whisper's estimated time, so it never falls back. Measured with real transcribes of throwaway copies through the developer's running sidecar, % read every 0.4 s, never going down: 30 s video 5 % at 4 s ... 65 % at 35 s, then 100 % and the editor at 36.7 s (still a jump, one batch); 35-min video 3 % at 7 s, 24 % at 47 s, 31 % at 59 s with the real fraction, 59 % at 105 s, then Stop. Copies recycled; sources unchanged. tsc and oxlint clean. Edge only.
**A project with nothing exported opens on Review (2026-10-31) -- asked for by the developer, replacing the editor from the note above.** A `done` job with a transcript and a known video now opens view `source`, the Review page inside the sidebar with one item: the source video (`/source`) and its transcript as timed paragraphs from `/words` (`ReviewMedia.cues`, since there is no `.vtt`), and an **Edit Video** button instead of Export, because nothing is rendered. No score, rating or select. The ⋯ menu's Edit Video still goes straight to the editor, and the start dialog still opens the editor after transcribing. No sidecar change. Measured in Edge against the developer's running sidecar and Vite, `/projects` answered by the test on Rhino's real transcript, every non-GET answered, no job: 3 paragraphs, a click sought to 12.13 s, the video reads from `/source`, no Export; the transcript is not asked again while the page sits; Edit Video -> editor. tsc and oxlint clean. Edge only.
**Edit clip on Review (2026-10-31) -- asked for by the developer with a screenshot.** A project card opens the same Review page as Long to Short, and each clip's detail now has **Edit clip** under Export and កែ Subtitles (`ReviewScreen.onEditClip`, also on whole-video results; the source view's button has the same name), which opens the editor. The editor still works on the **whole source video**, not only that clip, and an export from it lands in `full_edit*`, reached through ⋯ លទ្ធផល Reframe when the project has clips. A project with no known video path has no button. Measured in Edge against the developer's running sidecar and Vite (non-GET answered by the test, no job): see the run for this note; Rhino Review shows Export + Subtitles + Edit clip and it opens the editor; How-AI-agents (nothing rendered) shows Edit clip, no Export, and opens the editor. Edge only.
**Review's side buttons after OpusClip (2026-10-31) -- asked for by the developer with a screenshot.** `ClipDetail`'s column is now Download HD (the old Export MP4 + SRT, disabled on the source view, where nothing is rendered), Upscale & download (disabled), Edit clip, កែ Subtitles / មើល shots where they apply, AI tools (disabled, Phase 3), the file's real aspect (from the video's metadata, disabled: changing it means a new render) and Duplicate (disabled). Disabled buttons give their reason as a tooltip. Download HD copies the file already rendered at its own size. Measured in Edge against the developer's running sidecar and Vite: see the labels on How-AI-agents (source) and Rhino (clip), no writes, no job, no page errors. tsc and oxlint clean. Edge only.
**Review's aspect and AI tools menus (2026-10-31) -- asked for by the developer with OpusClip's screenshots.** Hovering the aspect button shows "Adjust the aspect ratio of your clip"; a click opens 9:16 / 1:1 / 16:9 / 4:5 with a tick on the file's real aspect. Choosing another one opens the **editor at that aspect** (`EditorStart`, `initialAspect`), where Export renders it: Review reads only `clips/`, so a re-render into `clips_1x1/` would never show there, and the editor works on the whole source video, not only that clip. AI tools opens on hover with OpusClip's six items: **Auto zoom** opens the editor on the Motion panel (camera and keyword zoom are not switched on by it); Add B-roll, Enhance speech, Video dubbing, AI viral hook and Eye contact correction are disabled with a reason, without the crown / credit marks. Both menus open to the left, because the column sits at the window's right edge. Measured in Edge against the developer's running sidecar and Vite (non-GET answered by the test, no job): every step above, the same aspect stays on Review, a plain Edit clip keeps no leftover aspect or panel, the hover survives crossing to the menu, Escape closes, no horizontal scroll at 1100x700 and the menu inside the window. tsc and oxlint clean. Edge only.
**Review's aspect button renders in place (2026-10-31) -- asked for by the developer with OpusClip's screenshots, replacing "opens the editor" from the note above for clips.** Choosing a size a clip does not have yet starts one job for that clip only: `make_clips --only-clip N --aspect ...` renders into a temporary `.only_NN` folder and moves `clip_01.*` to `clip_NN.*` in `clips_1x1/` etc., because the pipeline numbers from 1; it exits 2 without a ranking, so it can never reach Whisper or the LLM. While it runs the player is a black box with a countdown (`App.startAspect`, an estimate of 14 s + 0.45 x the clip's length, from one measurement), the aspect button spins and Download HD is off; when it ends the video switches by itself. A size already rendered switches at once with no job. `clips_of_project` lists `aspects` per clip (a file older than `clips.json` is ignored, since clip N may be another clip now), and `/file`, `/thumb` and `POST /export` take `aspect`. Whole-video and source Reviews still open the editor at that size. The size shown is not remembered: reopening starts on 9:16, grid thumbnails stay 9:16, and កែ Subtitles still works on the 9:16 file. Style: the job uses the current default caption style, not the style that clip was rendered with, which the pipeline does not record. Tests: `tests/test_clip_aspects.py` (4); 732 pass. Measured in Edge against a test sidecar + Vite on ports 8775 / 5199 on a throwaway copy of Rhino, one real render of its 42 s clip: "33s left", switched at 33.5 s, 1080x1080 42.08 s with sidecars, `clips/` still 1080x1920; Download HD sent `aspect 1:1` (answered by the test, so no real copy); back to 9:16 and to 1:1 at once with no job. The developer's running sidecar needs a restart. Copy recycled; sources and Rhino's `clips.json` unchanged. Edge only.
**Review card follows the clip's size (2026-10-31) -- asked for by the developer with OpusClip's four screenshots.** 9:16, 1:1 and 4:5 keep the video beside the text (`boxStyle`: at most 462 tall and 440 wide); 16:9 puts it full width above the text, which scrolls in 320 px (`isStacked`). This also covers the render countdown, whole-video results, and the source view, whose 16:9 video is no longer cropped into a portrait box. Measured in Edge against the developer's running sidecar and Vite on a throwaway copy of Rhino with all sizes rendered through `--only-clip`: box ratios 0.5625, 1, 0.8 beside the text, 1.778 above it; 1100x700 no horizontal scroll; How-AI-agents' source 908x511 above the text; no jobs, no page errors. tsc and oxlint clean. Copy recycled; sources unchanged. Edge only.
**Review's video boxes made smaller (2026-10-31) -- asked for by the developer** ("box so big"). `boxStyle`: 4:5 340x425 (was 370x462), 1:1 380x380 (was 440x440), 9:16 unchanged at 260x462; a 16:9 card is at most 640 wide (video 640x360, was 860x484) with its text capped at 260 px. Our reading of the request: the message named no size. Measured in Edge against the developer's running sidecar and Vite; 1:1, 4:5 and 16:9 sizes were faked through `/clips`, so only the boxes were checked, not those files. Edge only.
**16:9 card width from OpusClip's screenshot (2026-10-31) -- asked for by the developer** ("help calculate"). Read off the 1852 px wide screenshot by eye: video 758x427 (ratio 1.775), 11 px to the buttons. A 16:9 card is now at most 760 wide, not 640. If the screenshot was not taken at 100 % display scale, these numbers scale with it. Other sizes unchanged.
**Duplicate on Review (2026-10-31) -- asked for by the developer** ("click duplicate to copy entire box"). `POST /projects/{name}/clips/{index}/duplicate` (`clips.duplicate_clip`, no render, no job; 409 while a job runs) copies every `clip_NN*` file in `clips/` and each `clips_<size>/` to the next free number, and inserts the clip in `clips.json` titled "... (Copy)" right after the last rendered clip, since the ranked clips past `--max-clips` have no files to rename. `clips.json` keeps its mtime, or every clean copy and size would read as older than the AI's pick and vanish. Clips only: whole-video and source Reviews keep the button disabled. Ratings are keyed by time range, so a copy shares its original's ♡ / 👎. Tests: `tests/test_duplicate_clip.py` (5); 737 pass. Measured in Edge against a test sidecar + Vite on a throwaway copy of Rhino: one box became a grid of 2, the copy with mp4 + 3 sizes, the original keeping its sizes, no job; the copy was not opened and played in the test. Copy recycled; source unchanged. tsc and oxlint clean. Edge only.
**Review card one step smaller and centred (2026-10-31) -- asked for by the developer** ("បង្រួម box 1x and align center"; "one step" is our reading, about 10 %, 16:9 from 760 to 680). 9:16 234x416, 4:5 306x383, 1:1 342x342, side-by-side card at most 780 wide, 16:9 card at most 680; the row (rating buttons, card, side buttons) is centred. Measured in Edge against the developer's running sidecar and Vite, with 1:1, 4:5 and 16:9 faked through `/clips` so only the boxes were checked. tsc and oxlint clean. Edge only.
**Review rows line up (2026-10-31) -- asked for by the developer with a screenshot.** A 16:9 card was narrower than the others (680 against 780 px), so centred rows did not share edges. Every card is now 680 px wide; the 16:9 video stays 678x381 and the text column beside a portrait video is narrower. "Don't change to grid view when adjusting the aspect" was **not reproduced**: a real render on a throwaway project stayed in the list and in the grid's dialog (same DOM node), and a mocked job likewise. One flash was fixed on the way: when a render ended the box showed 9:16 until the new clip list arrived, so `App` keeps the countdown until it does. Measured in Edge against the developer's running sidecar and Vite: 9:16, 1:1, 4:5, 16:9 rows at 1440 all read rate 365, card 429-1109, buttons 1125-1315; a real 4:5 render of clip 2 went countdown -> 306x382 in 28.4 s with no 9:16 frame in 30 ms polling; no horizontal scroll at 1100x700; no page errors. The size shown is still forgotten when the dialog closes or the view switches. Throwaway project sent to the Recycle Bin through the API. Edge only.
**Review's grid shows each clip at its real size (2026-10-31) -- asked for by the developer with OpusClip's screenshot.** Each grid cell is a square with the thumbnail centred inside it, its long side filling the square (9:16 150x268, 16:9 268x150, 1:1 268x268 at 1440). The score sits at the square's top right where the screenshot has "Edited", which we have no meaning for; the rating moved to top left and the select checkbox to bottom left. The third small button is Edit clip (scissors), and it opens the editor on the whole source video as before. The size chosen for a clip now lives in `ReviewChoices.sizes` (in `App`), so the grid, the list and the dialog share it and it survives closing the dialog or visiting Subtitles; it is still forgotten when the app restarts. The card's download sends that size. A size is shown only once its file exists, so a failed render stays on the old size. Whole-video grids take the ratio from the loaded thumbnail. Measured in Edge against the developer's running sidecar and Vite on Rhino's real 16:9 and 1:1 files (non-GET answered by the test, no job): sizes above, each centred; card 1 at 16:9 sent `aspect 16:9` on export; no horizontal scroll at 1100x700; no page errors. tsc and oxlint clean. Edge only.
**Hover menu on the grid's scissors (2026-10-31) -- asked for by the developer with OpusClip's screenshot.** Hovering a grid card's scissors opens Edit clip plus the six AI tools (`EditClipMenu`, sharing `aiRows` / `AiRowButton` with the side AI tools menu); a click on the scissors still opens the editor. Only Edit clip and Auto zoom run; the other five stay disabled with a reason, without the crown / credit marks, since the app has no billing. The menu is `position: fixed`, placed from the button, because the grid's scroller would clip it in the last row or column; it opens to the right, or to the left when it does not fit, and stays in the window. Keyboard users have no way to this menu; a card's dialog has the same tools. Measured in Edge against the developer's running sidecar and Vite with 8 cards faked through `/clips` (non-GET answered by the test, no job): 7 items, 2 enabled; crossing from the button keeps it open, leaving closes it; card 1 opens right, the last column left, the last row ends at y 858 of 900; Auto zoom opens the editor on Motion, Edit clip and a click open the editor; no horizontal scroll at 1100x700; no page errors. tsc and oxlint clean. Edge only.
**A duplicate keeps the size on screen (2026-10-31) -- found by the developer** ("I click duplicate 16:9, result shows 9:16"). The files were right: `duplicate_clip` copies every size. The chosen size is kept per clip number in `ReviewChoices.sizes`, and the new number had none, so the copy showed 9:16. The UI now copies the original's size to the new number. Measured in Edge against the developer's running sidecar and Vite with the duplicate POST answered by the test, using Rhino's real clips 1 and 2 (so no real duplicate ran). tsc and oxlint clean. Edge only.
**Review's breadcrumb after OpusClip (2026-10-31) -- asked for by the developer with a screenshot.** The crumb reads "My projects / Rhino Charge Ivan Carter.mp4": no ‹, the first part translated, and the video's file name (`ReviewScreen.fileName`, from `chosen.name`) instead of the folder name, falling back to the project name. Clicking the first part returns to the gallery, as it already did.
**Download menu on the grid's cards (2026-10-31) -- asked for by the developer with OpusClip's screenshot.** A click on a card's download icon no longer exports at once: it opens `DownloadMenu` with Download HD (the same MP4 + SRT copy, at the size shown) and Upscale & download, disabled "Not built yet", without the credit mark. Position `fixed`, under the button, above it when it does not fit, kept inside the window. Measured in Edge against the developer's running sidecar and Vite with 8 cards faked through `/clips` (non-GET answered by the test, so no real copy, no job): hover opens nothing, a click opens 2 items with 1 enabled and sends nothing; a second click, Escape and an outside click close it; the last column stays inside the window, the last row opens upward; Download HD sent clip 8 with `mp4, srt`. No page errors. tsc and oxlint clean. Edge only.
**Long to Short settings became a page (2026-11-01), import fixed after an error found by the developer.** `screens/ClipSettingsDialog.tsx` had been deleted and replaced by `screens/ClipSettingsPage.tsx` (the file says the developer decided this), while `App.tsx` still imported the old file, so Vite showed "Failed to resolve import". `App` now imports the page and `shell` shows it in place of the content, with the sidebar kept; `navigate` and the toast's View leave it. `settingsOpen` keeps its name. Measured in Edge against the developer's running sidecar and Vite (non-GET answered by the test, no real job): no overlay, the card opens the page with no dialog and the sidebar present, a sample moves to step 2, Start at y 836-884 of 900 sent `max_clips 5` and closed the page; the sidebar and the back button leave it; no horizontal scroll at 1440; no page errors. tsc and oxlint clean. Edge only.
**Long to Short: pick in a dialog, settings on the page (2026-11-01) -- asked for by the developer.** The card opens `screens/ClipPickDialog.tsx` (illustration + the shared `Source`); once a video is chosen the dialog closes and `ClipSettingsPage` shows its thumbnail and settings in the main content, with the sidebar kept. The page now always has a video, so step 1 left it. "Change video" clears the video and reopens the dialog over the page behind (Home or My projects), so closing it there returns to that page, not to the settings. A real fix on the way: `connect()` never cleared its "waiting for the sidecar" message after connecting, so it stayed on screen in red (the developer's screenshot); it is cleared on success now. Measured in Edge against the developer's running sidecar and Vite with the first 3 `/health` calls failed and non-GET answered by the test (no real job): the card opens the dialog with no page and no stale message, Escape closes it, a sample or a typed path leads to the page with a real frame, Start sent `max_clips 5` and left the page; dialog 640x608 at 1100x700, no horizontal scroll; no page errors. tsc and oxlint clean. Edge only. `shot.mjs` looks for step 1 inside `[data-settings-page]` and needs updating.
**Change video opens the file dialog at once (2026-11-03) -- asked for by the developer.** It used to clear the video and reopen the pick dialog. Now `App.changeVideo` calls `pickVideo`: Cancel keeps the current video, a picked file replaces it, and a plain browser, which has no such dialog, still gets the pick dialog. The page is keyed on the video's path, so a timeframe from the old video cannot carry over. Measured in Edge against the developer's running Vite and sidecar with the Tauri dialog mocked (non-GET answered by the test): Cancel left How-AI-agents 35:25 with no pick dialog; a picked Rhino read 0:55; the browser fallback showed the pick dialog. The one page error came from the mock, which lacks Tauri's event internals. tsc and oxlint clean. The real Windows dialog in the desktop window was not driven.
**Choose aspect ratio on Long to Short works for all four sizes (2026-11-03) -- asked for by the developer; our design.** Review, Subtitles and Duplicate all need the 9:16 file in `clips/`, so a job with another size renders **twice**: `JobRequest.also_aspect` makes `JobRunner` run the same command again with `--aspect <size>`, which reuses the AI's pick and writes `clips_<size>/`. A failed first render stops the second, and the render fraction counts each pass as half. Review opens on that size (`ReviewChoices.defaultSize`), and the footer's Export sends it. Tests: `tests/test_also_aspect.py` (3); 770 pass. One real run from the page in Edge, on a throwaway copy of `Table For Four` through a test sidecar + Vite, with warm caches: all four rows enabled, body `also_aspect 1:1, max_clips 5`, done in 91 s; `clips/` 1080x1920 and `clips_1x1/` 1080x1080 for all 5; Review showed 268x268 thumbnails from the 1:1 files and the video played at 1080x1080; no page errors. Seen, not fixed: the card's % falls by a few points at times, e.g. 30 -> 22 -> 37. "Find more clips" still renders 9:16 only, so the footer's Export would skip those clips at the other size. The page's Estimated time does not count the second render. The size is forgotten when the app restarts. The running sidecar ignores `also_aspect` until restarted. Copy recycled, sources and real clips unchanged. Edge only.
