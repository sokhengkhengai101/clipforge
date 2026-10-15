"""ជំហាន 6 — FFmpeg: trim -> reframe 9:16 -> burn ASS -> H.264 MP4.

នេះជាជំហានចុងក្រោយ៖ បម្លែង clip ដែលយើងជ្រើស + caption ទៅជា file ដែលអ្នក post បាន។

**ចំណុចពិបាកទី ១**: filter `ass=` ទទួល path តែ `:` និង `\\` មានន័យពិសេសក្នុង filtergraph
របស់ FFmpeg។ `C:\\Users\\...\\clip_01.ass` នឹងបែកជាបំណែក។ ដំណោះស្រាយសាមញ្ញបំផុត៖
យើង **run FFmpeg ក្នុង folder នោះផ្ទាល់** (`cwd=`) រួចសរសេរតែ `clip_01.ass`។

**ចំណុចពិបាកទី ២**: layout ប្តូរពាក់កណ្តាល clip (camera កាត់រាល់ ~5 វិនាទី)។ FFmpeg
មិនអាចប្តូររចនាសម្ព័ន្ធ filter ពាក់កណ្តាលផ្លូវទេ ដូច្នេះយើង render **shot នីមួយៗដោយឡែក**
រួច `concat` ចូលគ្នា រួចទើប burn caption ម្តងលើ clip ពេញ។
"""

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


def layout_chain(layout: Layout, index: int, source_label: str, out_label: str,
                 suffix: str = "", out_width: int | None = None,
                 out_height: int | None = None) -> str:
    """ផ្នែក filtergraph ដែលបម្លែង `[source_label]` ទៅ `[out_label]` តាម layout.

    Split ត្រូវការ `split` (ចម្លង stream ជាពីរ) រួច crop ខុសគ្នា រួច `vstack`
    (ដាក់ជាន់គ្នាបញ្ឈរ)។ ផ្ទាំងនីមួយៗខ្ពស់ពាក់កណ្តាលលទ្ធផល។

    `index` ធ្វើឲ្យឈ្មោះ label មិនជាន់គ្នាពេលយើងដាក់ chain ច្រើនក្នុង graph តែមួយ។
    """
    out_width = out_width or config.OUT_WIDTH
    out_height = out_height or config.OUT_HEIGHT

    if layout.kind == "split" and layout.top and layout.bottom:
        # output បញ្ឈរ/ការ៉េ -> ជាន់គ្នាបញ្ឈរ (vstack); output ផ្ដេក -> ឆ្វេង/ស្តាំ (hstack)។
        # ផ្ទាំង 1920×540 នៅលើ 16:9 នឹងវែងនិងរាក់ពេក ដូច្នេះទិសត្រូវប្តូរតាម output។
        horizontal = config.SPLIT_DIRECTION == "horizontal"
        panel_w = out_width // 2 if horizontal else out_width
        panel_h = out_height if horizontal else out_height // 2
        stack = "hstack" if horizontal else "vstack"
        return (
            f"[{source_label}]split=2[a{index}][b{index}];"
            f"[a{index}]{layout.top.as_filter()},"
            f"scale={panel_w}:{panel_h}:flags=lanczos[t{index}];"
            f"[b{index}]{layout.bottom.as_filter()},"
            f"scale={panel_w}:{panel_h}:flags=lanczos[m{index}];"
            f"[t{index}][m{index}]{stack}=inputs=2,setsar=1{suffix}[{out_label}]"
        )

    box = layout.box
    if box is None:
        raise RenderError(f"layout '{layout.kind}' គ្មានប្រអប់ crop")
    return (f"[{source_label}]{box.as_filter()},"
            f"scale={out_width}:{out_height}:flags=lanczos,setsar=1{suffix}[{out_label}]")


def build_layout_filter(layout: Layout, ass_filename: str | None = None,
                        out_width: int | None = None, out_height: int | None = None) -> str:
    """filtergraph សម្រាប់ layout តែមួយ (clip ដែលមិនមានការកាត់ camera)."""
    burn = f",ass={ass_filename}" if ass_filename else ""
    return layout_chain(layout, 0, "0:v", "v", burn, out_width, out_height)


def build_segments_filter(segments: list[Segment], clip_start: float,
                          ass_filename: str | None = None,
                          out_width: int | None = None,
                          out_height: int | None = None) -> str:
    """filtergraph តែមួយដែលដោះស្រាយ shot ទាំងអស់ក្នុង clip — encode តែម្តង.

    **ហេតុអ្វីមិន render ដាច់ៗរួច concat?** យើងបានសាកវិធីនោះ ហើយរាល់កន្លែងភ្ជាប់
    បាត់ frame ១ (គម្លាត 83ms ជំនួស 42ms) ព្រោះ timestamp ត្រូវបង្គត់។ ម្យ៉ាងទៀត
    វា encode ២ ដង (បាត់បង់គុណភាព + យឺត)។

    វិធីនេះ: `split` ចម្លង stream ទៅគ្រប់ shot, `trim` កាត់ចន្លោះពេលរបស់ shot នីមួយៗ,
    `setpts=PTS-STARTPTS` ចាប់ផ្តើមពេលឡើងវិញពី 0 (បើមិនដូច្នោះ concat នឹងច្រឡំ),
    រួច `concat` ភ្ជាប់វិញ។ លទ្ធផល: decode ម្តង, encode ម្តង, គ្មាន frame បាត់។

    សំឡេងមិនត្រូវប៉ះទេ — shot តៗគ្នាគ្របដណ្តប់ clip ទាំងមូល ដូច្នេះវានៅ sync ស្រាប់។
    """
    if len(segments) == 1:
        return build_layout_filter(segments[0].layout, ass_filename, out_width, out_height)

    count = len(segments)
    parts = ["[0:v]split=" + str(count) + "".join(f"[s{i}]" for i in range(count))]

    for index, segment in enumerate(segments):
        start = max(0.0, segment.start - clip_start)
        end = max(start, segment.end - clip_start)
        parts.append(
            f"[s{index}]trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS[p{index}]"
        )
        parts.append(layout_chain(segment.layout, index, f"p{index}", f"v{index}",
                                  out_width=out_width, out_height=out_height))

    burn = f",ass={ass_filename}" if ass_filename else ""
    joined = "".join(f"[v{i}]" for i in range(count))
    parts.append(f"{joined}concat=n={count}:v=1:a=0{burn}[v]")
    return ";".join(parts)


def _encode_args(crf: int, preset: str) -> list[str]:
    _, video = encoder_args()
    return [
        *video, "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", config.AUDIO_BITRATE,
        "-movflags", "+faststart",      # metadata នៅដើម file -> ចាប់ផ្តើមលេងលឿន
    ]


def _run_ffmpeg(cmd: list[str], cwd: Path, what: str) -> None:
    result = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(cwd),
    )
    if result.returncode != 0:
        raise RenderError(f"FFmpeg បរាជ័យ ({what}):\n{result.stderr.strip()[-800:]}")


def render_segments(video_path: Path, clip: Clip, segments: list[Segment],
                    out_path: Path, ass_filename: str | None = None) -> Path:
    """Render clip ទាំងមូល (shot ច្រើន) ដោយ FFmpeg **តែម្តង**."""
    require_ffmpeg("ffmpeg")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-ss", f"{clip.start:.3f}",
        "-i", str(Path(video_path).resolve()),
        "-t", f"{clip.duration:.3f}",
        "-filter_complex", build_segments_filter(segments, clip.start, ass_filename),
        "-map", "[v]", "-map", "0:a?",
        *_encode_args(config.VIDEO_CRF, config.VIDEO_PRESET),
        out_path.name,
    ]
    _run_ffmpeg(cmd, out_path.parent, f"'{clip.title}' ({len(segments)} shots)")
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
    render_segments(video_path, clip, segments, out_path,
                    ass_filename=ass_path.name if ass_path else None)

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RenderError(f"FFmpeg រត់ចប់ តែ {out_path.name} ទទេ/គ្មាន។")
    return out_path


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


# ---------- ជម្រើស encoder ----------

_nvenc_available: list[bool] = []


def nvenc_works() -> bool:
    """សាក encode ១ frame លើ GPU — កុំជឿតែបញ្ជី encoder.

    `ffmpeg -encoders` រាយ h264_nvenc ទោះ driver មានបញ្ហា ឬ GPU រវល់ពេក។
    លទ្ធផលត្រូវចងចាំ ព្រោះការសាកចំណាយ ~0.3s។
    """
    if _nvenc_available:
        return _nvenc_available[0]
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
         "-f", "lavfi", "-i", "color=black:s=128x128:d=0.1",
         "-c:v", "h264_nvenc", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    _nvenc_available.append(result.returncode == 0)
    return _nvenc_available[0]


def encoder_args(encoder: str | None = None) -> tuple[str, list[str]]:
    """ត្រឡប់ (ឈ្មោះដែលប្រើ, argument សម្រាប់ FFmpeg).

    NVENC លឿនជាង libx264 4.3 ដង ហើយវាស់ឃើញថាទំហំ និង VMAF ដូចគ្នា (cq 26)។
    """
    encoder = encoder or config.VIDEO_ENCODER
    if encoder == "auto":
        encoder = "nvenc" if nvenc_works() else "x264"
    if encoder == "nvenc" and not nvenc_works():
        encoder = "x264"      # បានសុំ GPU តែវាមិនដំណើរការ -> ធ្លាក់ទៅ CPU

    if encoder == "nvenc":
        return "nvenc", ["-c:v", "h264_nvenc", "-preset", config.NVENC_PRESET,
                         "-rc", "vbr", "-cq", str(config.NVENC_CQ), "-b:v", "0"]
    return "x264", ["-c:v", "libx264", "-preset", config.VIDEO_PRESET,
                    "-crf", str(config.VIDEO_CRF)]
