"""អាន clip ពី `clips.json` + file ជុំវិញវា (ប្រើទាំង API ទាំង database)."""

import json
from pathlib import Path

from pipeline.highlights import load_clips

SIDECAR_SUFFIXES = ("mp4", "ass", "srt", "vtt")


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
                      if stem.with_suffix(f".{suffix}").is_file()},
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
