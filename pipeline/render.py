"""ជំហាន 6 — FFmpeg: trim -> reframe 9:16 -> burn ASS -> H.264 MP4.

នេះជាជំហានចុងក្រោយ៖ បម្លែង clip ដែលយើងជ្រើស + caption ទៅជា file ដែលអ្នក post បាន។

**ចំណុចពិបាកទី ១**: filter `ass=` ទទួល path តែ `:` និង `\\` មានន័យពិសេសក្នុង filtergraph
របស់ FFmpeg។ `C:\\Users\\...\\clip_01.ass` នឹងបែកជាបំណែក។ ដំណោះស្រាយសាមញ្ញបំផុត៖
យើង **run FFmpeg ក្នុង folder នោះផ្ទាល់** (`cwd=`) រួចសរសេរតែ `clip_01.ass`។

**ចំណុចពិបាកទី ២**: layout ប្តូរពាក់កណ្តាល clip (camera កាត់រាល់ ~5 វិនាទី)។ FFmpeg
មិនអាចប្តូររចនាសម្ព័ន្ធ filter ពាក់កណ្តាលផ្លូវទេ ដូច្នេះយើង render **shot នីមួយៗដោយឡែក**
រួច `concat` ចូលគ្នា រួចទើប burn caption ម្តងលើ clip ពេញ។
"""

import shutil
import subprocess
from pathlib import Path
from typing import Callable

import config
from pipeline.audio import FFmpegError, probe_duration, require_ffmpeg
from pipeline.highlights import Clip
from pipeline.reframe import Box, Layout, Segment


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
    """filtergraph សាមញ្ញ (មួយ crop): crop -> scale -> (burn ass).

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


def build_layout_filter(layout: Layout, ass_filename: str | None = None,
                        out_width: int | None = None, out_height: int | None = None) -> str:
    """filtergraph សម្រាប់ layout មួយ — ចេញជា `-filter_complex` ដែលបញ្ចប់ដោយ `[v]`.

    Split ត្រូវការ `split` (ចម្លង stream ជាពីរ) រួច crop ខុសគ្នា រួច `vstack`
    (ដាក់ជាន់គ្នាបញ្ឈរ)។ ផ្ទាំងនីមួយៗខ្ពស់ពាក់កណ្តាលលទ្ធផល។
    """
    out_width = out_width or config.OUT_WIDTH
    out_height = out_height or config.OUT_HEIGHT
    burn = f",ass={ass_filename}" if ass_filename else ""

    if layout.kind == "split" and layout.top and layout.bottom:
        half = out_height // 2
        return (
            "[0:v]split=2[a][b];"
            f"[a]{layout.top.as_filter()},scale={out_width}:{half}:flags=lanczos[top];"
            f"[b]{layout.bottom.as_filter()},scale={out_width}:{half}:flags=lanczos[bot];"
            f"[top][bot]vstack=inputs=2,setsar=1{burn}[v]"
        )

    box = layout.box
    if box is None:
        raise RenderError(f"layout '{layout.kind}' គ្មានប្រអប់ crop")
    return (f"[0:v]{box.as_filter()},scale={out_width}:{out_height}:flags=lanczos,"
            f"setsar=1{burn}[v]")


def _encode_args(crf: int, preset: str) -> list[str]:
    return [
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", config.AUDIO_BITRATE,
        "-movflags", "+faststart",      # metadata នៅដើម file -> ចាប់ផ្តើមលេងលឿន
    ]


def _run_ffmpeg(cmd: list[str], cwd: Path, what: str) -> None:
    result = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(cwd),
    )
    if result.returncode != 0:
        raise RenderError(f"FFmpeg បរាជ័យ ({what}):\n{result.stderr.strip()[-800:]}")


def render_segment(video_path: Path, segment: Segment, out_path: Path,
                   ass_filename: str | None = None,
                   crf: int | None = None, preset: str | None = None) -> Path:
    """Render shot មួយ (មួយ layout) ទៅ MP4."""
    require_ffmpeg("ffmpeg")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-ss", f"{segment.start:.3f}",
        "-i", str(Path(video_path).resolve()),
        "-t", f"{segment.duration:.3f}",
        "-filter_complex", build_layout_filter(segment.layout, ass_filename),
        "-map", "[v]", "-map", "0:a?",
        *_encode_args(config.VIDEO_CRF if crf is None else crf,
                      config.VIDEO_PRESET if preset is None else preset),
        out_path.name,
    ]
    _run_ffmpeg(cmd, out_path.parent, f"segment {segment.start:.1f}s")
    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RenderError(f"segment {out_path.name} ទទេ")
    return out_path


def concat_segments(paths: list[Path], out_path: Path) -> Path:
    """ភ្ជាប់ MP4 ច្រើនជាមួយគ្នាដោយ **មិន encode ឡើងវិញ** (`-c copy`).

    Segment ទាំងអស់មក​ពី encode ដូចគ្នា ដូច្នេះការចម្លងផ្ទាល់ដំណើរការ ហើយលឿន
    និងគ្មានការបាត់បង់គុណភាព។
    """
    out_path = Path(out_path)
    folder = out_path.parent
    listing = folder / "concat_list.txt"
    listing.write_text(
        "".join(f"file '{Path(p).name}'\n" for p in paths), encoding="utf-8"
    )
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
           "-f", "concat", "-safe", "0", "-i", listing.name, "-c", "copy", out_path.name]
    _run_ffmpeg(cmd, folder, "concat")
    listing.unlink(missing_ok=True)
    return out_path


def burn_subtitles(video_in: Path, ass_path: Path, out_path: Path) -> Path:
    """Burn `.ass` លើ video ដែល render រួច (ជំហានចុងក្រោយ).

    យើង run ក្នុង folder របស់ `.ass` ដូច្នេះ filter ឃើញតែឈ្មោះ file។
    Audio ចម្លងផ្ទាល់ (`-c:a copy`) — គ្មានហេតុផល encode សំឡេងម្តងទៀត។
    """
    out_path = Path(out_path)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-i", str(Path(video_in).resolve()),
        "-vf", f"ass={Path(ass_path).name}",
        "-c:v", "libx264", "-preset", config.VIDEO_PRESET, "-crf", str(config.VIDEO_CRF),
        "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart",
        out_path.name,
    ]
    _run_ffmpeg(cmd, Path(ass_path).parent, "burn subtitles")
    return out_path


def render_clip(
    video_path: Path,
    clip: Clip,
    out_path: Path,
    ass_path: Path | None = None,
    *,
    segments: list[Segment] | None = None,
    force: bool = False,
) -> Path:
    """Render clip មួយទៅ MP4. ត្រឡប់ path។

    `segments` = ផែនការ layout ពី `reframe.plan_clip()`។ បើ `None` យើងប្រើ
    center-crop តែមួយសម្រាប់ clip ទាំងមូល (ឥរិយាបថដើម)។

    FFmpeg អាន video ដើមតែប៉ុណ្ណោះ — file ដើមរបស់អ្នកមិនប៉ះទេ។
    """
    video_path = Path(video_path)
    out_path = Path(out_path)
    if not video_path.is_file():
        raise FileNotFoundError(f"រកមិនឃើញ video: {video_path}")

    if ass_path is not None:
        ass_path = Path(ass_path)
        if not ass_path.is_file():
            raise RenderError(f"រកមិនឃើញ subtitle: {ass_path}")

    # cache: រំលងបើ MP4 មានរួច **និង** ថ្មីជាង .ass ។ បើ caption ឬ layout ប្តូរ
    # ហើយយើងរំលង នោះអ្នកទទួលបានលទ្ធផលចាស់ដោយមិនដឹងខ្លួន (យើងបានជួបវាពិត)។
    if out_path.exists() and not force:
        subtitle_is_newer = (
            ass_path is not None and ass_path.is_file()
            and ass_path.stat().st_mtime > out_path.stat().st_mtime
        )
        if not subtitle_is_newer:
            return out_path

    if ass_path is not None:
        if ass_path.parent.resolve() != out_path.parent.resolve():
            raise RenderError("`.ass` និង MP4 ត្រូវនៅ folder តែមួយ "
                              "(យើង run FFmpeg ក្នុង folder នោះដើម្បីជៀស path escaping)")

    require_ffmpeg("ffmpeg")
    if not segments:
        crop_w, crop_h, x, y = compute_crop(*probe_dimensions(video_path))
        segments = [Segment(start=clip.start, end=clip.end,
                            layout=Layout(kind="center",
                                          box=Box(x=x, y=y, w=crop_w, h=crop_h)))]

    out_path.parent.mkdir(parents=True, exist_ok=True)

    if len(segments) == 1:
        # ផ្លូវលឿន: layout តែមួយ -> encode ម្តងគត់ (គុណភាពល្អជាង)
        render_segment(video_path, segments[0], out_path,
                       ass_filename=ass_path.name if ass_path else None)
    else:
        _render_in_segments(video_path, segments, out_path, ass_path)

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RenderError(f"FFmpeg រត់ចប់ តែ {out_path.name} ទទេ/គ្មាន។")
    return out_path


def _render_in_segments(video_path: Path, segments: list[Segment],
                        out_path: Path, ass_path: Path | None) -> None:
    """Render shot នីមួយៗ -> concat -> burn caption ម្តង.

    **ហេតុអ្វីមិន burn caption ក្នុង segment នីមួយៗ?** ពេលវេលាក្នុង `.ass` រាប់ពីដើម
    clip។ បើ burn ដាច់ៗ យើងត្រូវរំកិលពេលវេលាគ្រប់ segment — ងាយខុស។
    """
    work_dir = out_path.parent / f".tmp_{out_path.stem}"
    if work_dir.exists():
        shutil.rmtree(work_dir, ignore_errors=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    try:
        pieces = [
            render_segment(video_path, segment, work_dir / f"seg_{index:03d}.mp4",
                           crf=config.SEGMENT_CRF, preset=config.SEGMENT_PRESET)
            for index, segment in enumerate(segments)
        ]
        joined = concat_segments(pieces, work_dir / "joined.mp4")

        if ass_path is None:
            shutil.move(str(joined), str(out_path))
        else:
            burn_subtitles(joined, ass_path, out_path)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def render_all(
    video_path: Path,
    clips: list[Clip],
    out_dir: Path,
    ass_paths: list[Path] | None = None,
    *,
    force: bool = False,
    plans: list[list[Segment]] | None = None,
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
        segments = plans[index - 1] if plans is not None and index <= len(plans) else None
        results.append(render_clip(
            video_path, clip, out_dir / f"clip_{index:02d}.mp4", ass_path,
            segments=segments, force=force,
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
