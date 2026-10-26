"""Cut list: លុបចន្លោះពេលចេញពីវីដេអូ (Edit Video ជំហាន ២).

**Cut list** = បញ្ជីចន្លោះ `(start, end)` ដែលត្រូវលុប. យើងមិនកែវីដេអូដើមទេ — យើងធ្វើ
**ច្បាប់ចម្លង** ដែលគ្មានចន្លោះទាំងនោះ (`edit/source.mp4`, រូប + សំឡេង) ហើយរំកិលពេល
transcript តាម (`edit/transcript.json`). បន្ទាប់មក render `--full` ធម្មតារត់លើច្បាប់ចម្លងនោះ
ដូចវីដេអូធម្មតាមួយ — reframe, captions, render មិនត្រូវដឹងអំពីការកាត់ទេ.

ឧ. វីដេអូ 55.75 s, cuts [(12.40, 38.87)] -> រក្សា [(0, 12.40), (38.87, 55.75)] = 29.28 s;
ពាក្យនៅ 40.00 s ក្លាយជា 40.00 - 26.47 = 13.53 s.
"""

import json
import math
import subprocess
from dataclasses import replace
from pathlib import Path

from pipeline.audio import FFmpegError
from pipeline.transcribe import Segment, Transcript, Word

MIN_CUT_SEC = 0.05     # ចន្លោះតូចជាងនេះ = មិនមែនការកាត់ (ចុចខុស)
MIN_KEEP_SEC = 0.10    # ផ្នែករក្សាខ្លីជាងនេះ (ចន្លោះតូចរវាងការកាត់ពីរ) ត្រូវលុបចោលដែរ
AUDIO_FADE_SEC = 0.01  # fade សំឡេង 10 ms នៅកន្លែងភ្ជាប់ — កុំឲ្យឮ "ក្លិក"
PUNCH_ZOOM = 1.10      # zoom punch-in: ផ្នែកឆ្លាស់ 100% / 110% លាក់ jump cut
TRANSITIONS = ("punch", "hard")

Range = tuple[float, float]


def normalize(cuts: list[Range], duration: float) -> list[Range]:
    """តម្រៀប, កាត់ឲ្យនៅក្នុង 0..duration, បញ្ចូលចន្លោះជាន់គ្នា ឬជាប់គ្នា, ដកចន្លោះតូចពេក."""
    clean = sorted((max(0.0, float(a)), min(duration, float(b))) for a, b in cuts)
    merged: list[list[float]] = []
    for start, end in clean:
        if end - start < MIN_CUT_SEC:
            continue
        if merged and start <= merged[-1][1] + 0.01:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(round(a, 3), round(b, 3)) for a, b in merged]


def keep_ranges(duration: float, cuts: list[Range]) -> list[Range]:
    """ផ្នែកដែលត្រូវរក្សា = ផ្ទុយពី cut list (cuts ត្រូវ `normalize` រួច)."""
    keeps: list[Range] = []
    position = 0.0
    for start, end in cuts:
        if start - position >= MIN_KEEP_SEC:
            keeps.append((round(position, 3), round(start, 3)))
        position = max(position, end)
    if duration - position >= MIN_KEEP_SEC:
        keeps.append((round(position, 3), round(duration, 3)))
    return keeps


def frame_rate(video: Path) -> float | None:
    """fps ពិត (r_frame_rate, ឧ. 24000/1001 = 23.976), ឬ None បើ ffprobe មិនឆ្លើយ."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
             "-of", "csv=p=0", str(video)], capture_output=True, text=True, timeout=30)
        top, _, bottom = result.stdout.strip().partition("/")
        return float(top) / float(bottom or 1)
    except (OSError, subprocess.SubprocessError, ValueError, ZeroDivisionError):
        return None


def video_seconds(video: Path) -> float | None:
    """រយៈពេលនៃ**រូប** (stream v:0) មិនមែន file ទាំងមូល — សំឡេងអាចវែងជាង.

    វាស់លើ Rhino: video 55.639 s, audio 55.746 s, format 55.746 s. បើកាត់ដល់ 55.746
    ផ្នែកចុងក្រោយគ្មាន frame សម្រាប់ 0.107 s ចុងក្រោយ ហើយសំឡេងវែងជាងរូប.
    """
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration",
             "-of", "csv=p=0", str(video)], capture_output=True, text=True, timeout=30)
        return float(result.stdout.strip())
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def snap_to_frames(keeps: list[Range], fps: float | None) -> list[Range]:
    """រំកិលគែមនីមួយៗទៅពេលរបស់ frame (ឡើងលើ) — រូប និងសំឡេងត្រូវកាត់ចំពេលដូចគ្នា.

    `trim` រក្សាតែ frame ទាំងមូល (pts >= start ហើយ < end) ចំណែក `atrim` កាត់សំឡេងត្រង់.
    បើមិន snap ទេ ផ្នែកនីមួយៗខ្លីជាងសំឡេងរបស់វារហូតដល់ ១ frame ហើយ drift បូកគ្នា —
    វាស់លើ Rhino: ផ្នែក ៣ = video 28.945 s ធៀប audio 29.036 s (91 ms).
    ឧ. 24 fps: 12.96 s = frame 310.6 -> ផ្លាស់ទៅ frame 311 = 12.9713 s.
    """
    if not fps or fps <= 0:
        return keeps
    snapped = []
    for start, end in keeps:
        a = math.ceil(start * fps - 1e-6) / fps
        b = math.ceil(end * fps - 1e-6) / fps
        if b - a >= MIN_KEEP_SEC:
            snapped.append((round(a, 6), round(b, 6)))
    return snapped


def shift_time(seconds: float, keeps: list[Range]) -> float | None:
    """ពេលក្នុងវីដេអូដើម -> ពេលក្នុងច្បាប់ចម្លង. `None` = ពេលនោះត្រូវបានកាត់ចេញ."""
    offset = 0.0
    for start, end in keeps:
        if seconds < start:
            return None
        if seconds <= end:
            return round(offset + seconds - start, 3)
        offset += end - start
    return None


def shift_range(span: Range, keeps: list[Range]) -> list[Range]:
    """ចន្លោះពេលក្នុងវីដេអូដើម -> ចន្លោះក្នុងច្បាប់ចម្លង (អាចបែកជាច្រើន បើការកាត់នៅកណ្តាល).

    ឧ. keeps [(0, 10), (20, 30)], span (5, 25) -> [(5, 10), (10, 15)].
    """
    start, end = span
    out: list[Range] = []
    offset = 0.0
    for keep_start, keep_end in keeps:
        a, b = max(start, keep_start), min(end, keep_end)
        if b > a:
            out.append((round(offset + a - keep_start, 3), round(offset + b - keep_start, 3)))
        offset += keep_end - keep_start
    return out


def shift_transcript(transcript: Transcript, keeps: list[Range]) -> Transcript:
    """transcript នៃច្បាប់ចម្លង: ពាក្យដែល**កណ្តាល**របស់វានៅក្នុងការកាត់ ត្រូវដកចេញ, នៅសល់រំកិលពេល.

    ពាក្យដែលនៅលើគែម keep (ចាប់ផ្តើមមុន ចប់ក្រោយ) ត្រូវបានកាត់ឲ្យនៅក្នុង keep នោះ.
    """
    segments: list[Segment] = []
    for segment in transcript.segments:
        words: list[Word] = []
        for word in segment.words:
            middle = (word.start + word.end) / 2
            new_middle = shift_time(middle, keeps)
            if new_middle is None:
                continue
            keep = next(k for k in keeps if k[0] <= middle <= k[1])
            start = shift_time(max(word.start, keep[0]), keeps)
            end = shift_time(min(word.end, keep[1]), keeps)
            words.append(replace(word, start=start, end=max(start, end)))
        if words:
            segments.append(Segment(id=len(segments), start=words[0].start, end=words[-1].end,
                                    text="".join(w.word for w in words).strip(), words=words))
    total = round(sum(end - start for start, end in keeps), 3)
    return replace(transcript, segments=segments, duration=total)


def has_audio(video: Path) -> bool:
    """វីដេអូនេះមានសំឡេងឬទេ (វីដេអូស្ងាត់ មិនអាច `atrim` បាន)."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
             "-of", "csv=p=0", str(video)], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return False
    return bool(result.stdout.strip())


def cut_filter(keeps: list[Range], transition: str, width: int, height: int, audio: bool) -> str:
    """filtergraph: `split` -> `trim` ផ្នែកនីមួយៗ (+ zoom ឆ្លាស់) -> `concat` រូប និងសំឡេង.

    zoom punch-in: ផ្នែកលេខសេស `crop` 1/1.10 ពីកណ្តាល រួច `scale` ត្រឡប់ទៅទំហំដើម — concat
    ត្រូវការរូបទំហំស្មើគ្នាទាំងអស់.
    """
    count = len(keeps)
    parts = [f"[0:v]split={count}" + "".join(f"[sv{i}]" for i in range(count))]
    if audio:
        parts.append(f"[0:a]asplit={count}" + "".join(f"[sa{i}]" for i in range(count)))
    zoom_w = int(width / PUNCH_ZOOM) // 2 * 2
    zoom_h = int(height / PUNCH_ZOOM) // 2 * 2
    for i, (start, end) in enumerate(keeps):
        zoom = (f",crop={zoom_w}:{zoom_h},scale={width}:{height}:flags=lanczos,setsar=1"
                if transition == "punch" and i % 2 == 1 else "")
        parts.append(f"[sv{i}]trim=start={start:.6f}:end={end:.6f},setpts=PTS-STARTPTS{zoom}[v{i}]")
        if audio:
            length = end - start
            fade = min(AUDIO_FADE_SEC, length / 4)
            parts.append(
                f"[sa{i}]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS,"
                f"afade=t=in:d={fade:.3f},afade=t=out:st={max(0.0, length - fade):.6f}:d={fade:.3f}[a{i}]")
    joined = "".join(f"[v{i}]" + (f"[a{i}]" if audio else "") for i in range(count))
    parts.append(f"{joined}concat=n={count}:v=1:a={1 if audio else 0}[v]" + ("[a]" if audio else ""))
    return ";".join(parts)


def edit_settings(keeps: list[Range], transition: str, video: Path) -> dict:
    """អ្វីដែលកំណត់ច្បាប់ចម្លង — ដូចគ្នា = មិនចាំបាច់កាត់ម្តងទៀត."""
    stat = video.stat()
    return {"keeps": [list(k) for k in keeps], "transition": transition, "source": str(video),
            "source_bytes": stat.st_size, "source_mtime": round(stat.st_mtime, 3)}


def cut_video(video: Path, keeps: list[Range], out_path: Path, *,
              size: tuple[int, int], transition: str = "punch", force: bool = False) -> Path:
    """សរសេរច្បាប់ចម្លងដែលមានតែ `keeps` (ផ្នែករក្សា, snap ទៅ frame រួច) ទៅ `out_path`.
    វីដេអូដើមអានតែប៉ុណ្ណោះ.

    គុណភាពខ្ពស់ (cq 19 / crf 16) ព្រោះ render `--full` encode ម្តងទៀត.
    cache: `out_path` + `<out_path>.json` ដែលមាន settings ដូចគ្នា -> ប្រើវាឡើងវិញ.
    """
    from pipeline.render import encoder_args

    if transition not in TRANSITIONS:
        raise ValueError(f"transition មិនស្គាល់: {transition} ({', '.join(TRANSITIONS)})")
    out_path = Path(out_path)
    stamp = out_path.with_suffix(".json")
    settings = edit_settings(keeps, transition, Path(video))
    if not force and out_path.is_file() and stamp.is_file():
        try:
            if json.loads(stamp.read_text(encoding="utf-8")) == settings:
                return out_path
        except (OSError, ValueError):
            pass

    if not keeps:
        raise ValueError("cut list លុបវីដេអូទាំងមូល — គ្មានអ្វីនៅសល់")
    width, height = (size[0] // 2 * 2, size[1] // 2 * 2)
    audio = has_audio(Path(video))
    _, video_args = encoder_args()
    video_args = list(video_args)
    for flag, value in (("-cq", "19"), ("-crf", "16")):     # ច្បាប់ចម្លងកណ្តាល: គុណភាពខ្ពស់
        if flag in video_args:
            video_args[video_args.index(flag) + 1] = value
    out_path.parent.mkdir(parents=True, exist_ok=True)
    command = ["ffmpeg", "-nostdin", "-y", "-i", str(video),
               "-filter_complex", cut_filter(keeps, transition, width, height, audio),
               "-map", "[v]", *(["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] if audio else []),
               *video_args, "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out_path)]
    try:
        subprocess.run(command, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as error:
        raise FFmpegError(f"កាតវីដេអូមិនបាន: {error.stderr[-600:]}") from error
    stamp.write_text(json.dumps(settings), encoding="utf-8")
    return out_path


def read_cut_list(path: Path) -> list[Range]:
    """`{"cuts": [[start, end], ...]}` ឬ `[{"start", "end"}, ...]` -> list of (start, end)."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    items = data.get("cuts", []) if isinstance(data, dict) else data
    out: list[Range] = []
    for item in items:
        if isinstance(item, dict):
            out.append((float(item["start"]), float(item["end"])))
        else:
            out.append((float(item[0]), float(item[1])))
    return out


def edit_folder(aspect: str) -> str:
    """folder លទ្ធផលរបស់ការកែ: `full_edit`, `full_edit_16x9` ... (ក្បែរ `full*` ផ្សេងទៀត)."""
    return "full_edit" if aspect == "9:16" else f"full_edit_{aspect.replace(':', 'x')}"

