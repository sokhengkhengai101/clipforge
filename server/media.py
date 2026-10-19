"""បម្រើ file របស់ clip ទៅ UI (video, subtitle, thumbnail).

ហេតុអ្វីមិនបម្រើ folder `output/` ទាំងមូលជា static? ព្រោះ path មកពី URL
ហើយ `../` អាចនាំចេញក្រៅ folder។ ទីនេះ UI សុំតាម **លេខ clip** រួចយើងរក
path ពី `clips.json` ខ្លួនឯង — URL មិនដែលប្រាប់ path ទេ។
"""

import json
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# kind -> (ឈ្មោះក្នុង clips.json, media type)
KINDS = {
    "mp4": ("mp4", "video/mp4"),
    "ass": ("ass", "text/plain; charset=utf-8"),
    "srt": ("srt", "text/plain; charset=utf-8"),
    "vtt": ("vtt", "text/vtt; charset=utf-8"),
    # clip_XX_clean.mp4: preview គ្មាន caption សម្រាប់ screen Subtitles (មិនមែនសម្រាប់ export)
    "clean": ("clean", "video/mp4"),
}

# អ្វីដែល export ចម្លងបាន — preview គ្មាន caption មិនមែនជាលទ្ធផលសម្រាប់ post ទេ
EXPORTABLE = ("mp4", "ass", "srt", "vtt")


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


def probe_video(path: Path) -> dict | None:
    """ទំហំ, fps, codec និង bitrate ពិតរបស់ file មួយ — តាម `ffprobe`.

    Dialog Export បង្ហាញ "1080 x 1920 · 30 fps"; លេខនោះត្រូវមកពី **file ពិត**
    មិនមែនពី config, ព្រោះ clip ចាស់អាចធ្វើដោយការកំណត់ផ្សេង.
    `None` បើ ffprobe មិនឆ្លើយ — UI សរសេរ "—" ជំនួស.
    """
    path = Path(path)
    if not path.is_file():
        return None
    command = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,codec_name,avg_frame_rate,bit_rate",
        "-show_entries", "format=bit_rate",
        "-of", "json", str(path),
    ]
    try:
        done = subprocess.run(command, capture_output=True, timeout=20, check=True)
        data = json.loads(done.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None
    streams = data.get("streams") or [{}]
    stream = streams[0]
    # avg_frame_rate មកជាប្រភាគអក្សរ ដូច "30000/1001" -> 29.97
    fps = None
    ratio = (stream.get("avg_frame_rate") or "").split("/")
    if len(ratio) == 2 and ratio[1] not in ("0", ""):
        fps = round(int(ratio[0]) / int(ratio[1]), 2)
    # bitrate នៅលើ stream ជួនកាលទទេ (NVENC) — format មានជានិច្ច
    bits = stream.get("bit_rate") or data.get("format", {}).get("bit_rate")
    return {
        "width": stream.get("width"),
        "height": stream.get("height"),
        "fps": fps,
        "codec": stream.get("codec_name"),
        "kbps": round(int(bits) / 1000) if bits else None,
    }
