"""ពិនិត្យ clip ដែល pipeline ផលិត — ជំនួយសម្រាប់សម្រេចថាឆ្លង gate ឬអត់.

Script នេះមិនផលិតអ្វីទេ។ វាគ្រាន់តែបង្ហាញអ្វីដែលមានក្នុង `output/<name>/` ឲ្យអ្នក
វិនិច្ឆ័យបានលឿន។

Usage:
    python review.py "The Future Mark Zuckerberg"    # តារាង + អត្ថបទ
    python review.py <name> --frames                 # ធ្វើ contact sheet រូប
    python review.py <name> --play 3                 # បើក clip ទី ៣
    python review.py <name> --open                   # បើក folder
"""

import os
import subprocess
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

import config
from pipeline.audio import probe_duration
from pipeline.boundaries import clip_text
from pipeline.highlights import load_clips
from pipeline.transcribe import load_transcript

config.enable_utf8_output()

app = typer.Typer(add_completion=False, help="ពិនិត្យ clip ដែលផលិតរួច")
console = Console()


def resolve_output_dir(name: str) -> Path:
    """ទទួលឈ្មោះ video ឬ path ទៅ video ឬ path ទៅ folder -> ត្រឡប់ folder លទ្ធផល."""
    candidate = Path(name)
    if candidate.is_dir():
        return candidate
    # "samples/x.mp4" ឬ "x.mp4" ឬ "x"
    stem = candidate.stem if candidate.suffix else candidate.name
    out_dir = config.OUTPUT_DIR / stem
    if not out_dir.is_dir():
        available = sorted(p.name for p in config.OUTPUT_DIR.iterdir() if p.is_dir())
        raise typer.BadParameter(
            f"រកមិនឃើញ {out_dir}។ មានៈ {', '.join(available) or '(គ្មាន)'}"
        )
    return out_dir


def mmss(seconds: float) -> str:
    return f"{int(seconds) // 60}:{int(seconds) % 60:02d}"


def make_contact_sheet(mp4: Path, out_png: Path, frames: int = 3) -> Path | None:
    """យករូប `frames` សន្លឹកពី clip មកតម្រៀបផ្ដេកក្នុង PNG តែមួយ.

    មើលរូបតែមួយលឿនជាងបើក video ទាំង ៥ — ប្រើដើម្បីចាប់បញ្ហា crop/caption រហ័ស។
    """
    duration = probe_duration(mp4)
    # យកនៅ 15%, 50%, 85% នៃ clip (ជៀសវាងដើម/ចុងដែលអាចខ្មៅ)
    points = [duration * p for p in (0.15, 0.5, 0.85)][:frames]
    pieces = []
    for index, moment in enumerate(points):
        piece = out_png.parent / f".frame_{index}.png"
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
             "-ss", f"{moment:.2f}", "-i", str(mp4), "-frames:v", "1",
             "-vf", "scale=360:640", str(piece)],
            capture_output=True, text=True,
        )
        if result.returncode == 0 and piece.exists():
            pieces.append(piece)

    if not pieces:
        return None

    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
    for piece in pieces:
        cmd += ["-i", str(piece)]
    cmd += ["-filter_complex", f"hstack=inputs={len(pieces)}", str(out_png)]
    subprocess.run(cmd, capture_output=True, text=True)
    for piece in pieces:
        piece.unlink(missing_ok=True)
    return out_png if out_png.exists() else None


@app.command()
def main(
    name: str = typer.Argument(..., help="ឈ្មោះ video (ឬ path ទៅវា)"),
    frames: bool = typer.Option(False, "--frames", help="ធ្វើ contact sheet រូបក្នុងមួយ clip"),
    play: int = typer.Option(0, "--play", help="បើក clip លេខនេះក្នុង player"),
    open_folder: bool = typer.Option(False, "--open", help="បើក folder clips"),
    text: bool = typer.Option(True, "--text/--no-text", help="បង្ហាញអត្ថបទក្នុង clip"),
) -> None:
    out_dir = resolve_output_dir(name)
    clips_dir = out_dir / "clips"

    clips = load_clips(out_dir / "clips.json", any_version=True)   # មើល, មិនមែន cache
    if not clips:
        console.print(f"[red]គ្មាន clips.json ក្នុង {out_dir}[/red] — run make_clips.py សិន")
        raise typer.Exit(code=1)

    transcript = load_transcript(out_dir / "transcript.json")

    # ---------- តារាងសង្ខេប ----------
    table = Table(title=f"{out_dir.name} — {len(clips)} clips", box=None, padding=(0, 1))
    table.add_column("#", width=2, justify="right")
    table.add_column("ពេលក្នុង video", width=14)
    table.add_column("វិ.", width=4, justify="right")
    table.add_column("score", width=7, justify="right")
    table.add_column("H/F/V", width=10)
    table.add_column("type", width=10)
    table.add_column("MB", width=5, justify="right")
    table.add_column("title")

    total_mb = 0.0
    for index, clip in enumerate(clips, start=1):
        mp4 = clips_dir / f"clip_{index:02d}.mp4"
        if mp4.is_file():
            size_mb = mp4.stat().st_size / 1_000_000
            total_mb += size_mb
            size_text = f"{size_mb:.1f}"
        else:
            size_text = "[red]-[/red]"
        grades = ("/".join(d.letter for d in (clip.grades.hook, clip.grades.flow,
                                              clip.grades.value))
                  if clip.grades else "-")
        table.add_row(str(index), f"{mmss(clip.start)} - {mmss(clip.end)}",
                      f"{clip.duration:.0f}", f"{clip.total:.0f} {clip.letter}",
                      grades, clip.type,
                      size_text, clip.title)
    console.print()
    console.print(table)
    console.print(f"[dim]  សរុប {total_mb:.1f} MB ក្នុង {clips_dir}[/dim]")

    # ---------- ពិនិត្យថា MP4 ត្រូវនឹង clip ----------
    problems: list[str] = []
    for index, clip in enumerate(clips, start=1):
        mp4 = clips_dir / f"clip_{index:02d}.mp4"
        if not mp4.is_file():
            problems.append(f"clip_{index:02d}.mp4 គ្មាន")
            continue
        actual = probe_duration(mp4)
        if abs(actual - clip.duration) > 0.5:
            problems.append(f"clip_{index:02d}.mp4 រយៈពេល {actual:.1f}s "
                            f"តែ clip សុំ {clip.duration:.1f}s")
    if problems:
        console.print("\n[red]បញ្ហា:[/red]")
        for problem in problems:
            console.print(f"  - {problem}")
    else:
        console.print("[green]  MP4 ទាំងអស់មាន ហើយរយៈពេលត្រូវគ្នា ✔[/green]")

    # ---------- អត្ថបទក្នុងមួយ clip ----------
    if text and transcript is not None:
        for index, clip in enumerate(clips, start=1):
            console.print(f"\n[bold]#{index}  {clip.title}[/bold]  "
                          f"[dim]{mmss(clip.start)}-{mmss(clip.end)} "
                          f"({clip.duration:.0f}s, {clip.total:.0f}/100 {clip.letter})[/dim]")
            if clip.hook:
                console.print(f"  [cyan]hook:[/cyan] {clip.hook}")
            if clip.reason:
                console.print(f"  [dim]why : {clip.reason}[/dim]")
            console.print(f"  {clip_text(clip, transcript)}")

    # ---------- contact sheet ----------
    if frames:
        console.print("\n[cyan]ធ្វើ contact sheet...[/cyan]")
        for index in range(1, len(clips) + 1):
            mp4 = clips_dir / f"clip_{index:02d}.mp4"
            if not mp4.is_file():
                continue
            sheet = make_contact_sheet(mp4, clips_dir / f"clip_{index:02d}_frames.png")
            if sheet:
                console.print(f"  {sheet.name}")
        console.print("[dim]  បើករូបទាំងនោះដើម្បីពិនិត្យ crop និង caption លឿន[/dim]")

    # ---------- បើក ----------
    if play:
        mp4 = clips_dir / f"clip_{play:02d}.mp4"
        if mp4.is_file():
            console.print(f"\n[cyan]បើក {mp4.name}...[/cyan]")
            os.startfile(str(mp4))          # Windows: បើកដោយ player លំនាំដើម
        else:
            console.print(f"[red]រកមិនឃើញ {mp4.name}[/red]")

    if open_folder:
        os.startfile(str(clips_dir))

    console.print()


if __name__ == "__main__":
    app()
