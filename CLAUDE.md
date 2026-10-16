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
5. `captions.py` — build `.ass` subtitle file per clip (≤ 2 lines, ≤ 32 chars/line, keyword highlight in #FFD23F)
6. `render.py` — FFmpeg: trim → center-crop 9:16 → scale 1080×1920 → burn ASS → H.264 MP4

All six steps are implemented and run end to end. Measured on a 35-min 640×360 podcast:
audio 6 s, transcribe 8 min (GPU), highlights 8 min 33 s (7b), boundaries and captions under a
second, render 39 s for five clips. Re-running with every cache warm takes about 40 s.

Known limits to judge clips against:
- Center-crop assumes a talking head. On screen-share footage it cuts the slide in half, and a
  640×360 source upscaled to 1080×1920 is visibly soft. Use a 1080p source for clips worth posting.
- `--redo <step>` re-runs one step (audio, transcribe, highlights, render, or all); `--force` is
  the same as `--redo all`.
- `.ass` and `.mp4` for a clip must share a folder: render runs FFmpeg with `cwd` set to that
  folder so the `ass=` filter never sees a Windows path (`:` and `\` are filtergraph syntax).
- `SCENE_THRESHOLD = 0.3` misses real cuts. At 33.78-40.46s of the 47-min interview it reports no
  cut, while 0.2 finds three (34.33, 35.91, 39.29) that match what the frames show. A montage then
  lands in one "shot" and gets one crop box. Moving crop hides most of it; lowering the threshold
  is untested and would change every clip, so it is a separate step.

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

## Project layout

```
clipforge/
├─ CLAUDE.md
├─ make_clips.py        # CLI entry (typer)
├─ config.py            # defaults: clip length, max clips, model names, device auto-detect
├─ check_env.py         # doctor script: Python/FFmpeg/GPU/Ollama check
├─ pipeline/            # audio, transcribe, highlights, boundaries, captions, render, llm
├─ prompts/             # podcast_highlights.md (LLM prompt, versioned)
├─ tests/
└─ output/              # git-ignored
```

## Later phases (context only — do not build yet)

- Phase 1 (MVP): Tauri 2 (Rust) + React/TypeScript + Tailwind + shadcn/ui; the Phase 0 pipeline becomes a Python sidecar (FastAPI on 127.0.0.1) with progress over WebSocket; SQLite for projects/clips/jobs.
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
- Layout: `--layout auto|center|split` (default auto: split on two-shots, face crop on close-ups,
  centre crop when no face is found). On a close-up where the face moves more than 8% of the frame
  width across the shot's sample frames, the crop follows it: `reframe` samples the shot every 1 s
  (40 points max), smooths the path (moving average + 2% deadzone) and emits one FFmpeg
  `crop=...:x='if(lt(t,..),..)'` expression, so FFmpeg recomputes x every frame. Measured on the
  shot at 33.78-40.46s of the 47-min interview: a static box left the face jammed against the frame
  edge in 12 of 26 sampled frames, the moving box keeps it at x=200-670 of 1080. It costs one frame
  grab per second of moving shot (five clips: 40s -> 54s with warm caches), and only 2 of 44
  segments in those five clips move enough to trigger it.
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
