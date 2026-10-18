# Khmer Clip Studio: UI handoff for Claude Code

This folder is the source of truth for the app's new UI. The goal is to **replace the existing UI only**. Processing logic (ASR, clip scoring, captions, reframe) must keep working unchanged.

- `screens/*.html`: one static HTML file per screen (open `index.html` to browse). All styles are inline, so each file shows the exact colors, sizes and spacing.
- `TOKENS.md`: colors, type, radii and component rules extracted from the screens.
- Interactive states that are not visible by default are kept inside `<template data-state="...">` blocks (for example the Font and Effects tabs in `Subtitles.html`). Treat them as part of the design.
- Values in `[brackets]` are placeholders to be wired to real data.

## Step 1: inspect before changing anything

1. Map the project: entry point, UI framework (PyQt5 widgets, QML, web view, or other), and which modules hold processing logic.
2. Check whether logic is separated from UI (no PyQt imports inside `analysis/`, `reframe/`, captions code). If not, list the places where UI and logic are mixed.
3. Report back with a short plan and **wait for approval** before editing.

## Step 2: choose the UI approach (recommend one, with reasons)

- **Option A: keep PyQt5 widgets**, rebuild each screen with layouts and a global QSS stylesheet generated from `TOKENS.md`. Lower risk if UI and logic are tightly mixed.
- **Option B: keep the Python backend, render the UI as HTML** in `QWebEngineView` (or `pywebview`), with a small bridge (`QWebChannel`) exposing backend calls and progress events. Reuses these screens almost directly and matches the design exactly. Preferred if logic is already separated.

Either way: long jobs run in background workers (`QThread`/`QThreadPool`), never on the UI thread; progress and cancel are wired to the UI.

## Step 3: migrate screen by screen

Order (each step should run end to end before the next):

| # | Screen file | Purpose | Backend data it needs |
|---|---|---|---|
| 1 | `Home.html` | First screen, tools grid, sign-in entry | plan, minutes left |
| 2 | `Main.html`, `ImportLowMinutes.html` | Import + settings, minutes warning | file metadata (duration, size), minutes left |
| 3 | `Processing.html`, `Queued.html` | Progress per stage, live transcript, queue | stage progress events, partial transcript, queue |
| 4 | `Review.html` | Ranked clips, score /100, Hook/Flow/Value grades, reasons, trim | clip list JSON from scoring (`rank, start, end, title, score, grades, reasons`) |
| 5 | `Subtitles.html` | Caption lines, preview with safe zone, Presets/Font/Effects | caption chunks, style object, word highlights |
| 6 | `ExportDone.html` | Result, time saved, suggested caption | export paths, durations |
| 7 | `ReframeSetup.html`, `ReframeProcessing.html`, `ReframeResult.html` | AI Reframe flow | reframe options, progress, `plan.json` (shots, layouts, crop path) |
| 8 | `Projects.html`, `Settings.html`, `Account.html` | App management | projects list, settings, account and billing |
| 9 | `Welcome.html`, `Otp.html`, `FirstImport.html`, `SignInModal.html`, `Upgrade.html` | Sign-in and paywall | auth and payment stubs are fine for now |

## Rules

- Do not change processing algorithms, file formats or model code while doing UI work. If a screen needs data the backend does not produce yet, add a thin adapter and note it.
- UI text is Khmer; keep the strings from the HTML. Technical terms stay in English as written.
- Font: **Kantumruy Pro** (bundle the font files with the app; do not rely on Google Fonts at runtime in a desktop app). Khmer must render through a shaping engine (Qt uses HarfBuzz) so vowels and subscripts display correctly.
- No borders on form controls: inputs, selects and segmented buttons use filled backgrounds (see `TOKENS.md`).
- Every screen has window controls (minimize, maximize, close) top-right; with a frameless window, implement dragging on the top bar.
- Minimum click target 40-44 px. Keep keyboard focus visible.
- After each screen, run the app and compare against the HTML file side by side.
