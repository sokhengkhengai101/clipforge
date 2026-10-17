"""អាន clip ពី `clips.json` + file ជុំវិញវា (ប្រើទាំង API ទាំង database)."""

from pathlib import Path

from pipeline.highlights import load_clips

SIDECAR_SUFFIXES = ("mp4", "ass", "srt", "vtt")


def clips_of_project(out_dir: Path) -> list[dict]:
    """បញ្ជី clip ជា dict ធម្មតា. ទទេ បើគ្មាន `clips.json`."""
    out_dir = Path(out_dir)
    clips = load_clips(out_dir / "clips.json")
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
