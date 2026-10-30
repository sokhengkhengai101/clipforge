"""ClipForge Studio — CLI entry point.

Phase 0: ជំហាន 1 (audio) + 2 (transcribe) + 3 (highlights) រួចរាល់។ ជំហាន 4-6 នៅសល់។
Usage: python make_clips.py video.mp4 --max-clips 5
"""

import json
import time
from pathlib import Path

import typer
from rich.console import Console
from rich.progress import BarColumn, Progress, TextColumn, TimeElapsedColumn
from rich.table import Table

import config
from pipeline.audio import FFmpegError, extract_audio, probe_duration
from pipeline.boundaries import clip_text, snap_boundaries
from pipeline.captions import (CaptionError, build_all_captions, check_cues, resolve_font,
                               wrap_into_cues)
from pipeline.highlights import (HighlightsError, find_highlights, full_video_clip,
                                 load_clips, rank_clips, save_clips)
from pipeline.llm import LLMError
from pipeline.reframe import (ReframeError, describe, find_seats, parse_layouts, plan_clip,
                             save_layout_summary)
from pipeline.render import (RenderError, encoder_args, probe_dimensions, render_all,
                             verify_clip)
from pipeline.transcribe import TranscribeError, load_transcript, transcribe

config.enable_utf8_output()  # ត្រូវហៅមុន Console() ដើម្បីឲ្យ rich ចាំ encoding ត្រឹមត្រូវ

class _SkipSelection(Exception):
    """សញ្ញាខាងក្នុង: `--full` មិនត្រូវការការជ្រើស clip ទេ."""


app = typer.Typer(add_completion=False, help="បង្កើត vertical clips ពី video វែង")
console = Console()

# ជំហាននីមួយៗនៃ pipeline (សរសេរកូដម្តងមួយជំហាន)
STEPS = [
    ("audio", "extract audio -> WAV 16kHz mono"),
    ("transcribe", "faster-whisper -> segments + word timestamps"),
    ("highlights", "LLM -> clips JSON (validated)"),
    ("boundaries", "snap ទៅ sentence + padding"),
    ("captions", "build .ass subtitle"),
    ("render", "FFmpeg -> 1080x1920 MP4 + burned captions"),
]


def short_path(p: Path) -> Path:
    """path ខ្លីធៀបនឹង project root — path ពេញវែងពេក ធ្វើឲ្យ terminal wrap."""
    return p.relative_to(config.PROJECT_ROOT) if p.is_relative_to(config.PROJECT_ROOT) else p


def mmss(seconds: float) -> str:
    """12.5 -> "0:12" ; 185.0 -> "3:05" (អានងាយជាងវិនាទីសុទ្ធ)."""
    return f"{int(seconds) // 60}:{int(seconds) % 60:02d}"


def clips_table(clips: list) -> Table:
    """តារាង clip សម្រាប់បង្ហាញក្នុង terminal."""
    table = Table(show_header=True, header_style="bold", box=None, padding=(0, 1))
    table.add_column("#", width=2, justify="right")
    table.add_column("ពេល", width=13)
    table.add_column("វិ.", width=4, justify="right")
    table.add_column("score", width=7, justify="right")
    table.add_column("H/F/V", width=10)
    table.add_column("type", width=10)
    table.add_column("title")
    for i, clip in enumerate(clips, start=1):
        grades = ("/".join(d.letter for d in (clip.grades.hook, clip.grades.flow,
                                              clip.grades.value))
                  if clip.grades else "-")
        table.add_row(
            str(i),
            f"{mmss(clip.start)} - {mmss(clip.end)}",
            f"{clip.duration:.0f}",
            f"{clip.total:.0f} {clip.letter}",
            grades,
            clip.type,
            clip.title,
        )
    return table


# ពេល sidecar រត់ script នេះជា subprocess (stdout = pipe មិនមែន terminal) progress bar របស់ rich
# មិនបង្ហាញទេ ហើយ UI មិនដឹងថា transcribe ទៅដល់ណា — កាតបង្ហាញតែ % ប៉ាន់ស្មាន ហើយឈប់នៅ 24%
# លើវីដេអូ 47 នាទី (transcribe យឺតជាងល្បឿនដែលវាស់ពីមុន). ដូច្នេះយើងសរសេរបន្ទាត់សាមញ្ញ
# "progress <ជំហាន> <ចប់> <សរុប>" ដែល server/jobs.py អាន. ម្តងក្នុង 3 s យ៉ាងច្រើន (+ ចុងក្រោយ).
PROGRESS_EVERY_SEC = 3.0
_last_report: dict[str, float] = {}


def report_progress(step: str, done: float, total: float) -> None:
    if console.is_terminal or total <= 0:
        return                                  # terminal មាន progress bar រួចហើយ
    now = time.monotonic()
    if done < total and now - _last_report.get(step, -PROGRESS_EVERY_SEC) < PROGRESS_EVERY_SEC:
        return
    _last_report[step] = now
    print(f"progress {step} {done:.1f} {total:.1f}", flush=True)


def progress_columns(label: str) -> list:
    return [
        TextColumn(f"[cyan]{label}[/cyan]"),
        BarColumn(),
        TextColumn("{task.percentage:>3.0f}%"),
        TimeElapsedColumn(),
    ]


@app.command()
def main(
    video: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True,
                                 help="path ទៅ video ដើម (មិនត្រូវកែវាទេ)"),
    max_clips: int = typer.Option(config.MAX_CLIPS, "--max-clips", help="ចំនួន clip ចេញ"),
    model: str = typer.Option(config.OLLAMA_MODEL, "--model", help="Ollama model សម្រាប់ highlights"),
    whisper_model: str = typer.Option(None, "--whisper-model",
                                      help="override Whisper model (tiny/base/small/medium/large-v3)"),
    force: bool = typer.Option(False, "--force", help="ធ្វើថ្មីទាំងអស់ (ដូច --redo all)"),
    redo: str = typer.Option("", "--redo",
                             help="ជំហានដែលត្រូវធ្វើថ្មី: audio, transcribe, highlights, render, all"),
    layout: str = typer.Option("auto", "--layout",
                               help="layout ដែលអនុញ្ញាត (បញ្ជីបំបែកដោយ ,): "
                                    "auto | fill/face | split | center — ឧ. --layout fill,split"),
    aspect: str = typer.Option("9:16", "--aspect",
                               help="សមាមាត្រ output: 9:16, 4:5, 1:1, 16:9"),
    caption_words: int = typer.Option(config.CAPTION_MAX_WORDS_PER_CUE, "--caption-words",
                                      help="ពាក្យអតិបរមាក្នុងមួយ cue (2-8)"),
    panel_gap: int = typer.Option(config.PANEL_GAP, "--panel-gap",
                                  help="គម្លាតរវាងផ្ទាំង split/three/four ជា px (0 = ជាប់គ្នា)"),
    panel_color: str = typer.Option(config.PANEL_BACKGROUND, "--panel-color",
                                    help="ពណ៌គម្លាតផ្ទាំង (ឈ្មោះ ឬ #RRGGBB)"),
    caption_color: str = typer.Option(config.CAPTION_KEYWORD_COLOR, "--caption-color",
                                      help="ពណ៌ពាក្យសកម្ម: yellow, green, cyan, orange, "
                                           "white ឬ #RRGGBB"),
    caption_size: int = typer.Option(100, "--caption-size",
                                     help="ទំហំ caption ជា % (70-120)"),
    caption_outline: int = typer.Option(config.CAPTION_OUTLINE, "--caption-outline",
                                        help="កម្រាស់គ្រោងខ្មៅ px (0-8)"),
    caption_case: str = typer.Option("upper", "--caption-case",
                                     help="upper (អក្សរធំ) ឬ original (ដូចដែលនិយាយ)"),
    caption_position: str = typer.Option("auto", "--caption-position",
                                         help="auto (lower third / ស្នាម split), top, middle, bottom"),
    clean_only: bool = typer.Option(False, "--clean-only",
                                    help="render តែ clip_XX_clean.mp4 (គ្មាន caption) សម្រាប់ "
                                         "preview — មិនប៉ះ clip_XX.mp4 ឬ .ass/.srt/.vtt"),
    cuts: Path = typer.Option(None, "--cuts", exists=True, dir_okay=False,
                              help="cut list (JSON) — លុបចន្លោះទាំងនេះ ហើយ inserts (ផ្នែកដែលបន្ថែម) (Edit Video); ត្រូវការ --full"),
    transition: str = typer.Option("punch", "--transition",
                                   help="នៅកន្លែងកាត់: punch (zoom 100/110% ឆ្លាស់) ឬ hard"),
    transcribe_only: bool = typer.Option(False, "--transcribe-only",
                                         help="audio + transcribe ប៉ុណ្ណោះ (screen Edit Video) — គ្មាន LLM គ្មាន render"),
    fit_background: str = typer.Option(config.FIT_BACKGROUND, "--fit-background",
                                       help="ផ្ទៃខាងក្រោយ Fit: blur, color ឬ image"),
    fit_blur: int = typer.Option(config.FIT_BLUR_STRENGTH, "--fit-blur",
                                 help="កម្លាំង blur 0-100 (33 = លំនាំដើម)"),
    fit_color: str = typer.Option(config.FIT_COLOR, "--fit-color", help="ពណ៌ផ្ទៃ (#RRGGBB)"),
    fit_image: Path = typer.Option(None, "--fit-image", exists=True, dir_okay=False,
                                   help="រូប background (jpg/png/webp) — អានតែប៉ុណ្ណោះ"),
    fit_radius: int = typer.Option(config.FIT_RADIUS, "--fit-radius",
                                   help="ជ្រុងមូលរបស់វីដេអូកណ្តាល px (0-200)"),
    fit_spacing: int = typer.Option(config.FIT_SPACING, "--fit-spacing",
                                    help="ចន្លោះជុំវិញវីដេអូកណ្តាល % (0-20)"),
    transform: str = typer.Option(None, "--transform",
                                  help="Transform ដោយដៃ x,y,scale (ប្រភាគ: កណ្តាល x/y, ទទឹង/ទទឹង output) — ជំនួស AI layout"),
    transform_crop: str = typer.Option(None, "--transform-crop",
                                       help="crop វីដេអូដើមមុន transform x,y,w,h (ប្រភាគ 0-1)"),
    no_tracking: bool = typer.Option(False, "--no-tracking",
                                     help="crop មិនតាមមុខក្នុង shot (នៅស្ងៀម)"),
    no_track_ranges: Path = typer.Option(None, "--no-track-ranges", exists=True, dir_okay=False,
                                         help="JSON (បញ្ជីគូ start, end ជាវិនាទី) — shot ដែលជាន់ចន្លោះទាំងនេះ មិនតាមដាន"),
    subject_tracks: Path = typer.Option(None, "--subject-tracks", exists=True, dir_okay=False,
                                        help="JSON ផ្លូវប្រធានបទដែលជ្រើសដោយដៃ (Edit Video -> Manual subject tracking)"),
    motion_zoom: str = typer.Option(config.MOTION_ZOOM, "--motion-zoom",
                                    help="Motion: off, in (ពង្រីកយឺតៗក្នុង scene នីមួយៗ) ឬ out"),
    motion_zoom_amount: int = typer.Option(config.MOTION_ZOOM_AMOUNT, "--motion-zoom-amount",
                                           help="% zoom ក្នុងមួយ scene (1-20)"),
    motion_keywords: int = typer.Option(config.MOTION_KEYWORDS, "--motion-keywords",
                                        help="% zoom លើពាក្យសំខាន់ (0 = បិទ, 1-20)"),
    motion_shake: str = typer.Option(config.MOTION_SHAKE, "--motion-shake",
                                     help="camera shake: off, loud (ពេលសំឡេងខ្លាំង) ឬ all"),
    caption_font: str = typer.Option(None, "--caption-font",
                                     help="font caption (ឈ្មោះ face ឧ. 'Montserrat Black', 'Inter Bold')"),
    caption_text_color: str = typer.Option(None, "--caption-text-color", help="ពណ៌អក្សរ #RRGGBB"),
    caption_outline_color: str = typer.Option(None, "--caption-outline-color", help="ពណ៌គ្រោង #RRGGBB"),
    caption_italic: bool = typer.Option(False, "--caption-italic", help="អក្សរទ្រេត"),
    caption_underline: bool = typer.Option(False, "--caption-underline", help="គូសបន្ទាត់ក្រោម"),
    caption_shadow: str = typer.Option(None, "--caption-shadow", help="shadow x,y,blur,#RRGGBB"),
    caption_keywords: bool = typer.Option(False, "--caption-keywords",
                                          help="AI keywords highlighter: ពាក្យសំខាន់មានពណ៌ជានិច្ច"),
    caption_keyword_colors: str = typer.Option(None, "--caption-keyword-colors",
                                               help="ពណ៌ពាក្យសំខាន់ពីរ #RRGGBB,#RRGGBB"),
    caption_lines: int = typer.Option(None, "--caption-lines", help="បន្ទាត់អតិបរមាក្នុងមួយ cue (1-3)"),
    caption_animation: str = typer.Option(config.CAPTION_ANIMATION, "--caption-animation",
                                          help="caption លេចឡើង: pop, bounce, fade, slide ឬ none"),
    no_captions: bool = typer.Option(False, "--no-captions",
                                     help="render ដោយគ្មាន caption ដុត (.srt/.vtt នៅតែសរសេរ)"),
    encoder: str = typer.Option(config.VIDEO_ENCODER, "--encoder",
                                help="auto (GPU បើមាន), nvenc (GPU), x264 (CPU)"),
    full: bool = typer.Option(False, "--full",
                              help="render video ទាំងមូលជាបញ្ឈរ ១ file (រំលងការជ្រើស clip)"),
    language: str = typer.Option("auto", "--language",
                                 help="ភាសានិយាយ: auto (Whisper រកខ្លួនឯង) ឬ en, fr, es ..."),
) -> None:
    # --redo ដាច់ជំហាន ដើម្បីកុំឲ្យការកែ prompt បង្ខំ transcribe ៨ នាទីឡើងវិញ
    steps_to_redo = {name.strip().lower() for name in redo.split(",") if name.strip()}
    if force or "all" in steps_to_redo:
        steps_to_redo = {"audio", "transcribe", "highlights", "render"}
    unknown = steps_to_redo - {"audio", "transcribe", "highlights", "render"}
    if unknown:
        console.print(f"[red]--redo មិនស្គាល់: {', '.join(sorted(unknown))}[/red] "
                      f"(ប្រើ audio, transcribe, highlights, render ឬ all)")
        raise typer.Exit(code=2)
    redo_audio = "audio" in steps_to_redo
    redo_transcribe = "transcribe" in steps_to_redo
    redo_highlights = "highlights" in steps_to_redo
    redo_render = "render" in steps_to_redo

    # ភាសានិយាយ: auto = Whisper រកខ្លួនឯង (លំនាំដើម); code ផ្សេង = បង្ខំ Whisper
    language = language.strip().lower()
    if language != "auto" and language not in config.WHISPER_LANGUAGES:
        console.print(f"[red]--language មិនស្គាល់: {language}[/red] "
                      f"(ប្រើ auto ឬ {', '.join(config.WHISPER_LANGUAGES)})")
        raise typer.Exit(code=2)
    config.WHISPER_LANGUAGE = None if language == "auto" else language

    # menu Background / Tracker របស់ Edit Video
    if fit_background not in ("blur", "color", "image") or (fit_background == "image" and fit_image is None):
        console.print("[red]--fit-background ត្រូវជា blur, color ឬ image (image ត្រូវការ --fit-image)[/red]")
        raise typer.Exit(code=2)
    config.FIT_BACKGROUND = fit_background
    config.FIT_BLUR_STRENGTH = max(0, min(100, fit_blur))
    config.FIT_COLOR = fit_color
    config.FIT_IMAGE = str(fit_image) if fit_image else None
    config.FIT_RADIUS = max(0, min(200, fit_radius))
    config.FIT_SPACING = max(0, min(20, fit_spacing))
    if transform_crop and not transform:
        console.print("[red]--transform-crop ត្រូវការ --transform[/red]")
        raise typer.Exit(code=2)
    if transform:
        from pipeline.transform import TransformError, parse
        try:
            config.TRANSFORM = parse(transform, transform_crop)
        except TransformError as error:
            console.print(f"[red]{error}[/red]")
            raise typer.Exit(code=2)
    config.TRACKING = not no_tracking
    if no_track_ranges is not None:
        from pipeline.cuts import read_cut_list
        config.NO_TRACK_RANGES = [(float(a), float(b)) for a, b in read_cut_list(no_track_ranges)]

    if motion_zoom not in ("off", "in", "out") or motion_shake not in ("off", "loud", "all"):
        console.print("[red]--motion-zoom ត្រូវជា off/in/out, --motion-shake ត្រូវជា off/loud/all[/red]")
        raise typer.Exit(code=2)
    config.MOTION_ZOOM = motion_zoom
    config.MOTION_ZOOM_AMOUNT = max(1, min(20, motion_zoom_amount))
    config.MOTION_KEYWORDS = max(0, min(20, motion_keywords))
    config.MOTION_SHAKE = motion_shake
    if caption_animation not in config.CAPTION_ANIMATIONS:
        console.print(f"[red]--caption-animation ត្រូវជា {', '.join(config.CAPTION_ANIMATIONS)}[/red]")
        raise typer.Exit(code=2)
    config.CAPTION_ANIMATION = caption_animation

    if subject_tracks is not None:
        from pipeline.subject_track import Track
        config.SUBJECT_TRACKS = [Track.from_dict(item)
                                 for item in json.loads(subject_tracks.read_text(encoding="utf-8"))]

    try:
        allowed_layouts = parse_layouts(layout)
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2)

    # ត្រូវហៅមុនគេ — ទំហំ font, margin និងសមាមាត្រផ្ទាំងទាំងអស់គណនាពីវា
    try:
        out_width, out_height = config.apply_aspect(aspect)
        config.CAPTION_KEYWORD_COLOR = config.resolve_caption_color(caption_color)
        config.apply_caption_style(caption_size, caption_outline, caption_case,
                                   caption_position)
        config.apply_caption_look(caption_font, caption_text_color, caption_outline_color,
                                  caption_italic, caption_underline, caption_shadow,
                                  caption_keywords, caption_keyword_colors, caption_lines)
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2)

    if encoder not in ("auto", "nvenc", "x264"):
        console.print(f"[red]--encoder មិនស្គាល់: {encoder}[/red] (auto, nvenc ឬ x264)")
        raise typer.Exit(code=2)
    config.VIDEO_ENCODER = encoder

    if not 2 <= caption_words <= 8:
        console.print(f"[red]--caption-words ត្រូវនៅចន្លោះ 2-8 (ទទួលបាន {caption_words})[/red]")
        raise typer.Exit(code=2)
    config.CAPTION_MAX_WORDS_PER_CUE = caption_words

    device, default_whisper, compute = config.detect_device()
    whisper_model = whisper_model or default_whisper
    out_dir = config.OUTPUT_DIR / video.stem
    # aspect ផ្សេងៗសរសេរទៅ folder ផ្សេង ដើម្បីកុំឲ្យជាន់គ្នា (clips/, clips_1x1/, ...)
    clips_dir = out_dir / ("clips" if aspect == "9:16"
                           else f"clips_{aspect.replace(':', 'x')}")
    if full:
        # video ពេញទៅ folder ផ្សេង ដើម្បីកុំឲ្យជាន់លើ clip ខ្លី
        clips_dir = out_dir / ("full" if aspect == "9:16"
                               else f"full_{aspect.replace(':', 'x')}")

    # ---------- Step 0 (Edit Video): cut list -> ច្បាប់ចម្លងដែលគ្មានចន្លោះកាត់ ----------
    # វីដេអូដើមអានតែប៉ុណ្ណោះ. ច្បាប់ចម្លង + audio + transcript ដែលរំកិលពេល នៅ `edit/`;
    # render ទៅ `full_edit*` ក្បែរលទ្ធផលផ្សេងទៀត. ពីទីនេះតទៅ pipeline ឃើញតែច្បាប់ចម្លង.
    work_dir = out_dir            # កន្លែង audio.wav / transcript.json / seats.json
    title_stem = video.stem
    if cuts is not None:
        from pipeline.cuts import (TRANSITIONS, cut_video, edit_folder, frame_rate, keep_ranges,
                                   normalize, read_cut_list, read_inserts, read_order, rearrange, sequence,
                                   shift_transcript, snap_to_frames, video_seconds, video_start)
        from pipeline.transcribe import save_transcript
        if not full:
            console.print("[red]--cuts ត្រូវប្រើជាមួយ --full[/red] (កាត់វីដេអូទាំងមូល)")
            raise typer.Exit(code=2)
        if transition not in TRANSITIONS:
            console.print(f"[red]--transition មិនស្គាល់: {transition}[/red] ({', '.join(TRANSITIONS)})")
            raise typer.Exit(code=2)
        original = load_transcript(out_dir / "transcript.json")
        if original is None:
            console.print("[red]គ្មាន transcript — រត់ --transcribe-only មុន[/red] (ការកាត់ត្រូវការពាក្យ)")
            raise typer.Exit(code=2)
        # រយៈពេលរូប (មិនមែន file): សំឡេងអាចវែងជាងរូប ហើយផ្នែកចុងក្រោយនឹងគ្មាន frame
        first_frame = video_start(video)
        source_seconds = first_frame + video_seconds(video) if video_seconds(video) else probe_duration(video)
        removed = normalize(read_cut_list(cuts), source_seconds)
        inserts = read_inserts(cuts)   # "+ Extend a clip": ផ្នែកដែលចម្លងទៅដាក់កន្លែងផ្សេង (ឧ. hook)
        # parts តាមលំដាប់ចេញ, គែមនៅលើ frame: រូប និងសំឡេងកាត់ចំពេលដូចគ្នា, transcript រំកិលតាមនោះ
        in_time = keep_ranges(source_seconds, removed)
        arranged = rearrange(in_time, read_order(cuts))   # លំដាប់ដែលអូសលើ timeline
        # គ្មានផ្នែកណាចាប់ផ្តើមមុន frame ទីមួយ: សំឡេងនោះគ្មានរូប ហើយរុញផ្នែកបន្ទាប់ឲ្យលែងត្រូវគ្នា
        parts = [(max(start, first_frame), end) for start, end in sequence(arranged, inserts, source_seconds)]
        keeps = snap_to_frames(parts, frame_rate(video))
        if not (removed or inserts or arranged != in_time) or not keeps:
            console.print("[red]cut list ទទេ ឬលុបវីដេអូទាំងមូល[/red]")
            raise typer.Exit(code=2)
        work_dir = out_dir / "edit"
        with console.status(f"[cyan]0/6 cut[/cyan] — លុប {len(removed)} ចន្លោះ, បន្ថែម {len(inserts)} ({transition})..."):
            video = cut_video(video, keeps, work_dir / "source.mp4",
                              size=probe_dimensions(video), transition=transition)
            save_transcript(shift_transcript(original, keeps), work_dir / "transcript.json")
        # ចន្លោះ "បិទ tracking" ជាពេលក្នុងវីដេអូដើម -> ពេលក្នុងច្បាប់ចម្លង
        from pipeline.cuts import shift_range
        config.NO_TRACK_RANGES = [part for span in config.NO_TRACK_RANGES
                                  for part in shift_range(span, keeps)]
        from pipeline.subject_track import shift_track
        config.SUBJECT_TRACKS = [part for track in config.SUBJECT_TRACKS
                                 for part in shift_track(track, keeps)]
        kept = sum(b - a for a, b in keeps)
        console.print(f"[green]✔ 0/6 cut[/green]         {short_path(video)}  "
                      f"{source_seconds:.1f}s -> {kept:.1f}s ({len(removed)} ចន្លោះ, +{len(inserts)}, {transition})")
        clips_dir = out_dir / edit_folder(aspect)

    console.print("\n[bold]ClipForge Studio[/bold] — Phase 0\n")
    console.print(f"  video       : {video}")
    console.print(f"  output      : {short_path(out_dir)}")
    console.print(f"  max clips   : {max_clips}")
    console.print(f"  whisper     : {whisper_model} on {device} ({compute})")
    console.print(f"  llm         : {model}")
    config.PANEL_GAP = max(0, panel_gap)
    config.PANEL_BACKGROUND = panel_color
    gap_note = f"គម្លាត {config.PANEL_GAP}px {panel_color}" if config.PANEL_GAP else "គ្មានគម្លាត"
    console.print(f"  layout      : {layout} ({', '.join(sorted(allowed_layouts))}), {gap_note}")
    console.print(f"  aspect      : {aspect}  ({out_width}x{out_height})")
    console.print(f"  caption     : {caption_words} ពាក្យ/cue, "
                  f"ពណ៌ {config.CAPTION_KEYWORD_COLOR}")
    chosen_encoder, _ = encoder_args()
    console.print(f"  encoder     : {chosen_encoder}"
                  + ("  [dim](GPU)[/dim]" if chosen_encoder == "nvenc" else "  [dim](CPU)[/dim]"))

    # ---------- Step 1: audio ----------
    try:
        duration = probe_duration(video)
        console.print(f"  duration    : {duration / 60:.1f} នាទី ({duration:.1f}s)\n")

        was_cached = (work_dir / "audio.wav").exists() and not redo_audio
        with console.status("[cyan]1/6 audio[/cyan] — extract WAV 16kHz mono..."):
            wav = extract_audio(video, work_dir / "audio.wav", force=redo_audio)

        size_mb = wav.stat().st_size / 1_000_000
        tag = " [dim](cache)[/dim]" if was_cached else ""
        console.print(f"[green]✔ 1/6 audio[/green]       {short_path(wav)}  ({size_mb:.1f} MB){tag}")
    except (FFmpegError, FileNotFoundError) as e:
        console.print(f"[red]✘ 1/6 audio បរាជ័យ:[/red] {e}")
        raise typer.Exit(code=1)

    # ---------- Step 2: transcribe ----------
    cache = work_dir / "transcript.json"
    # transcript ចាស់ជាភាសាផ្សេងពីភាសាដែលសុំ (ឧ. Whisper រកឃើញ fr តែអ្នកជ្រើស en) -> ធ្វើថ្មី
    cached = load_transcript(cache)
    if config.WHISPER_LANGUAGE and cached is not None and cached.language != config.WHISPER_LANGUAGE:
        console.print(f"[yellow]transcript ចាស់ជា {cached.language} — transcribe ម្តងទៀតជា "
                      f"{config.WHISPER_LANGUAGE}[/yellow]")
        redo_transcribe = True
        redo_highlights = True     # clip ដែល AI ជ្រើសពី transcript ចាស់ លែងត្រូវគ្នា
    # ប្រើ loader ដើម្បីដឹងថា cache *ប្រើបាន* ពិត (file អាចខូច ឬ version ចាស់)
    was_cached = not redo_transcribe and cached is not None
    try:
        if was_cached:
            transcript = transcribe(wav, cache, force=False, model_name=whisper_model)
        else:
            # progress bar: total = រយៈពេល video, advance តាមវិនាទីដែល Whisper ចប់
            with Progress(*progress_columns("2/6 transcribe"), console=console) as progress:
                task = progress.add_task("transcribe", total=duration)
                transcript = transcribe(
                    wav, cache, force=redo_transcribe, model_name=whisper_model,
                    on_progress=lambda sec: (progress.update(task, completed=min(sec, duration)),
                                             report_progress("transcribe", min(sec, duration), duration)),
                    on_fallback=lambda message: console.print(f"[yellow]⚠[/yellow] {message}"),
                )
                progress.update(task, completed=duration)
                report_progress("transcribe", duration, duration)  # segment ចុងក្រោយចប់មុនចុងវីដេអូ

        tag = " [dim](cache)[/dim]" if was_cached else ""
        console.print(f"[green]✔ 2/6 transcribe[/green]  {short_path(cache)}{tag}")
        # បង្ហាញ device/model *ពិត* — បើវាខុសពីគ្រោង អ្នកត្រូវដឹង
        actual = f"{transcript.model} on {transcript.device}"
        mark = "" if (transcript.device == device and transcript.model == whisper_model) \
            else "  [yellow](ខុសពីគ្រោង)[/yellow]"
        console.print(
            f"[dim]  {len(transcript.segments)} segments, {transcript.word_count()} words, "
            f"lang={transcript.language} {transcript.language_probability:.0%}, {actual}[/dim]{mark}"
        )
    except (TranscribeError, FileNotFoundError) as e:
        console.print(f"[red]✘ 2/6 transcribe បរាជ័យ:[/red] {e}")
        raise typer.Exit(code=1)

    # Edit Video ត្រូវការតែពាក្យ និងពេលវេលា — ឈប់មុន LLM និង render
    if transcribe_only:
        console.print("[green]រួចរាល់![/green] transcript សម្រាប់ Edit Video")
        raise typer.Exit(code=0)

    # ---------- Step 3: highlights ----------
    # `--full` render ទាំង video -> គ្មានអ្វីត្រូវជ្រើស និងគ្មានព្រំដែនត្រូវកែ
    clips = [] if full else None
    clips_cache = out_dir / "highlights.json"
    was_cached = not redo_highlights and load_clips(clips_cache) is not None
    warnings: list[str] = []
    try:
        if full:
            console.print("[green]✔ 3/6 highlights[/green]  រំលង ([cyan]--full[/cyan])")
            raise _SkipSelection
        # ពេលមានជំហានតម្រៀប យើងរក candidate ច្រើន រួចជ្រើស ៥ ក្រោយពេលកែព្រំដែន
        wanted = (max(max_clips, config.MAX_RANK_CANDIDATES)
                  if config.RANK_CANDIDATES else max_clips)
        if was_cached:
            clips = find_highlights(transcript, max_clips=wanted, model=model,
                                    cache_path=clips_cache)
        else:
            with Progress(*progress_columns("3/6 highlights"), console=console) as progress:
                task = progress.add_task("highlights", total=1)
                clips = find_highlights(
                    transcript, max_clips=wanted, model=model,
                    cache_path=clips_cache, force=redo_highlights,
                    on_progress=lambda done, total: (progress.update(
                        task, completed=done, total=total,
                        description="តម្រៀប" if done >= total - 1 else "chunk"),
                        report_progress("highlights", done, total)),
                    on_warning=warnings.append,
                )

        tag = " [dim](cache)[/dim]" if was_cached else ""
        console.print(f"[green]✔ 3/6 highlights[/green]  {short_path(clips_cache)}  "
                      f"({len(clips)} candidates){tag}")
        if warnings:
            console.print(f"[dim]  {len(warnings)} warning ត្រូវរំលង (clip ខុស format ឬក្រៅដែន)[/dim]")
            for warning in warnings[:3]:
                console.print(f"[dim]    - {warning}[/dim]")
        if clips:
            console.print(clips_table(clips))
        else:
            console.print("[yellow]  គ្មាន clip ត្រូវបានរកឃើញ — សាកកែ prompt ឬប្តូរ model[/yellow]")
    except _SkipSelection:
        pass
    except (HighlightsError, LLMError) as e:
        console.print(f"[red]✘ 3/6 highlights បរាជ័យ:[/red] {e}")
        raise typer.Exit(code=1)

    # ---------- Step 4: boundaries ----------
    snap_warnings: list[str] = []
    cached_final = None
    before: dict[str, float] = {}
    if full:
        final = [full_video_clip(duration, title_stem)]
        console.print(f"[green]✔ 4/6 boundaries[/green]  រំលង ([cyan]--full[/cyan]) — "
                      f"video ពេញ {duration / 60:.1f} នាទី")
    else:
        before = {c.title: c.start for c in clips}

        # ជម្រើសចុងក្រោយត្រូវ cache ព្រោះជំហានតម្រៀបហៅ LLM ហើយ LLM មិនឆ្លើយដូចគ្នា
        # ជានិច្ចទេ។ បើយើងតម្រៀបឡើងវិញរាល់ពេល render នោះ clip ដែលអ្នកបានអនុម័ត
        # នឹងប្តូរដោយខ្លួនឯង (យើងបានជួបវាពិត)។ `--redo highlights` ធ្វើឲ្យវាធ្វើថ្មី។
        cached_final = None if redo_highlights else load_clips(out_dir / "clips.json")
        if cached_final:
            final = cached_final
            console.print("[dim]  ជម្រើសចុងក្រោយយកពី clips.json (cache) — "
                          "ប្រើ --redo highlights ដើម្បីជ្រើសថ្មី[/dim]")
        else:
            final = snap_boundaries(clips, transcript, on_warning=snap_warnings.append)

    # ---------- ជំហានតម្រៀប ----------
    # ឥឡូវ clip មានព្រំដែនត្រឹមត្រូវហើយ (ចាប់ផ្តើមដើមប្រយោគ, >= 15s) ដូច្នេះ LLM
    # វិនិច្ឆ័យអ្វីដែលអ្នកមើលនឹងឃើញពិត មិនមែនបំណែកឆៅទេ។
    if cached_final is None and config.RANK_CANDIDATES and len(final) > max_clips:
        with console.status(f"[cyan]តម្រៀប[/cyan] — ប្រៀបធៀប {len(final)} candidate..."):
            final = rank_clips(final, transcript, model=model,
                               on_warning=snap_warnings.append)
        console.print(f"[dim]  តម្រៀប {len(final)} candidate -> យក {max_clips} ល្អបំផុត[/dim]")
    ranked = final                 # បញ្ជីពេញតាមលំដាប់ — cache ត្រូវរក្សាវា
    final = final[:max_clips]

    # `--full` មិនត្រូវសរសេរ clips.json ទេ — មិនមានការជ្រើសអ្វីទាំងអស់
    # ហើយបើសរសេរ នោះ run ធម្មតាបន្ទាប់នឹងអាន cache នោះ រួច render វីដៀអូពេញជា "clip" ។
    # យើងសរសេរ **បញ្ជីពេញ** មិនមែនបញ្ជីដែលកាត់តាម `--max-clips` ទេ ហើយសរសេរតែ
    # ពេលទើបគណនាថ្មី។ បើមិនដូច្នោះ `--max-clips 2` លុបជម្រើសដែលអ្នកអនុម័ត ហើយ
    # run បន្ទាប់ទទួលបានត្រឹម ២ clip ដោយមិនដឹងខ្លួន (យើងធ្វើវាពិត ២ ដង)។
    clips_file = out_dir / "clips.json"
    if not full and cached_final is None:
        clips_file = save_clips(ranked, clips_file, model=model,
                                prompt=config.HIGHLIGHT_PROMPT)
    if not full:
        console.print(f"[green]✔ 4/6 boundaries[/green]  {short_path(clips_file)}  "
                      f"({len(final)} clips)")
    for warning in snap_warnings:
        console.print(f"[dim]    - {warning}[/dim]")
    if final:
        moved = sum(1 for c in final if abs(c.start - before.get(c.title, c.start)) > 0.5)
        console.print(f"[dim]  start ត្រូវរុញ {moved}/{len(final)} clip "
                      f"(snap ទៅព្រំដែនប្រយោគ + padding {config.PADDING_SEC}s)[/dim]")
        console.print(clips_table(final))
        console.print("")
        for i, clip in enumerate(final, start=1):
            console.print(f"[dim]  #{i} “{clip_text(clip, transcript)[:100]}...”[/dim]")

    # ---------- Step 4b: reframe (ផែនការ layout ក្នុងមួយ shot) ----------
    console.print("")
    source_size = probe_dimensions(video)
    plans: list[list] | None = None
    margins: list[int | None] = [None] * len(final)

    if allowed_layouts != frozenset({"center"}):
        try:
            seats = find_seats(video, source_size, duration,
                               cache_path=work_dir / "seats.json")
            if seats is None:
                console.print("[yellow]⚠ រកកៅអីមិនឃើញ (មិនមែន two-shot?)[/yellow] "
                              "-> split នៅដំណើរការតាម shot តែយើងមិនដឹងថាអ្នកណាគួរនៅលើ")
            else:
                console.print(f"[dim]  កៅអី: ឆ្វេង x={seats.left.x} ស្តាំ x={seats.right.x}"
                              f"[/dim]")

            plans = []
            with console.status("[cyan]reframe[/cyan] — វិភាគ shot និងមុខ..."):
                for clip in final:
                    plans.append(plan_clip(video, clip, source_size, seats,
                                           allowed=allowed_layouts))
            for index, (clip, segments) in enumerate(zip(final, plans), start=1):
                console.print(f"[dim]  #{index} {len(segments):2} shots — "
                              f"{describe(segments)}[/dim]")
                # ទីតាំង caption សម្រេចតាម shot នីមួយៗក្នុង captions.anchor_for (មិនមែនតាម
                # layout ភាគច្រើនរបស់ clip ទៀតទេ) ដូច្នេះ margins នៅ None
                save_layout_summary(segments, clips_dir / f"clip_{index:02d}_layout.json",
                                    captions=not (no_captions or clean_only),
                                    allowed=allowed_layouts)
        except ReframeError as e:
            console.print(f"[yellow]⚠ reframe បរាជ័យ:[/yellow] {e}")
            console.print("[yellow]  -> ប្រើ center-crop ជំនួស[/yellow]")
            plans = None

    # ---------- Step 5: captions ----------
    # --clean-only: រំលង caption ទាំងស្រុង — ការសង់ .vtt ឡើងវិញជាមួយការកំណត់លំនាំដើម
    # ធ្វើឲ្យបញ្ជីបន្ទាត់លើ screen Subtitles លែងត្រូវនឹង clip ដែល render ជាមួយ style ផ្សេង
    ass_files = None
    if not clean_only:
        console.print("")
        caption_font, font_is_wanted = resolve_font()
        if not font_is_wanted:
            console.print(f"[yellow]⚠ font '{config.CAPTION_FONT}' គ្មានលើម៉ាស៊ីន[/yellow] "
                          f"-> ប្រើ '{caption_font}' ជំនួស")
        try:
            ass_files = build_all_captions(final, transcript, clips_dir,
                                           font=caption_font, margins=margins,
                                           plans=plans)
            cue_count = sum(
                1 for path in ass_files
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.startswith("Dialogue:")
            )
            console.print(f"[green]✔ 5/6 captions[/green]    {len(ass_files)} .ass ក្នុង "
                          f"{short_path(clips_dir)}  ({cue_count} cues, font={caption_font})")
            # QA លើ cue ពិត (checklist §12) — ព្រមាន មិនបញ្ឈប់
            for index, clip in enumerate(final, start=1):
                words = [w for s in transcript.segments for w in s.words
                         if w.end > clip.start and w.start < clip.end]
                troubles = check_cues(wrap_into_cues(words, clip.start))
                for trouble in troubles[:3]:
                    console.print(f"[yellow]    ⚠ clip {index}: {trouble}[/yellow]")
        except CaptionError as e:
            # គ្មានពាក្យ (video ស្ងាត់) មិនមែនជាហេតុផលបោះបង់ទេ — render ដោយគ្មាន caption
            console.print(f"[yellow]⚠ 5/6 captions រំលង:[/yellow] {e}")
            ass_files = None

    # ---------- Step 6: render ----------
    console.print("")
    try:
        rendered: list[Path] = []
        with Progress(*progress_columns("6/6 render"), console=console) as progress:
            task = progress.add_task("render", total=len(final))

            def tick(index: int, total: int, clip) -> None:
                progress.update(task, completed=index - 1, total=total,
                                description=clip.title)
                report_progress("render", index - 1, total)

            # Motion: ពេលពាក្យសំខាន់ និងសំឡេងខ្លាំង ក្នុង clip នីមួយៗ (ពេល render គណនា zoom/shake)
            motion_cues = None
            from pipeline import motion as motion_fx
            if motion_fx.enabled():
                motion_cues = []
                for clip in final:
                    words = [w for s in transcript.segments for w in s.words
                             if w.end > clip.start and w.start < clip.end]
                    motion_cues.append(motion_fx.MotionCues(
                        keywords=motion_fx.keyword_moments(words, clip.start) if config.MOTION_KEYWORDS else [],
                        loud=(motion_fx.loud_ranges(work_dir / "audio.wav", clip.start, clip.end)
                              if config.MOTION_SHAKE == "loud" else [])))
            # --no-captions: .ass ត្រូវបានសង់ (សម្រាប់ .srt/.vtt) តែមិនដុតចូល video ទេ.
            # force ព្រោះ render_clip រំលង .mp4 ដែលមាន ពេលគ្មាន .ass ថ្មីជាងវា
            rendered = render_all(video, final, clips_dir,
                                  None if no_captions or clean_only else ass_files,
                                  force=redo_render or no_captions or clean_only, plans=plans,
                                  on_progress=tick, suffix="_clean" if clean_only else "",
                                  motion_cues=motion_cues)
            progress.update(task, completed=len(final))
            report_progress("render", len(final), len(final))   # tick() រត់តែមុន clip នីមួយៗ

        console.print(f"[green]✔ 6/6 render[/green]      {len(rendered)} MP4 ក្នុង "
                      f"{short_path(clips_dir)}")
        for index, (path, clip) in enumerate(zip(rendered, final), start=1):
            actual = verify_clip(path, clip)      # ចាប់ trim ខុសដោយស្ងាត់
            size_mb = path.stat().st_size / 1_000_000
            console.print(f"[dim]  {index}. {path.name}  {actual:.1f}s  "
                          f"{size_mb:.1f} MB  — {clip.title}[/dim]")
    except (RenderError, FFmpegError, FileNotFoundError) as e:
        console.print(f"[red]✘ 6/6 render បរាជ័យ:[/red] {e}")
        raise typer.Exit(code=1)

    console.print(f"\n[bold green]រួចរាល់![/bold green] clip {len(rendered)} "
                  f"នៅក្នុង {short_path(clips_dir)}\n")


if __name__ == "__main__":
    app()
