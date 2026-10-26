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
