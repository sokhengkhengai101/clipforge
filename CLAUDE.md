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
├─ ui/                  # Phase 1 React UI (Vite + Tailwind), node_modules git-ignored
├─ tests/
└─ output/              # git-ignored
```

## Phase 1 (started 2026-10-18)

Tauri 2 (Rust) + React/TypeScript + Tailwind + shadcn/ui over a Python sidecar. This machine
already has Node 24.13 and Rust 1.99, so nothing large needs installing; FastAPI and uvicorn do.

Order: **1A sidecar** and **1B SQLite** (done) -> 1C React in a browser (started) -> 1D wrap in Tauri -> 1E Figma
styling. The UI is built against the sidecar in a plain browser first, so there is no Rust rebuild
loop while the screens take shape.

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

## Later phases (context only — do not build yet)

- Phase 2: MediaPipe face tracking reframe, bilingual EN + Khmer subtitles, interview Q&A finder, long video → 10 clips.
- Phase 3: gaming audio signals, brand kits, batch queue, installer.
- Presets are JSON configs over the same engines (e.g. `presets/podcast.json`).

## Design references

- Figma UI: https://www.figma.com/design/SycDviWBBpHlK901HhvFWK (8 screens, components, Dark/Light color variables)
- Tokens: bg/app #0F1115, bg/panel #171A21, bg/card #232733, accent #7C5CFF, caption keyword #FFD23F. Fonts: Inter (UI), Kantumruy Pro (Khmer UI), Montserrat ExtraBold + Battambang Bold (captions).

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
  Captions move to the seam between the last two panels for any multi-panel layout
  (`caption_margin_for`), which is the only band that covers nobody's face.
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
  (default #FFD23F from the design tokens; OpusClip uses green)
- Encoder: `--encoder auto|nvenc|x264` (default auto: NVENC when the GPU accepts it).
  Measured on a 17.5s clip at 1080x1920, VMAF against lossless: libx264 medium 12.6s/6.7MB/97.96,
  h264_nvenc p5 cq26 2.9s/7.0MB/98.02. Rendering five clips went from 1m25s to 19s.
- Full video: `--full` renders the whole video as one vertical file into `output/<name>/full/`,
  skipping highlight selection. It does not write `clips.json` -- it used to, and the next ordinary
  run then read that cache and rendered the whole video as "clip 1". Measured on the 47-min
  interview: 360 shots, 17,209 caption cues, 15m30s total (4.5 min planning, 10m17s render), 959MB.
- Review output: `python review.py <video name> --frames`
- Test: `pytest -q`
