"""អាន clip ពី `clips.json` + file ជុំវិញវា (ប្រើទាំង API ទាំង database)."""

import json
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
                "CAPTION_OUTLINE", "CAPTION_UPPERCASE", "CAPTION_POSITION")
_STYLE_LOCK = threading.Lock()


def preview_cues(out_dir: Path, index: int, words: int = 5, size: int = 100,
                 position: str = "auto") -> dict | None:
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
                intervals = iter(word_intervals(cue, clip.start))
                ys = line_positions(len(cue.lines), anchor_for(cue, clip.start, shots))
                result["cues"].append({
                    "start": round(cue.start, 3),
                    "end": round(cue.end, 3),
                    "lines": [{"y": round(y, 1),
                               "words": [{"text": display_word(w.word.strip()),
                                          "start": round(a, 3), "end": round(b, 3)}
                                         for w, (a, b) in zip(line, intervals)]}
                              for line, y in zip(cue.lines, ys)],
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
