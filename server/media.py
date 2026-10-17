"""បម្រើ file របស់ clip ទៅ UI (video, subtitle, thumbnail).

ហេតុអ្វីមិនបម្រើ folder `output/` ទាំងមូលជា static? ព្រោះ path មកពី URL
ហើយ `../` អាចនាំចេញក្រៅ folder។ ទីនេះ UI សុំតាម **លេខ clip** រួចយើងរក
path ពី `clips.json` ខ្លួនឯង — URL មិនដែលប្រាប់ path ទេ។
"""

import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# kind -> (ឈ្មោះក្នុង clips.json, media type)
KINDS = {
    "mp4": ("mp4", "video/mp4"),
    "ass": ("ass", "text/plain; charset=utf-8"),
    "srt": ("srt", "text/plain; charset=utf-8"),
    "vtt": ("vtt", "text/vtt; charset=utf-8"),
}


def clip_file(clips: list[dict], index: int, kind: str) -> tuple[Path, str] | None:
    """រក file របស់ clip លេខ `index`. `None` បើគ្មាន."""
    if kind not in KINDS:
        return None
    key, media_type = KINDS[kind]
    for clip in clips:
        if clip["index"] == index:
            path = clip.get("files", {}).get(key)
            if path and Path(path).is_file():
                return Path(path), media_type
            return None
    return None


def thumbnail(video: Path, at_second: float = 1.0) -> Path | None:
    """ដកយក frame មួយពី clip ជារូប .jpg រួចរក្សាទុកក្បែរវា.

    FFmpeg ដំណើរការតែលើកដំបូង — លើកក្រោយ file មានរួចហើយ យើងប្រើវាឡើងវិញ.
    """
    video = Path(video)
    if not video.is_file():
        return None
    image = video.with_suffix(".jpg")
    if image.is_file():
        return image
    command = [
        "ffmpeg", "-nostdin", "-y",
        "-ss", str(at_second), "-i", str(video),
        "-frames:v", "1", "-vf", "scale=-2:360", "-q:v", "4",
        str(image),
    ]
    try:
        subprocess.run(command, capture_output=True, timeout=30, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    return image if image.is_file() else None
