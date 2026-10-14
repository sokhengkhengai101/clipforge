"""ជំហាន 6 — FFmpeg: trim -> center-crop 9:16 -> scale 1080x1920 -> burn ASS -> H.264 MP4.

នេះជាជំហានចុងក្រោយ៖ បម្លែង clip ដែលយើងជ្រើស + caption ទៅជា file ដែលអ្នក post បាន។

**ចំណុចពិបាកមួយ**: filter `ass=` ទទួល path តែ `:` និង `\\` មានន័យពិសេសក្នុង filtergraph
របស់ FFmpeg។ `C:\\Users\\...\\clip_01.ass` នឹងបែកជាបំណែក។ ដំណោះស្រាយសាមញ្ញបំផុត៖
យើង **run FFmpeg ក្នុង folder នោះផ្ទាល់** (`cwd=`) រួចសរសេរតែ `clip_01.ass` — គ្មាន
តួអក្សរពិសេសសោះ។
"""

import subprocess
from pathlib import Path
from typing import Callable

import config
from pipeline.audio import FFmpegError, require_ffmpeg, probe_duration
from pipeline.highlights import Clip


class RenderError(RuntimeError):
    """FFmpeg render បរាជ័យ."""


def probe_dimensions(video_path: Path) -> tuple[int, int]:
    """ទទឹង × កម្ពស់នៃ video (pixel)."""
    require_ffmpeg("ffprobe")
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(video_path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0 or "x" not in result.stdout:
        raise RenderError(f"អានទំហំ {Path(video_path).name} មិនបាន: {result.stderr.strip()}")
    width, height = result.stdout.strip().split("x")[:2]
    return int(width), int(height)


def compute_crop(width: int, height: int,
                 out_width: int | None = None, out_height: int | None = None
                 ) -> tuple[int, int, int, int]:
    """គណនាប្រអប់ crop ធំបំផុតដែលមានសមាមាត្រ 9:16 ហើយនៅកណ្តាល.

    ត្រឡប់ `(w, h, x, y)` សម្រាប់ filter `crop=w:h:x:y`។

    ឧទាហរណ៍ 1920×1080 (16:9) -> យកកម្ពស់ទាំងអស់, ទទឹង = 1080 × 9/16 = 607
    ហើយ x = (1920 - 607) / 2 = 656 (កណ្តាល)។

    **H.264 តម្រូវលេខគូ** (yuv420p ចែក pixel ជាគូ) ដូច្នេះយើងបង្គត់ចុះទៅលេខគូ។
    """
    out_width = out_width or config.OUT_WIDTH
    out_height = out_height or config.OUT_HEIGHT
    target_ratio = out_width / out_height          # 1080/1920 = 0.5625

    if width / height > target_ratio:
        # ដើមធាត់ជាងគោលដៅ -> កំណត់ដោយកម្ពស់
        crop_h = height
        crop_w = int(height * target_ratio)
    else:
        # ដើមស្តើងជាង (ឬស្មើ) -> កំណត់ដោយទទឹង
        crop_w = width
        crop_h = int(width / target_ratio)

    crop_w = min(width, crop_w) // 2 * 2           # បង្គត់ចុះទៅលេខគូ
    crop_h = min(height, crop_h) // 2 * 2
    x = max(0, (width - crop_w) // 2)
    y = max(0, (height - crop_h) // 2)
    return crop_w, crop_h, x, y


def build_filter(crop: tuple[int, int, int, int], ass_filename: str | None,
                 out_width: int | None = None, out_height: int | None = None) -> str:
    """សាងសង់ filtergraph: crop -> scale -> (burn ass).

    `setsar=1` កំណត់ pixel aspect ratio ជា 1:1 — បើគ្មាន player ខ្លះនឹងទាញរូបវែង។
    """
    out_width = out_width or config.OUT_WIDTH
    out_height = out_height or config.OUT_HEIGHT
    crop_w, crop_h, x, y = crop

    parts = [
        f"crop={crop_w}:{crop_h}:{x}:{y}",
        f"scale={out_width}:{out_height}:flags=lanczos",   # lanczos = ច្បាស់ជាងពេលពង្រីក
        "setsar=1",
    ]
    if ass_filename:
        parts.append(f"ass={ass_filename}")
    return ",".join(parts)


def render_clip(
    video_path: Path,
    clip: Clip,
    out_path: Path,
    ass_path: Path | None = None,
    *,
    force: bool = False,
) -> Path:
    """Render clip មួយទៅ MP4. ត្រឡប់ path។

    FFmpeg អាន video ដើមតែប៉ុណ្ណោះ — file ដើមរបស់អ្នកមិនប៉ះទេ។
    """
    video_path = Path(video_path)
    out_path = Path(out_path)
    if not video_path.is_file():
        raise FileNotFoundError(f"រកមិនឃើញ video: {video_path}")

    if out_path.exists() and not force:
        return out_path

    if ass_path is not None:
        ass_path = Path(ass_path)
        if not ass_path.is_file():
            raise RenderError(f"រកមិនឃើញ subtitle: {ass_path}")
        if ass_path.parent.resolve() != out_path.parent.resolve():
            raise RenderError("`.ass` និង MP4 ត្រូវនៅ folder តែមួយ "
                              "(យើង run FFmpeg ក្នុង folder នោះដើម្បីជៀស path escaping)")

    require_ffmpeg("ffmpeg")
    crop = compute_crop(*probe_dimensions(video_path))
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # `-ss` មុន `-i` = seek លឿន (FFmpeg រំលងទៅជិតកន្លែងនោះមុននឹង decode)
    # `-t` = រយៈពេលដែលត្រូវយក
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-ss", f"{clip.start:.3f}",
        "-i", str(video_path.resolve()),
        "-t", f"{clip.duration:.3f}",
        "-vf", build_filter(crop, ass_path.name if ass_path else None),
        "-c:v", "libx264",
        "-preset", config.VIDEO_PRESET,
        "-crf", str(config.VIDEO_CRF),
        "-pix_fmt", "yuv420p",          # ត្រូវការសម្រាប់ player/ទូរស័ព្ទភាគច្រើន
        "-c:a", "aac",
        "-b:a", config.AUDIO_BITRATE,
        "-movflags", "+faststart",      # metadata នៅដើម file -> ចាប់ផ្តើមលេងលឿន
        out_path.name,
    ]

    result = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=str(out_path.parent),       # <- ទីនេះជាគន្លឹះ: path ខ្លីគ្មានតួអក្សរពិសេស
    )
    if result.returncode != 0:
        raise RenderError(f"FFmpeg បរាជ័យលើ '{clip.title}':\n{result.stderr.strip()[-800:]}")
    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RenderError(f"FFmpeg រត់ចប់ តែ {out_path.name} ទទេ/គ្មាន")

    return out_path


def render_all(
    video_path: Path,
    clips: list[Clip],
    out_dir: Path,
    ass_paths: list[Path] | None = None,
    *,
    force: bool = False,
    on_progress: Callable[[int, int, Clip], None] | None = None,
) -> list[Path]:
    """Render គ្រប់ clip ទៅ `out_dir/clip_01.mp4` ...។"""
    out_dir = Path(out_dir)
    results: list[Path] = []

    for index, clip in enumerate(clips, start=1):
        if on_progress:
            on_progress(index, len(clips), clip)
        ass_path = None
        if ass_paths is not None and index <= len(ass_paths):
            ass_path = ass_paths[index - 1]
        results.append(render_clip(
            video_path, clip, out_dir / f"clip_{index:02d}.mp4", ass_path, force=force,
        ))

    return results


def verify_clip(out_path: Path, clip: Clip, tolerance: float = 0.5) -> float:
    """ពិនិត្យថារយៈពេល MP4 ត្រូវនឹង clip ដែលយើងស្នើ. ត្រឡប់រយៈពេលពិត។

    ការពិនិត្យនេះចាប់បាន bug ដែលស្ងាត់ៗ (ឧ. `-ss`/`-t` ខុសកន្លែង ធ្វើឲ្យបានតែ ១ វិនាទី)។
    """
    actual = probe_duration(out_path)
    if abs(actual - clip.duration) > tolerance:
        raise RenderError(
            f"'{clip.title}': រយៈពេលខុស — សុំ {clip.duration:.1f}s តែបាន {actual:.1f}s"
        )
    return actual
