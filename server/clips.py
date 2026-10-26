"""អាន clip ពី `clips.json` + file ជុំវិញវា (ប្រើទាំង API ទាំង database)."""

import json
import re
import threading
from pathlib import Path

import config
from types import SimpleNamespace

from pipeline.captions import (anchor_for, display_word, line_positions, word_intervals, words_in_clip,
                               wrap_into_cues)
from pipeline.highlights import load_clips
from pipeline.transcribe import load_transcript

SIDECAR_SUFFIXES = ("mp4", "ass", "srt", "vtt")


def clean_file(stem: Path, ranked: Path) -> dict:
    """`clip_01_clean.mp4` (preview គ្មាន caption) បើវាមាន ហើយថ្មីជាង `clips.json`.

    `clips.json` សរសេរតែពេល AI ជ្រើស clip ឡើងវិញ — ពេលនោះ clip_01 អាចជា clip ផ្សេង
    ហើយ preview ចាស់នឹងបង្ហាញរូបខុស. "រក្សាទុក" (render style ម្តងទៀត) សរសេរ clip_01.mp4
    ឡើងវិញតែរូបភាពមិនប្តូរ ដូច្នេះវាមិនត្រូវធ្វើឲ្យ preview ចាស់ទេ.
    """
    clean = stem.with_name(f"{stem.name}_clean.mp4")
    if clean.is_file() and (not ranked.is_file() or clean.stat().st_mtime >= ranked.stat().st_mtime):
        return {"clean": str(clean)}
    return {}


def clips_of_project(out_dir: Path) -> list[dict]:
    """បញ្ជី clip ជា dict ធម្មតា. ទទេ បើគ្មាន `clips.json`."""
    out_dir = Path(out_dir)
    # any_version: UI បង្ហាញ clip ដែលមានលើ disk — cache ចាស់មិនមែនជាមូលហេតុ
    # លាក់ project ទេ (ឃើញពិត៖ 4 ក្នុង 6 project លើម៉ាស៊ីននេះជា version 2).
    clips = load_clips(out_dir / "clips.json", any_version=True)
    if not clips:
        return []

    folder = out_dir / "clips"
    items = []
    for index, clip in enumerate(clips, start=1):
        stem = folder / f"clip_{index:02d}"
        grades = None
        if clip.grades:
            grades = {part: {"score": getattr(clip.grades, part).score,
                             "letter": getattr(clip.grades, part).letter,
                             "reason": getattr(clip.grades, part).reason}
                      for part in ("hook", "flow", "value")}
        items.append({
            "index": index,
            "start": clip.start, "end": clip.end, "duration": clip.duration,
            "title": clip.title, "hook": clip.hook, "type": clip.type,
            "total": clip.total, "letter": clip.letter, "grades": grades,
            "reason": clip.reason,
            "files": {suffix: str(stem.with_suffix(f".{suffix}"))
                      for suffix in SIDECAR_SUFFIXES
                      if stem.with_suffix(f".{suffix}").is_file()}
                     | clean_file(stem, out_dir / "clips.json"),
        })
    return items


def transcript_preview(out_dir: Path) -> dict:
    """Transcript + clip ដែល AI កំពុងពិចារណា — screen Processing បង្ហាញវាពេល job រត់.

    អានពី file ដែល pipeline សរសេររួច (transcript.json ក្រោយជំហាន transcribe,
    highlights.json ក្រោយជំហាន highlights). ផ្ញើតែ start/end/text: transcript.json
    មាន word timestamps ដែលធ្វើឲ្យវាធំ (2.3 MB សម្រាប់ comedy ៥០ នាទី) ហើយ UI មិនត្រូវការ.
    file មិនទាន់មាន = បញ្ជីទទេ (មិនមែន error) ព្រោះ UI សួរវាពេល job ទើបចាប់ផ្តើមក៏បាន.
    """
    out_dir = Path(out_dir)
    preview: dict = {"duration": None, "device": None, "segments": [], "candidates": []}
    try:
        data = json.loads((out_dir / "transcript.json").read_text(encoding="utf-8"))
        preview["duration"] = data.get("duration")
        preview["device"] = data.get("device")
        preview["segments"] = [{"start": s["start"], "end": s["end"], "text": s["text"].strip()}
                               for s in data.get("segments", [])]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    candidates = load_clips(out_dir / "highlights.json", any_version=True) or []
    preview["candidates"] = [{"start": c.start, "end": c.end, "title": c.title} for c in candidates]
    return preview


# ---------- cue សម្រាប់ preview ផ្ទាល់ (screen Subtitles) ----------

# តម្លៃ config ដែល apply_aspect() និង apply_caption_style() ប្តូរ. ពួកវាជា global ក្នុង
# process នេះ ហើយ apply_caption_style **គុណ** ទំហំ font — ការហៅពីរដងដោយគ្មានការ
# ដាក់វិញធ្វើឲ្យ font តូចទៅៗ. ដូច្នេះ lock + រក្សាទុក + ដាក់វិញរាល់ការហៅ.
_STYLE_NAMES = ("OUT_WIDTH", "OUT_HEIGHT", "PANEL_ASPECT", "SPLIT_DIRECTION", "CAPTION_FONT_SIZE",
                "CAPTION_MARGIN_X", "CAPTION_MARGIN_V", "CAPTION_MARGIN_V_SPLIT", "CAPTION_LINE_GAP",
                "CAPTION_OUTLINE", "CAPTION_UPPERCASE", "CAPTION_POSITION", "CAPTION_MAX_LINES")
_STYLE_LOCK = threading.Lock()


def _cue_lines(cue, start: float) -> list[list[dict]]:
    """បន្ទាត់របស់ cue: ពាក្យនីមួយៗជាមួយពេលពាក្យសកម្ម និង `keyword` (pick_keywords ដូច render)."""
    from pipeline.captions import pick_keywords

    keywords = pick_keywords(cue)
    intervals = iter(word_intervals(cue, start))
    return [[{"text": display_word(w.word.strip()), "start": round(a, 3), "end": round(b, 3),
              "keyword": re.sub(r"[^\w']", "", w.word.strip().lower()) in keywords}
             for w, (a, b) in zip(line, intervals)] for line in cue.lines]


def whole_cues(out_dir: Path, words: int = 5, lines: int = 3) -> dict | None:
    """Cue នៃវីដេអូទាំងមូល (Edit Video preview): ការបំបែកពិតរបស់ captions.py, ពេលក្នុងវីដេអូ.

    ឧ. lines=1 -> cue ខ្លីជាង (១ បន្ទាត់ ≤ 16 តួ). `None` = គ្មាន transcript.
    """
    if not 2 <= words <= 8 or not 1 <= lines <= 3:
        raise ValueError("words 2-8, lines 1-3")
    transcript = load_transcript(Path(out_dir) / "transcript.json")
    if not transcript:
        return None
    all_words = [w for s in transcript.segments for w in s.words]
    with _STYLE_LOCK:
        saved = config.CAPTION_MAX_LINES
        try:
            config.CAPTION_MAX_LINES = lines
            cues = wrap_into_cues(all_words, 0.0, max_words=words)
        finally:
            config.CAPTION_MAX_LINES = saved
    return {"cues": [{"start": round(c.start, 3), "end": round(c.end, 3), "lines": _cue_lines(c, 0.0)}
                     for c in cues]}


def preview_cues(out_dir: Path, index: int, words: int = 5, size: int = 100,
                 position: str = "auto", lines: int = 3) -> dict | None:
    """Cue របស់ clip មួយ ដូចដែល render នឹងគូរ: បន្ទាត់, ពាក្យ, ពេលពាក្យសកម្ម, y របស់បន្ទាត់.

    ប្រើ function ពិតរបស់ captions.py (wrap_into_cues, line_positions, word_intervals) ដូច្នេះ
    ការប្តូរ "ពាក្យក្នុងមួយ cue" ក្នុង preview បំបែកដូចការ render បេះបិទ. ពេល/ទីតាំងគិតជា px
    លើ 1080x1920 (folder `clips/` ជា 9:16 ជានិច្ច); UI បង្រួមតាមទំហំ preview.
    `auto` ធ្វើដូច make_clips: shot ផ្ទាំងច្រើន (split / three / four) -> cue លើស្នាម, shot
    មួយផ្ទាំង -> lower third (anchor_for + line_positions) — អានពី `clip_XX_layout.json` ដែល
    render សរសេរ. clip ចាស់ដែលគ្មាន file នោះ -> lower third ហើយ `layout_known` = False.
    `None` = គ្មាន clip ឬ transcript.
    ValueError = words/size/position ក្រៅដែនកំណត់.
    """
    if not 2 <= words <= 8:
        raise ValueError(f"words ត្រូវនៅចន្លោះ 2-8 (ទទួលបាន {words})")
    if not 1 <= lines <= 3:
        raise ValueError(f"lines ត្រូវនៅចន្លោះ 1-3 (ទទួលបាន {lines})")
    clips = load_clips(Path(out_dir) / "clips.json", any_version=True) or []
    transcript = load_transcript(Path(out_dir) / "transcript.json")
    if not transcript or not 1 <= index <= len(clips):
        return None
    clip = clips[index - 1]
    layout = _layout_summary(Path(out_dir) / "clips" / f"clip_{index:02d}_layout.json")

    with _STYLE_LOCK:
        saved = {name: getattr(config, name) for name in _STYLE_NAMES}
        try:
            config.apply_aspect("9:16")
            config.apply_caption_style(size_percent=size, position=position)
            config.CAPTION_MAX_LINES = lines
            cues = wrap_into_cues(words_in_clip(clip, transcript), clip.start, max_words=words)
            # auto: ទីតាំងតាម shot នីមួយៗ (anchor_for) ដូច make_clips; ទីតាំងបង្ខំ = MarginV របស់វា
            shots = layout["shots"] if position == "auto" and layout is not None else None
            result = {
                "width": config.OUT_WIDTH,
                "height": config.OUT_HEIGHT,
                "font_size": config.CAPTION_FONT_SIZE,
                "active_scale": config.CAPTION_ACTIVE_SCALE,
                "safe_top": config.CAPTION_SAFE_TOP,
                "safe_bottom": config.CAPTION_SAFE_BOTTOM,
                "layout_known": layout is not None,
                "cues": [],
            }
            for cue in cues:
                ys = line_positions(len(cue.lines), anchor_for(cue, clip.start, shots))
                result["cues"].append({
                    "start": round(cue.start, 3),
                    "end": round(cue.end, 3),
                    "lines": [{"y": round(y, 1), "words": words_of_line}
                              for words_of_line, y in zip(_cue_lines(cue, clip.start), ys)],
                })
            return result
        finally:
            for name, value in saved.items():
                setattr(config, name, value)


def _layout_summary(path: Path) -> dict | None:
    """`clip_XX_layout.json` -> {"dominant": kind, "shots": [Segment-like]} ឬ None បើគ្មាន/ខូច."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        shots = [SimpleNamespace(start=shot["start"], end=shot["end"],
                                 layout=SimpleNamespace(kind=shot["kind"]))
                 for shot in data["shots"]]
        return {"dominant": data["dominant"], "shots": shots}
    except (OSError, ValueError, KeyError, TypeError):
        return None


# ---------- លទ្ធផល AI Reframe (`--full`: វីដេអូទាំងមូល) ----------

# full, full_1x1, full_16x9 ... និង full_edit, full_edit_16x9 ... (Edit Video: វីដេអូដែលកាត់)
REFRAME_FOLDER = re.compile(r"^full(?P<edit>_edit)?(?:_(?P<w>\d+)x(?P<h>\d+))?$")
REFRAME_KINDS = ("mp4", "srt", "vtt")


def reframe_outputs(out_dir: Path) -> list[dict]:
    """វីដេអូ reframe ទាំងអស់របស់ project មួយ (folder `full*`), ថ្មីបំផុតមុន.

    `--full` មិនសរសេរ clips.json ទេ ដូច្នេះ Review មិនឃើញវា — នេះជាផ្លូវតែមួយដែល UI អានវា.
    `shots` មកពី `clip_01_layout.json` (shot នីមួយៗ + layout ដែល planner ជ្រើស) ដើម្បីបង្ហាញ
    ថា AI ជ្រើសអ្វី — ពេលធៀបនឹងដើមវីដេអូ (reframe ចាប់ផ្តើមពី 0).
    """
    results = []
    for folder in sorted(Path(out_dir).glob("full*")):
        match = REFRAME_FOLDER.match(folder.name)
        video = folder / "clip_01.mp4"
        if not match or not video.is_file():
            continue
        aspect = f"{match['w']}:{match['h']}" if match["w"] else "9:16"
        layout = None
        try:
            layout = json.loads((folder / "clip_01_layout.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        shots = layout["shots"] if layout else []
        seconds = shots[-1]["end"] - shots[0]["start"] if shots else None
        if seconds is None:
            # reframe ចាស់ (មុន layout.json) — រយៈពេលពី file ខ្លួនឯង
            from server.media import probe_video
            seconds = (probe_video(video) or {}).get("seconds")
        share: dict[str, float] = {}
        for shot in shots:
            share[shot["kind"]] = share.get(shot["kind"], 0.0) + shot["end"] - shot["start"]
        switches = sum(1 for a, b in zip(shots, shots[1:]) if a["kind"] != b["kind"])
        results.append({
            "folder": folder.name,
            "aspect": aspect,
            "edited": bool(match["edit"]),     # Edit Video: កាត់ចេញខ្លះ (cut list)
            "files": {kind: str(video.with_suffix(f".{kind}")) for kind in REFRAME_KINDS
                      if video.with_suffix(f".{kind}").is_file()},
            "bytes": video.stat().st_size,
            "modified": video.stat().st_mtime,
            # ពី layout.json (pipeline ដឹងពី --no-captions); reframe ចាស់គ្មានវា -> តាម .ass
            "captions": layout.get("captions", video.with_suffix(".ass").is_file()) if layout
                        else video.with_suffix(".ass").is_file(),
            "seconds": round(seconds, 2) if seconds else None,
            "shots": shots,
            "allowed": layout.get("allowed") if layout else None,     # None = មិនដឹង (reframe ចាស់)
            # ពេលសរុបក្នុង layout នីមួយៗ (វិនាទី) និងចំនួនដងដែល framing ប្តូរក្នុងមួយនាទី
            "layout_seconds": {kind: round(value, 1) for kind, value in share.items()},
            "shots_per_minute": round(len(shots) / (seconds / 60), 1) if seconds else None,
            "layout_switches_per_minute": round(switches / (seconds / 60), 1) if seconds else None,
        })
    results.sort(key=lambda item: item["modified"], reverse=True)
    return results


DURATION_IN_HEAD = re.compile(r'"duration"\s*:\s*([0-9.]+)')


def project_facts(out_dir: Path) -> dict:
    """លេខសម្រាប់កាត project (ទំព័រ Projects របស់ខ្ញុំ): រយៈពេល ទំហំ និងចំនួន reframe.

    `seconds` = រយៈពេលវីដេអូដើមពី `transcript.json`។ key `duration` នៅជិតដើម file ដូច្នេះ
    អានតែ 4 KB ដំបូង — transcript របស់វីដេអូ 70 នាទីធំ ហើយ /projects ត្រូវលឿន។
    `bytes` = ទំហំ folder ក្នុង output/ ទាំងមូល (audio, clips, reframe) — មិនមែនវីដេអូដើមទេ។
    """
    out_dir = Path(out_dir)
    seconds = None
    transcript = out_dir / "transcript.json"
    if transcript.is_file():
        with transcript.open("r", encoding="utf-8", errors="replace") as handle:
            found = DURATION_IN_HEAD.search(handle.read(4096))
        seconds = float(found.group(1)) if found else None

    total = 0
    for path in out_dir.rglob("*"):
        try:
            if path.is_file():
                total += path.stat().st_size
        except OSError:
            continue               # file ត្រូវបានលុបពេលកំពុងរាប់ (render កំពុងរត់)

    reframes = sum(1 for folder in out_dir.glob("full*")
                   if REFRAME_FOLDER.match(folder.name) and (folder / "clip_01.mp4").is_file())
    return {"seconds": seconds, "bytes": total, "reframes": reframes}
