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
4. `boundaries.py` — snap start/end to nearest sentence boundary, add 0.3 s padding, keep 15–90 s
5. `captions.py` — build `.ass` subtitle file per clip (≤ 2 lines, ≤ 32 chars/line, keyword highlight in #FFD23F)
6. `render.py` — FFmpeg: trim → center-crop 9:16 → scale 1080×1920 → burn ASS → H.264 MP4

Out of scope for Phase 0: face tracking, diarization, Khmer translation, UI, batch.

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
- Test: `pytest -q`
