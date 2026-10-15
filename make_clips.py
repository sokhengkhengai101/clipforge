"""ClipForge Studio — CLI entry point.

Phase 0: ជំហាន 1 (audio) + 2 (transcribe) + 3 (highlights) រួចរាល់។ ជំហាន 4-6 នៅសល់។
Usage: python make_clips.py video.mp4 --max-clips 5
"""

from pathlib import Path

import typer
from rich.console import Console
from rich.progress import BarColumn, Progress, TextColumn, TimeElapsedColumn
from rich.table import Table

import config
from pipeline.audio import FFmpegError, extract_audio, probe_duration
from pipeline.boundaries import clip_text, snap_boundaries
from pipeline.captions import CaptionError, build_all_captions, resolve_font
from pipeline.highlights import HighlightsError, find_highlights, load_clips, save_clips
from pipeline.llm import LLMError
from pipeline.reframe import (ReframeError, describe, dominant_kind, find_seats,
                             plan_clip)
from pipeline.render import (RenderError, compute_crop, probe_dimensions,
                             render_all, verify_clip)
from pipeline.transcribe import TranscribeError, load_transcript, transcribe

config.enable_utf8_output()  # ត្រូវហៅមុន Console() ដើម្បីឲ្យ rich ចាំ encoding ត្រឹមត្រូវ

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
    table.add_column("score", width=5, justify="right")
    table.add_column("type", width=10)
    table.add_column("title")
    for i, clip in enumerate(clips, start=1):
        table.add_row(
            str(i),
            f"{mmss(clip.start)} - {mmss(clip.end)}",
            f"{clip.duration:.0f}",
            f"{clip.score:.0f}",
            clip.type,
            clip.title,
        )
    return table


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
                               help="auto (split/មុខ/center តាម shot), center (ចាស់), split"),
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

    if layout not in ("auto", "center", "split"):
        console.print(f"[red]--layout មិនស្គាល់: {layout}[/red] (auto, center ឬ split)")
        raise typer.Exit(code=2)

    device, default_whisper, compute = config.detect_device()
    whisper_model = whisper_model or default_whisper
    out_dir = config.OUTPUT_DIR / video.stem

    console.print("\n[bold]ClipForge Studio[/bold] — Phase 0\n")
    console.print(f"  video       : {video}")
    console.print(f"  output      : {short_path(out_dir)}")
    console.print(f"  max clips   : {max_clips}")
    console.print(f"  whisper     : {whisper_model} on {device} ({compute})")
    console.print(f"  llm         : {model}")
    console.print(f"  layout      : {layout}")

    # ---------- Step 1: audio ----------
    try:
        duration = probe_duration(video)
        console.print(f"  duration    : {duration / 60:.1f} នាទី ({duration:.1f}s)\n")

        was_cached = (out_dir / "audio.wav").exists() and not redo_audio
        with console.status("[cyan]1/6 audio[/cyan] — extract WAV 16kHz mono..."):
            wav = extract_audio(video, out_dir / "audio.wav", force=redo_audio)

        size_mb = wav.stat().st_size / 1_000_000
        tag = " [dim](cache)[/dim]" if was_cached else ""
        console.print(f"[green]✔ 1/6 audio[/green]       {short_path(wav)}  ({size_mb:.1f} MB){tag}")
    except (FFmpegError, FileNotFoundError) as e:
        console.print(f"[red]✘ 1/6 audio បរាជ័យ:[/red] {e}")
        raise typer.Exit(code=1)

    # ---------- Step 2: transcribe ----------
    cache = out_dir / "transcript.json"
    # ប្រើ loader ដើម្បីដឹងថា cache *ប្រើបាន* ពិត (file អាចខូច ឬ version ចាស់)
    was_cached = not redo_transcribe and load_transcript(cache) is not None
    try:
        if was_cached:
            transcript = transcribe(wav, cache, force=False, model_name=whisper_model)
        else:
            # progress bar: total = រយៈពេល video, advance តាមវិនាទីដែល Whisper ចប់
            with Progress(*progress_columns("2/6 transcribe"), console=console) as progress:
                task = progress.add_task("transcribe", total=duration)
                transcript = transcribe(
                    wav, cache, force=redo_transcribe, model_name=whisper_model,
                    on_progress=lambda sec: progress.update(task, completed=min(sec, duration)),
                    on_fallback=lambda err: console.print(
                        f"[yellow]⚠ GPU បរាជ័យ -> ប្តូរទៅ CPU:[/yellow] {err}"
                    ),
                )
                progress.update(task, completed=duration)

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

    # ---------- Step 3: highlights ----------
    clips_cache = out_dir / "highlights.json"
    was_cached = not redo_highlights and load_clips(clips_cache) is not None
    warnings: list[str] = []
    try:
        if was_cached:
            clips = find_highlights(transcript, max_clips=max_clips, model=model,
                                    cache_path=clips_cache)
        else:
            with Progress(*progress_columns("3/6 highlights"), console=console) as progress:
                task = progress.add_task("highlights", total=1)
                clips = find_highlights(
                    transcript, max_clips=max_clips, model=model,
                    cache_path=clips_cache, force=redo_highlights,
                    on_progress=lambda done, total: progress.update(task, completed=done, total=total),
                    on_warning=warnings.append,
                )

        tag = " [dim](cache)[/dim]" if was_cached else ""
        console.print(f"[green]✔ 3/6 highlights[/green]  {short_path(clips_cache)}  "
                      f"({len(clips)} clips){tag}")
        if warnings:
            console.print(f"[dim]  {len(warnings)} warning ត្រូវរំលង (clip ខុស format ឬក្រៅដែន)[/dim]")
            for warning in warnings[:3]:
                console.print(f"[dim]    - {warning}[/dim]")
        if clips:
            console.print(clips_table(clips))
        else:
            console.print("[yellow]  គ្មាន clip ត្រូវបានរកឃើញ — សាកកែ prompt ឬប្តូរ model[/yellow]")
    except (HighlightsError, LLMError) as e:
        console.print(f"[red]✘ 3/6 highlights បរាជ័យ:[/red] {e}")
        raise typer.Exit(code=1)

    # ---------- Step 4: boundaries ----------
    # គណនាថោក (គ្មាន LLM) -> ធ្វើថ្មីរាល់ពេល, មិនត្រូវ cache
    snap_warnings: list[str] = []
    before = {c.title: c.start for c in clips}
    final = snap_boundaries(clips, transcript, on_warning=snap_warnings.append)
    clips_file = save_clips(final, out_dir / "clips.json", model=model,
                            prompt=config.HIGHLIGHT_PROMPT)

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

    if layout != "center":
        try:
            seats = find_seats(video, source_size, duration,
                               cache_path=out_dir / "seats.json")
            if seats is None:
                console.print("[yellow]⚠ រកកៅអីមិនឃើញ (មិនមែន two-shot?)[/yellow] "
                              "-> split នឹងមិនកើតទេ")
            else:
                console.print(f"[dim]  កៅអី: ឆ្វេង x={seats.left.x} ស្តាំ x={seats.right.x}"
                              f"[/dim]")

            plans = []
            with console.status("[cyan]reframe[/cyan] — វិភាគ shot និងមុខ..."):
                for clip in final:
                    plans.append(plan_clip(video, clip, source_size, seats,
                                           layout_mode=layout))
            for index, (clip, segments) in enumerate(zip(final, plans), start=1):
                console.print(f"[dim]  #{index} {len(segments):2} shots — "
                              f"{describe(segments)}[/dim]")
                if dominant_kind(segments) == "split":
                    margins[index - 1] = config.CAPTION_MARGIN_V_SPLIT
        except ReframeError as e:
            console.print(f"[yellow]⚠ reframe បរាជ័យ:[/yellow] {e}")
            console.print("[yellow]  -> ប្រើ center-crop ជំនួស[/yellow]")
            plans = None

    # ---------- Step 5: captions ----------
    console.print("")
    caption_font, font_is_wanted = resolve_font()
    if not font_is_wanted:
        console.print(f"[yellow]⚠ font '{config.CAPTION_FONT}' គ្មានលើម៉ាស៊ីន[/yellow] "
                      f"-> ប្រើ '{caption_font}' ជំនួស")
    try:
        ass_files = build_all_captions(final, transcript, out_dir / "clips",
                                       font=caption_font, margins=margins)
        cue_count = sum(
            1 for path in ass_files
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.startswith("Dialogue:")
        )
        console.print(f"[green]✔ 5/6 captions[/green]    {len(ass_files)} .ass ក្នុង "
                      f"{short_path(out_dir / 'clips')}  ({cue_count} cues, font={caption_font})")
    except CaptionError as e:
        console.print(f"[red]✘ 5/6 captions បរាជ័យ:[/red] {e}")
        raise typer.Exit(code=1)

    # ---------- Step 6: render ----------
    console.print("")
    try:
        rendered: list[Path] = []
        with Progress(*progress_columns("6/6 render"), console=console) as progress:
            task = progress.add_task("render", total=len(final))

            def tick(index: int, total: int, clip) -> None:
                progress.update(task, completed=index - 1, total=total,
                                description=clip.title)

            rendered = render_all(video, final, out_dir / "clips", ass_files,
                                  force=redo_render, plans=plans, on_progress=tick)
            progress.update(task, completed=len(final))

        console.print(f"[green]✔ 6/6 render[/green]      {len(rendered)} MP4 ក្នុង "
                      f"{short_path(out_dir / 'clips')}")
        for index, (path, clip) in enumerate(zip(rendered, final), start=1):
            actual = verify_clip(path, clip)      # ចាប់ trim ខុសដោយស្ងាត់
            size_mb = path.stat().st_size / 1_000_000
            console.print(f"[dim]  {index}. {path.name}  {actual:.1f}s  "
                          f"{size_mb:.1f} MB  — {clip.title}[/dim]")
    except (RenderError, FFmpegError, FileNotFoundError) as e:
        console.print(f"[red]✘ 6/6 render បរាជ័យ:[/red] {e}")
        raise typer.Exit(code=1)

    console.print(f"\n[bold green]រួចរាល់![/bold green] clip {len(rendered)} "
                  f"នៅក្នុង {short_path(out_dir / 'clips')}\n")


if __name__ == "__main__":
    app()
