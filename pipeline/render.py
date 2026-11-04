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
from pipeline.audio import probe_duration, require_ffmpeg
from pipeline.highlights import Clip
from pipeline.reframe import Box, Layout, Segment, panel_inner, panel_rects


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


FIT_IMAGE_FILE = ".fit_background.png"   # រូប background ក្នុង folder render (cwd របស់ FFmpeg)
FIT_MASK_FILE = ".fit_mask.png"          # alpha ជ្រុងមូលរបស់វីដេអូកណ្តាល


def fit_blur_filter(strength: int | None = None) -> str:
    """`boxblur` តាមកម្លាំង 0-100 (33 = `boxblur=20:5` ដើម); 0 = គ្មាន blur ("")."""
    strength = config.FIT_BLUR_STRENGTH if strength is None else strength
    radius = round(max(0, min(100, strength)) * 0.6)
    return f"boxblur={radius}:5" if radius > 0 else ""


def fit_background(source: str, label: str, out_width: int, out_height: int) -> str:
    """ផ្ទៃខាងក្រោយរបស់ Fit ពី `[source]` (ច្បាប់ចម្លងវីដេអូ) ទៅ `[label]`.

    blur = វីដេអូ scale ឲ្យ**គ្រប** រួច crop និង blur; color = វីដេអូដដែលលាបពណ៌ពេញ (រក្សាពេល
    របស់ shot); image = រូបតែមួយលើផ្ទៃនោះ (`overlay` ធ្វើ frame ចុងក្រោយម្តងទៀតរហូត).
    """
    cover = (f"scale={out_width}:{out_height}:force_original_aspect_ratio=increase,"
             f"crop={out_width}:{out_height}")
    kind = config.FIT_BACKGROUND
    if kind == "color":
        colour = "#%02x%02x%02x" % background_rgb(config.FIT_COLOR)
        return (f"[{source}]scale={out_width}:{out_height},"
                f"drawbox=x=0:y=0:w=iw:h=ih:color={colour}:t=fill[{label}];")
    if kind == "image" and config.FIT_IMAGE:
        return (f"movie={FIT_IMAGE_FILE},{cover},format=yuv420p[{label}i];"
                f"[{source}]scale={out_width}:{out_height}[{label}b];"
                f"[{label}b][{label}i]overlay=0:0[{label}];")
    blur = fit_blur_filter()
    return f"[{source}]{cover}{',' + blur if blur else ''}[{label}];"


def fit_foreground_size(source_w: int, source_h: int, out_width: int, out_height: int) -> tuple[int, int]:
    """ទំហំវីដេអូកណ្តាលក្នុង Fit ពេលមាន spacing: ដាក់ឲ្យ**ចូល**ក្នុងផ្ទៃដែលនៅសល់ (លេខគូ).

    ឧ. 1280x720 ចូល 1080x1920 ជាមួយ spacing 10% -> ផ្ទៃ 864x1536 -> 864x486.
    """
    room = 1 - 2 * max(0, min(20, config.FIT_SPACING)) / 100
    scale = min(out_width * room / source_w, out_height * room / source_h)
    return int(source_w * scale) // 2 * 2, int(source_h * scale) // 2 * 2


def fit_mask(size: tuple[int, int], path: Path, radius: int | None = None) -> Path | None:
    """PNG ប្រផេះ ទំហំ `size`: ស = ឃើញ, ខ្មៅ = ជ្រុងដែលកាត់ចេញ (alpha របស់វីដេអូកណ្តាល)."""
    radius = config.FIT_RADIUS if radius is None else radius
    width, height = size
    r = min(radius, width // 2, height // 2)
    if r <= 0:
        return None

    import numpy as np

    ys, xs = np.ogrid[0:height, 0:width]
    alpha = np.full((height, width), 255, dtype=np.uint8)
    for cx, cy in ((r, r), (width - r - 1, r), (r, height - r - 1), (width - r - 1, height - r - 1)):
        near_x = (xs < r) if cx == r else (xs > width - r - 1)
        near_y = (ys < r) if cy == r else (ys > height - r - 1)
        outside = (xs - cx) ** 2 + (ys - cy) ** 2 > r * r
        alpha[near_x & near_y & outside] = 0
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{width}x{height}", "-i", "-",
         "-frames:v", "1", str(path)],
        input=alpha.tobytes(), check=True,
    )
    return path


def fit_styled() -> bool:
    """Fit ត្រូវការទំហំគណនារួច (spacing ឬជ្រុងមូល) ឬទេ."""
    return config.FIT_SPACING > 0 or config.FIT_RADIUS > 0


def layout_chain(layout: Layout, index: int, source_label: str, out_label: str,
                 suffix: str = "", out_width: int | None = None,
                 out_height: int | None = None, mask_label: str | None = None,
                 fit_size: tuple[int, int] | None = None) -> str:
    """ផ្នែក filtergraph ដែលបម្លែង `[source_label]` ទៅ `[out_label]` តាម layout.

    Split ត្រូវការ `split` (ចម្លង stream ជាពីរ) រួច crop ខុសគ្នា រួច `vstack`
    (ដាក់ជាន់គ្នាបញ្ឈរ)។ ផ្ទាំងនីមួយៗខ្ពស់ពាក់កណ្តាលលទ្ធផល។

    `index` ធ្វើឲ្យឈ្មោះ label មិនជាន់គ្នាពេលយើងដាក់ chain ច្រើនក្នុង graph តែមួយ។
    """
    out_width = out_width or config.OUT_WIDTH
    out_height = out_height or config.OUT_HEIGHT

    if layout.panels:
        # output បញ្ឈរ/ការ៉េ -> ជាន់គ្នាបញ្ឈរ (vstack); output ផ្ដេក -> ឆ្វេង/ស្តាំ (hstack);
        # ៤ ផ្ទាំង -> ក្រឡា 2×2 (`xstack`)។ ផ្ទាំង 1920×540 នៅលើ 16:9 រាក់ពេក
        # ដូច្នេះទិសត្រូវប្តូរតាម output។
        rects = panel_rects(layout.kind)
        count = min(len(layout.panels), len(rects))

        parts = [f"[{source_label}]split={count}" +
                 "".join(f"[p{index}_{i}]" for i in range(count))]
        gap = max(0, config.PANEL_GAP)
        for i, (box, rect) in enumerate(zip(layout.panels, rects)):
            _, _, panel_w, panel_h = rect
            inner_w, inner_h = panel_inner(rect)
            # រូបតូចជាងផ្ទាំង រួច `pad` បំពេញគម្លាតដោយពណ៌ផ្ទៃខាងក្រោយ (card)
            frame = (f",pad={panel_w}:{panel_h}:{(panel_w - inner_w) // 2}:"
                     f"{(panel_h - inner_h) // 2}:color={config.PANEL_BACKGROUND}"
                     if gap else "")
            parts.append(f"[p{index}_{i}]{box.as_filter()},"
                         f"scale={inner_w}:{inner_h}:flags=lanczos{frame}[q{index}_{i}]")

        joined = "".join(f"[q{index}_{i}]" for i in range(count))
        columns = {x for x, _, _, _ in rects[:count]}
        rows = {y for _, y, _, _ in rects[:count]}
        if len(columns) == 1:
            stack = f"vstack=inputs={count}"          # ជួរឈរតែមួយ
        elif len(rows) == 1:
            stack = f"hstack=inputs={count}"          # ជួរដេកតែមួយ
        else:
            # ទំហំផ្ទាំងមិនស្មើគ្នា (ឧ. three = ធំ ១ + តូច ២) -> ដាក់តាម pixel
            spots = "|".join(f"{x}_{y}" for x, y, _, _ in rects[:count])
            stack = f"xstack=inputs={count}:layout={spots}"
        if mask_label:
            # mask លាបជ្រុងមូល — ដាក់ **មុន** caption ដើម្បីកុំកាត់អក្សរ
            parts.append(f"{joined}{stack},setsar=1[k{index}]")
            parts.append(f"[k{index}][{mask_label}]overlay=0:0{suffix}[{out_label}]")
        else:
            parts.append(f"{joined}{stack},setsar=1{suffix}[{out_label}]")
        return ";".join(parts)

    if layout.kind == "fit":
        # រូបពេញនៅកណ្តាល + ផ្ទៃខាងក្រោយ (blur / ពណ៌ / រូប) — slide មិនត្រូវកាត់។
        background = fit_background(f"f{index}", f"bg{index}", out_width, out_height)
        if fit_size is None:
            foreground = f"[g{index}]scale={out_width}:-2:flags=lanczos[fg{index}];"
        else:
            # spacing / ជ្រុងមូល: ទំហំគណនារួច (ត្រូវគ្នានឹង mask) ហើយ alpha ពី mask
            fg_w, fg_h = fit_size
            foreground = f"[g{index}]scale={fg_w}:{fg_h}:flags=lanczos"
            if config.FIT_RADIUS > 0:
                foreground += (f",format=yuva420p[r{index}];movie={FIT_MASK_FILE},format=gray[a{index}];"
                               f"[r{index}][a{index}]alphamerge")
            foreground += f"[fg{index}];"
        return (
            f"[{source_label}]split=2[f{index}][g{index}];"
            f"{background}"
            f"{foreground}"
            f"[bg{index}][fg{index}]overlay=(W-w)/2:(H-h)/2,"
            f"setsar=1{suffix}[{out_label}]"
        )

    if layout.kind == "custom" and layout.place and layout.box:
        # Transform ដោយដៃ: crop -> scale -> overlay នៅ (x, y) លើ background របស់ Fit (ដាក់ក្រៅ
        # អេក្រង់បាន: overlay កាត់ផ្នែកដែលចេញក្រៅ); ជ្រុងមូលដូច Fit (mask ទំហំ fg)
        fg_w, fg_h, left, top = layout.place
        background = fit_background(f"f{index}", f"bg{index}", out_width, out_height)
        foreground = f"[g{index}]{layout.box.as_filter()},scale={fg_w}:{fg_h}:flags=lanczos"
        if config.FIT_RADIUS > 0:
            foreground += (f",format=yuva420p[r{index}];movie={FIT_MASK_FILE},format=gray[a{index}];"
                           f"[r{index}][a{index}]alphamerge")
        return (
            f"[{source_label}]split=2[f{index}][g{index}];"
            f"{background}"
            f"{foreground}[fg{index}];"
            f"[bg{index}][fg{index}]overlay={left}:{top},"
            f"setsar=1{suffix}[{out_label}]"
        )

    box = layout.box
    if box is None:
        raise RenderError(f"layout '{layout.kind}' គ្មានប្រអប់ crop")
    if box.x_expr:
        return (f"[{source_label}]{moving_crop(box, out_width, out_height)},"
                f"setsar=1{suffix}[{out_label}]")
    return (f"[{source_label}]{box.as_filter()},"
            f"scale={out_width}:{out_height}:flags=lanczos,setsar=1{suffix}[{out_label}]")


def moving_crop(box: Box, out_width: int, out_height: int) -> str:
    """Crop ដែលរំកិល: **scale មុន រួច crop** ដើម្បីឲ្យការរំកិលរលូន.

    `crop` លើ yuv420p រំកិលបានតែ 2 pixel គត់ៗ។ បើ crop លើរូបដើម (720p) រួចពង្រីក 2.67x
    ការរំកិល 12 px/s ក្លាយជា "នៅនឹង 3 frame រួចលោត 4.8 px" (វាស់លើរូបនឹង) — ញ័រ។
    Scale រូបទាំងមូលទៅកម្ពស់ output មុន ធ្វើឲ្យជំហាននោះនៅលើ pixel output វិញ: រំកិលរាល់
    frame។ ថ្លៃជាង (scale រូបទាំងមូល) ប៉ុន្តែតែ shot ដែលរំកិលប៉ុណ្ណោះ។
    """
    k = out_height / box.h                       # កត្តាពង្រីក ឧ. 1920/720 = 2.667
    # +1 មុន trunc: 720*2.6666 អាចចេញ 1919.9999 ហើយ trunc ធ្វើឲ្យខ្វះ 2 px
    scale = (f"scale=trunc((iw*{k:.6f}+1)/2)*2:trunc((ih*{k:.6f}+1)/2)*2"
             f":flags=lanczos")
    # crop ខ្លួនវាកាត់ x ឲ្យនៅក្នុងរូបជានិច្ច ដូច្នេះមិនបាច់ clamp ទៀតទេ។
    # `exact=1` = រំកិលម្តង 1 px (មិនបង្គត់ទៅលេខគូ): រូបនឹងនៅនឹងតែ 0/47 frame ជំនួស 15/47
    return (f"{scale},crop={out_width}:{out_height}:"
            f"x='({box.x_expr})*{k:.6f}':y={round(box.y * k)}:exact=1")


def sharpen_suffix() -> str:
    """filter សម្អិតរូប ដែលដាក់ **ក្រោយ** ការពង្រីក និង **មុន** ការដុត caption.

    ការពង្រីក 2.8x ពី 720p ធ្វើឲ្យរូបទន់។ `unsharp` មិនបង្កើតព័ត៌មានថ្មីទេ តែវា
    បន្ថែមកម្រិតពណ៌នៅគែម ដែលភ្នែកអានថា "ច្បាស់"។ ដាក់មុន caption ដើម្បីកុំឲ្យ
    អក្សរដែលមុតស្រាប់ក្លាយជាមានគែមរឹង។
    """
    return f",{config.SHARPEN}" if config.SHARPEN else ""


def build_layout_filter(layout: Layout, ass_filename: str | None = None,
                        out_width: int | None = None, out_height: int | None = None,
                        mask_label: str | None = None,
                        fit_size: tuple[int, int] | None = None, motion: str = "") -> str:
    """filtergraph សម្រាប់ layout តែមួយ (clip ដែលមិនមានការកាត់ camera).

    `motion` (filter `perspective` ពី `pipeline.motion`) ដាក់ក្រោយ layout និងមុន caption.
    """
    burn = f",ass={ass_filename}" if ass_filename else ""
    if motion:
        chain = layout_chain(layout, 0, "0:v", "lm", "", out_width, out_height, mask_label, fit_size)
        return f"{chain};[lm]{motion}{sharpen_suffix()}{burn}[v]"
    return layout_chain(layout, 0, "0:v", "v", sharpen_suffix() + burn,
                        out_width, out_height, mask_label, fit_size)


def mask_kinds(segments: list[Segment]) -> list[str]:
    """ប្រភេទ layout ដែលត្រូវការ mask ជ្រុងមូល (តាមលំដាប់ស្ថិរ)."""
    if config.PANEL_CORNER_RADIUS <= 0 or config.PANEL_GAP <= 0:
        return []
    seen = []
    for segment in segments:
        kind = segment.layout.kind
        if segment.layout.panels and kind not in seen:
            seen.append(kind)
    return seen


TRIM_EARLY_SEC = 0.001   # តិចជាង frame មួយឆ្ងាយ (24 fps = 42 ms)


def trim_time(seconds: float) -> float:
    """ពេលសម្រាប់ `trim`: មុនការកាត់ 1 ms ដើម្បីឲ្យ frame ដំបូងនៃ shot ថ្មីចូល shot ថ្មី.

    ការកាត់ camera ធ្លាក់ចំ pts របស់ frame (ឧ. frame 152 = 6.339667 s)។ `trim` ទុក frame
    ដែល pts >= start។ ពីមុនយើងសរសេរ `6.340` (បង្គត់ 3 ខ្ទង់ឡើងលើ) -> frame 152 នៅជាប់ shot
    មុន ហើយបង្ហាញជាមួយ crop ចាស់ ១ frame — លោតពេលប្តូរ shot (វាស់: 7 ក្នុង 12 ការកាត់)។
    Start និង end ថយដូចគ្នា ដូច្នេះ shot តៗគ្នានៅភ្ជាប់គ្នាបេះបិទ គ្មាន frame បាត់។
    """
    return max(0.0, seconds - TRIM_EARLY_SEC)


def build_segments_filter(segments: list[Segment], clip_start: float,
                          ass_filename: str | None = None,
                          out_width: int | None = None,
                          out_height: int | None = None,
                          masks: dict[str, int] | None = None,
                          fit_size: tuple[int, int] | None = None,
                          motions: list[str] | None = None) -> str:
    """filtergraph តែមួយដែលដោះស្រាយ shot ទាំងអស់ក្នុង clip — encode តែម្តង.

    **ហេតុអ្វីមិន render ដាច់ៗរួច concat?** យើងបានសាកវិធីនោះ ហើយរាល់កន្លែងភ្ជាប់
    បាត់ frame ១ (គម្លាត 83ms ជំនួស 42ms) ព្រោះ timestamp ត្រូវបង្គត់។ ម្យ៉ាងទៀត
    វា encode ២ ដង (បាត់បង់គុណភាព + យឺត)។

    វិធីនេះ: `split` ចម្លង stream ទៅគ្រប់ shot, `trim` កាត់ចន្លោះពេលរបស់ shot នីមួយៗ,
    `setpts=PTS-STARTPTS` ចាប់ផ្តើមពេលឡើងវិញពី 0 (បើមិនដូច្នោះ concat នឹងច្រឡំ),
    រួច `concat` ភ្ជាប់វិញ។ លទ្ធផល: decode ម្តង, encode ម្តង, គ្មាន frame បាត់។

    សំឡេងមិនត្រូវប៉ះទេ — shot តៗគ្នាគ្របដណ្តប់ clip ទាំងមូល ដូច្នេះវានៅ sync ស្រាប់។
    """
    masks = masks or {}
    if len(segments) == 1:
        label = f"{masks[segments[0].layout.kind]}:v" if segments[0].layout.kind in masks else None
        return build_layout_filter(segments[0].layout, ass_filename,
                                   out_width, out_height, label, fit_size,
                                   motions[0] if motions else "")

    count = len(segments)
    parts = ["[0:v]split=" + str(count) + "".join(f"[s{i}]" for i in range(count))]

    # mask មួយអាចប្រើបានតែម្តង -> `split` តាមចំនួន segment ដែលត្រូវការវា
    mask_labels: dict[str, list[str]] = {}
    for kind, input_index in masks.items():
        uses = sum(1 for s in segments if s.layout.kind == kind and s.layout.panels)
        if uses <= 0:
            continue
        if uses == 1:
            mask_labels[kind] = [f"{input_index}:v"]
        else:
            labels = [f"m{input_index}_{i}" for i in range(uses)]
            parts.append(f"[{input_index}:v]split={uses}" +
                         "".join(f"[{label}]" for label in labels))
            mask_labels[kind] = labels

    for index, segment in enumerate(segments):
        start = trim_time(segment.start - clip_start)
        end = max(start, trim_time(segment.end - clip_start))
        parts.append(
            f"[s{index}]trim=start={start:.6f}:end={end:.6f},setpts=PTS-STARTPTS[p{index}]"
        )
        label = None
        if segment.layout.panels and segment.layout.kind in mask_labels:
            label = mask_labels[segment.layout.kind].pop(0)
        motion = motions[index] if motions else ""
        parts.append(layout_chain(segment.layout, index, f"p{index}", f"m{index}" if motion else f"v{index}",
                                  out_width=out_width, out_height=out_height,
                                  mask_label=label, fit_size=fit_size))
        if motion:
            parts.append(f"[m{index}]{motion}[v{index}]")

    burn = f",ass={ass_filename}" if ass_filename else ""
    joined = "".join(f"[v{i}]" for i in range(count))
    # សម្អិតម្តងក្រោយ concat (មិនមែនក្នុងមួយ shot) — លទ្ធផលដូចគ្នា តែលឿនជាង
    parts.append(f"{joined}concat=n={count}:v=1:a=0{sharpen_suffix()}{burn}[v]")
    return ";".join(parts)


# ---------- ជ្រុងមូលរបស់ផ្ទាំង (card style) ----------

NAMED_COLOURS = {"white": (255, 255, 255), "black": (0, 0, 0),
                 "gray": (128, 128, 128), "grey": (128, 128, 128)}


def background_rgb(colour: str | None = None) -> tuple[int, int, int]:
    """បម្លែងឈ្មោះពណ៌ ឬ #RRGGBB ទៅជា (r, g, b)."""
    text = (colour or config.PANEL_BACKGROUND or "white").strip().lower()
    if text in NAMED_COLOURS:
        return NAMED_COLOURS[text]
    text = text.lstrip("#").removeprefix("0x")
    if len(text) == 6:
        return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))
    return (255, 255, 255)


def corner_mask(kind: str, path: Path, radius: int | None = None) -> Path | None:
    """សរសេរ PNG ដែលមាន **តែជ្រុង** នៃផ្ទាំងនីមួយៗ (នៅសល់ថ្លា).

    ហេតុអ្វីជា mask? `geq` គណនាកន្សោមក្នុង **មួយ pixel មួយ frame** — លើ
    1080×1920 × 780 frame វាយឺតខ្លាំង។ Mask គណនាម្តង រួច `overlay` ថោក។
    គម្លាតរវាងផ្ទាំងត្រូវបានលាបដោយ `pad` រួចហើយ ដូច្នេះ mask គ្រាន់តែបំពេញជ្រុង។
    """
    radius = config.PANEL_CORNER_RADIUS if radius is None else radius
    rects = panel_rects(kind)
    if radius <= 0 or not rects:
        return None

    import numpy as np

    width, height = config.OUT_WIDTH, config.OUT_HEIGHT
    red, green, blue = background_rgb()
    canvas = np.zeros((height, width, 4), dtype=np.uint8)
    canvas[:, :, 0], canvas[:, :, 1], canvas[:, :, 2] = red, green, blue

    ys, xs = np.ogrid[0:height, 0:width]
    for rect in rects:
        panel_x, panel_y, panel_w, panel_h = rect
        inner_w, inner_h = panel_inner(rect)
        x0 = panel_x + (panel_w - inner_w) // 2
        y0 = panel_y + (panel_h - inner_h) // 2
        x1, y1 = x0 + inner_w, y0 + inner_h
        r = min(radius, inner_w // 2, inner_h // 2)

        inside = (xs >= x0) & (xs < x1) & (ys >= y0) & (ys < y1)
        rounded = inside.copy()
        for corner_x, corner_y in ((x0 + r, y0 + r), (x1 - r - 1, y0 + r),
                                   (x0 + r, y1 - r - 1), (x1 - r - 1, y1 - r - 1)):
            near_x = (xs < x0 + r) if corner_x == x0 + r else (xs > x1 - r - 1)
            near_y = (ys < y0 + r) if corner_y == y0 + r else (ys > y1 - r - 1)
            outside_circle = (xs - corner_x) ** 2 + (ys - corner_y) ** 2 > r * r
            rounded &= ~(near_x & near_y & outside_circle)
        canvas[:, :, 3] = np.where(inside & ~rounded, 255, canvas[:, :, 3])

    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{width}x{height}", "-i", "-",
         "-frames:v", "1", str(path)],
        input=canvas.tobytes(), check=True,
    )
    return path


def _encode_args(crf: int, preset: str) -> list[str]:
    name, video = encoder_args()
    # keyframe តាមពេល (មិនមែនតាមចំនួន frame) ដូច្នេះដូចគ្នាទាំង 24, 29.97 ឬ 60 fps.
    # NVENC: `-forced-idr 1` ធ្វើឲ្យ keyframe ទាំងនោះជា IDR — decoder ចាប់ផ្តើមពីវាបានដោយមិនពឹង frame មុន.
    keyframes = ["-force_key_frames", f"expr:gte(t,n_forced*{config.KEYFRAME_SEC})"]
    if name == "nvenc":
        keyframes += ["-forced-idr", "1"]
    return [
        *video, *keyframes, "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", config.AUDIO_BITRATE,
        "-movflags", "+faststart",      # metadata នៅដើម file -> ចាប់ផ្តើមលេងលឿន
    ]


def _run_ffmpeg(cmd: list[str], cwd: Path, what: str) -> None:
    result = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(cwd),
    )
    if result.returncode != 0:
        raise RenderError(f"FFmpeg បរាជ័យ ({what}):\n{result.stderr.strip()[-800:]}")


# Windows កំណត់ command line ត្រឹម 32768 តួ។ Video វែងផ្តល់ filtergraph ធំជាងនោះ
# (47 នាទី -> 360 shots -> ~55KB) ហើយ FFmpeg ដាច់ដោយ WinError 206។
FILTER_INLINE_LIMIT = 8000


def render_segments(video_path: Path, clip: Clip, segments: list[Segment],
                    out_path: Path, ass_filename: str | None = None,
                    motion_cues=None) -> Path:
    """Render clip ទាំងមូល (shot ច្រើន) ដោយ FFmpeg **តែម្តង**."""
    require_ffmpeg("ffmpeg")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # mask ជ្រុងមូល: ១ file ក្នុងមួយប្រភេទ layout, ជា input បន្ថែមរបស់ FFmpeg
    mask_files: list[Path] = []
    masks: dict[str, int] = {}
    for kind in mask_kinds(segments):
        path = corner_mask(kind, out_path.parent / f".mask_{kind}.png")
        if path is not None:
            masks[kind] = len(mask_files) + 1      # [0:v] ជា video ដើម
            mask_files.append(path)

    # Fit: រូប background និង mask ជ្រុងមូល ជា file ក្នុង folder render (`movie=` អានពី cwd)
    extra_files: list[Path] = []
    fit_size = None
    if any(segment.layout.kind in ("fit", "custom") for segment in segments):
        if config.FIT_BACKGROUND == "image" and config.FIT_IMAGE:
            image = out_path.parent / FIT_IMAGE_FILE
            # PNG ជានិច្ច: FFmpeg បម្លែង jpg/webp ម្តង — ឈ្មោះ file ថេរ គ្មានតួពិសេស
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                            "-i", str(Path(config.FIT_IMAGE).resolve()), "-frames:v", "1", str(image)],
                           check=True)
            extra_files.append(image)
        custom = next((s.layout.place for s in segments if s.layout.kind == "custom"), None)
        if custom is not None:
            # Transform: mask ជ្រុងមូលទំហំវីដេអូដែលដាក់ដោយដៃ (fit_size មិនប្រើ)
            mask = fit_mask(custom[:2], out_path.parent / FIT_MASK_FILE)
            if mask is not None:
                extra_files.append(mask)
        elif fit_styled():
            fit_size = fit_foreground_size(*probe_dimensions(video_path),
                                           config.OUT_WIDTH, config.OUT_HEIGHT)
            mask = fit_mask(fit_size, out_path.parent / FIT_MASK_FILE)
            if mask is not None:
                extra_files.append(mask)

    # Motion: filter perspective មួយក្នុងមួយ shot (ពេលធៀបនឹងដើម clip)
    from pipeline import motion
    motions = None
    if motion.enabled():
        from pipeline.cuts import frame_rate
        fps = frame_rate(video_path)
        motions = [motion.motion_filter(s.start - clip.start, s.end - clip.start, motion_cues, fps,
                                        config.OUT_WIDTH, config.OUT_HEIGHT) for s in segments]

    graph = build_segments_filter(segments, clip.start, ass_filename, masks=masks,
                                  fit_size=fit_size, motions=motions)

    # filtergraph វែង -> សរសេរទៅ file រួចឲ្យ FFmpeg អានពីទីនោះ
    script = None
    if len(graph) > FILTER_INLINE_LIMIT:
        script = out_path.parent / f".{out_path.stem}_filter.txt"
        script.write_text(graph, encoding="utf-8")
        filter_args = ["-/filter_complex", script.name]
    else:
        filter_args = ["-filter_complex", graph]

    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-ss", f"{clip.start:.3f}",
        "-i", str(Path(video_path).resolve()),
        # mask ត្រូវមក **មុន** `-t` បើមិនដូច្នោះ `-t` ក្លាយជា option របស់ mask
        *[arg for path in mask_files for arg in ("-i", path.name)],
        "-t", f"{clip.duration:.3f}",
        *filter_args,
        "-map", "[v]", "-map", "0:a?",
        *_encode_args(config.VIDEO_CRF, config.VIDEO_PRESET),
        out_path.name,
    ]
    try:
        _run_ffmpeg(cmd, out_path.parent, f"'{clip.title}' ({len(segments)} shots)")
    finally:
        if script is not None:
            script.unlink(missing_ok=True)
        for path in mask_files + extra_files:
            path.unlink(missing_ok=True)
    return out_path


def render_clip(
    video_path: Path,
    clip: Clip,
    out_path: Path,
    ass_path: Path | None = None,
    *,
    segments: list[Segment] | None = None,
    force: bool = False,
    motion_cues=None,
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
                    ass_filename=ass_path.name if ass_path else None, motion_cues=motion_cues)

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
    suffix: str = "",
    motion_cues: list | None = None,
) -> list[Path]:
    """Render គ្រប់ clip ទៅ `out_dir/clip_01.mp4` ...។

    `suffix="_clean"` -> `clip_01_clean.mp4` (preview គ្មាន caption របស់ screen Subtitles)
    ដូច្នេះ `clip_01.mp4` ដែលមាន caption មិនត្រូវបានប៉ះ។
    """
    out_dir = Path(out_dir)
    results: list[Path] = []

    for index, clip in enumerate(clips, start=1):
        if on_progress:
            on_progress(index, len(clips), clip)
        ass_path = None
        if ass_paths is not None and index <= len(ass_paths):
            ass_path = ass_paths[index - 1]
        segments = plans[index - 1] if plans is not None and index <= len(plans) else None
        cues = motion_cues[index - 1] if motion_cues and index <= len(motion_cues) else None
        results.append(render_clip(
            video_path, clip, out_dir / f"clip_{index:02d}{suffix}.mp4", ass_path,
            segments=segments, force=force, motion_cues=cues,
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
